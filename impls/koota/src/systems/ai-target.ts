import type { Entity } from 'koota'
import type { Context } from '../context.ts'
import { Fleeing, Garrisoned, Kind, Metrics, NextId, Health, Position, Stun, Team } from '../components.ts'
import { Targets, Threat } from '../relations.ts'

export const aiTargetSystem = (ctx: Context) => {
  const { k, world, gid, inRange, isThinkTick } = ctx
  const { KIND, UNIT_STATS } = k
  let seekerTeam = 0
  const ordered = new Set<Entity>() // units that took an order in this tick
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

    // SPEC 6.12. koota has no lookup by key, so ctx.unitById finds the unit of each probe key.
    ordered.clear()
    const n = world.get(NextId)!.value
    if (tick % k.ORDER_PERIOD === 0 && n > 1) {
      const given = [0, 0]
      const pick = (team: number, role: number, o: number, own: boolean): Entity | undefined => {
        for (let p = 0; p < k.ORDER_PROBES; p++) {
          const u = ctx.unitById.get(k.orderKey(n, ctx.scenario.seed, tick, team, role, o, p))
          if (u && (u.get(Team)!.value === team) === own) return u
        }
        return undefined
      }
      for (let team = 0; team < 2; team++) for (let o = 0; o < ctx.scenario.ordersPerTeam; o++) {
        const s = pick(team, k.PURPOSE.ORDER_SUBJECT, o, true), t = pick(team, k.PURPOSE.ORDER_OBJECT, o, false)
        if (!s || !t) continue
        const kind = s.get(Kind)!.value
        if (s.has(Stun) || s.has(Fleeing) || s.has(Garrisoned) || kind === KIND.HEALER || kind === KIND.SUMMONER || t.has(Fleeing) || t.has(Garrisoned)) continue
        s.add(Targets(t))
        ordered.add(s)
        given[team]++
      }
      world.set(Metrics, (m) => ({ orders0: (m.orders0 + given[0]) | 0, orders1: (m.orders1 + given[1]) | 0 }))
    }

    world.query(ctx.q.thinkers).readEach(([g, kindT, p, teamT], e) => {
      if (ordered.has(e)) return
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
