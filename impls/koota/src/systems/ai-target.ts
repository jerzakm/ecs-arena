import type { Entity } from 'koota'
import type { Context } from '../context.ts'
import { Fleeing, Garrisoned, Health, Position, Team } from '../components.ts'
import { Targets, Threat } from '../relations.ts'

export const aiTargetSystem = (ctx: Context) => {
  const { k, world, gid, inRange, isThinkTick } = ctx
  const { KIND, UNIT_STATS } = k
  let seekerTeam = 0
  const isEnemy = (h: number) => ctx.teamAt[h] !== seekerTeam && !ctx.unitAt[h].has(Fleeing)

  return () => {
    const tick = ctx.tickNow()
    const retarget: [Entity, Entity | undefined][] = []

    const validTarget = (team: number, x: number, y: number, sight: number, t: Entity) => {
      const tp = t.get(Position)!
      return t.get(Team)!.value !== team && !t.has(Fleeing) && !t.has(Garrisoned) && inRange(x, y, tp.x, tp.y, sight)
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
          let bestHp = 0, bestMax = 0, bestId = 0
          ctx.grid.forNear(x, y, stats.range, (h, _d2, id) => {
            const v = ctx.unitAt[h]
            if (ctx.teamAt[h] !== team || v === e) return
            const { hp, maxHp } = v.get(Health)!
            if (hp >= maxHp) return
            if (best) {
              const a = hp * bestMax, b = bestHp * maxHp
              if (a > b || (a === b && id > bestId)) return
            }
            best = v; bestHp = hp; bestMax = maxHp; bestId = id
          })
        }
      } else {
        best = retaliation(e, team, x, y, stats.sight)
        if (!best && cur && validTarget(team, x, y, stats.sight, cur)) best = cur
        if (!best && isThinkTick(g.id, tick)) {
          seekerTeam = team
          const h = ctx.grid.nearest(x, y, stats.sight, isEnemy)
          best = h === -1 ? undefined : ctx.unitAt[h]
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
