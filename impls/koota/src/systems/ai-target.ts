import type { Entity } from 'koota'
import type { Context } from '../context.ts'
import { Fleeing, Health, Position, Team } from '../components.ts'
import { Targets, Threat } from '../relations.ts'
import { buildGrid, forNear, type Cell } from '../spatial.ts'

export const aiTargetSystem = (ctx: Context) => {
  const { k, world, gid, inRange, isThinkTick } = ctx
  const { KIND, UNIT_STATS, distSq } = k

  return () => {
    const tick = ctx.tickNow()
    const grid = buildGrid(ctx)
    const retarget: [Entity, Entity | undefined][] = []

    const validTarget = (team: number, x: number, y: number, sight: number, t: Entity) => {
      const tp = t.get(Position)!
      return t.get(Team)!.value !== team && !t.has(Fleeing) && inRange(x, y, tp.x, tp.y, sight)
    }

    const retaliation = (e: Entity, team: number, x: number, y: number, sight: number) => {
      let best: Entity | undefined
      let bestAmount = 0, bestId = 0
      for (const attacker of e.targetsFor(Threat)) {
        const amount = e.get(Threat(attacker))!.amount
        if (amount < k.THREAT_RETALIATE || !validTarget(team, x, y, sight, attacker)) continue
        const id = gid(attacker)
        if (!best || amount > bestAmount || (amount === bestAmount && id < bestId)) { best = attacker; bestAmount = amount; bestId = id }
      }
      return best
    }

    world.query(ctx.q.thinkers).readEach(([g, kindT, p, teamT], e) => {
      const kind = kindT.value
      if (kind === KIND.SUMMONER) return
      const stats = UNIT_STATS[kind]
      const team = teamT.value, x = p.x, y = p.y
      const cur = e.targetFor(Targets)
      let best: Entity | undefined

      if (kind === KIND.HEALER) {
        const curHurt = cur && cur.get(Health)!.hp < cur.get(Health)!.maxHp
        const cp = cur?.get(Position)
        if (cur && curHurt && cp && inRange(x, y, cp.x, cp.y, stats.range)) return
        if (isThinkTick(g.id, tick)) {
          let bestCell: Cell | undefined
          forNear(ctx, grid, x, y, stats.range, (v) => {
            if (v.team !== team || v.e === e || v.hp >= v.maxHp || !inRange(x, y, v.x, v.y, stats.range)) return
            if (!bestCell) { bestCell = v; return }
            const a = v.hp * bestCell.maxHp, b = bestCell.hp * v.maxHp
            if (a < b || (a === b && v.id < bestCell.id)) bestCell = v
          })
          best = bestCell?.e
        }
      } else {
        best = retaliation(e, team, x, y, stats.sight)
        if (!best && cur && validTarget(team, x, y, stats.sight, cur)) best = cur
        if (!best && isThinkTick(g.id, tick)) {
          let bestCell: Cell | undefined
          let bestD = 0
          const sightSq = stats.sight * stats.sight
          forNear(ctx, grid, x, y, stats.sight, (v) => {
            if (v.team === team || v.fleeing) return
            const d = distSq(x, y, v.x, v.y)
            if (d > sightSq) return
            if (!bestCell || d < bestD || (d === bestD && v.id < bestCell.id)) { bestCell = v; bestD = d }
          })
          best = bestCell?.e
        }
      }
      if (best !== cur) retarget.push([e, best])
    })

    for (const [e, t] of retarget) {
      if (t) e.add(Targets(t))
      else e.remove(Targets('*'))
    }
  }
}
