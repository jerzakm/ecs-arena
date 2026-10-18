import { EXPERIMENTAL_queryColumns as queryColumns, defineSystem, hasComponent, type EntityId } from 'iris-ecs'
import type { Context } from '../context.ts'
import { Fleeing, Health, Kind, Metrics, NextId, Position, Stun, Targets, Team } from '../components.ts'
import { AnyGarrison } from '../relations.ts'
import { thinkers } from '../queries.ts'

export const aiTargetSystem = (ctx: Context) => {
  const { k, world, get, inRange, isThinkTick } = ctx
  const { KIND, UNIT_STATS } = k
  const has = (e: EntityId, c: EntityId) => hasComponent(world, e, c)
  let seekerTeam = 0
  const ordered = new Set<EntityId>() // units that took an order in this tick
  const isEnemy = (h: number) => ctx.teamAt[h] !== seekerTeam && !has(ctx.unitAt[h], Fleeing)

  return defineSystem('ai/target', () => {
    const tick = ctx.tickNow()
    const retarget: [EntityId, EntityId | undefined][] = []

    const validTarget = (team: number, x: number, y: number, sight: number, t: EntityId) =>
      get(t, Team, 'value') !== team && !has(t, Fleeing) && !has(t, AnyGarrison) && inRange(x, y, get(t, Position, 'x'), get(t, Position, 'y'), sight)

    const retaliation = (e: EntityId, team: number, x: number, y: number, sight: number) => {
      let best: EntityId | undefined
      let bestAmount = 0, bestId = 0
      const edges = ctx.threatOf(e)
      for (let i = 0; i < edges.length; i += 2) {
        const attacker = ctx.entityOf.get(edges[i]), amount = edges[i + 1], id = edges[i]
        if (attacker === undefined || amount < k.THREAT_RETALIATE || !validTarget(team, x, y, sight, attacker)) continue
        if (best === undefined || amount > bestAmount || (amount === bestAmount && id < bestId)) { best = attacker; bestAmount = amount; bestId = id }
      }
      return best
    }

    // SPEC 6.12. `unitByKey` reads the `entityOf` map by gameId, so a dead key finds nothing.
    ordered.clear()
    const n = ctx.res(NextId, 'value')
    if (tick % k.ORDER_PERIOD === 0 && n > 1) {
      const given = [0, 0]
      const pick = (team: number, role: number, o: number, own: boolean): EntityId | undefined => {
        for (let p = 0; p < k.ORDER_PROBES; p++) {
          const u = ctx.unitByKey(k.orderKey(n, ctx.scenario.seed, tick, team, role, o, p))
          if (u !== undefined && (get(u, Team, 'value') === team) === own) return u
        }
        return undefined
      }
      for (let team = 0; team < 2; team++) for (let o = 0; o < ctx.scenario.ordersPerTeam; o++) {
        const s = pick(team, k.PURPOSE.ORDER_SUBJECT, o, true), t = pick(team, k.PURPOSE.ORDER_OBJECT, o, false)
        if (s === undefined || t === undefined) continue
        const kind = get(s, Kind, 'value')
        if (has(s, Stun) || has(s, Fleeing) || has(s, AnyGarrison) || kind === KIND.HEALER || kind === KIND.SUMMONER || has(t, Fleeing) || has(t, AnyGarrison)) continue
        ctx.setLink(s, Targets, t)
        ordered.add(s)
        given[team]++
      }
      ctx.setRes(Metrics, 'orders0', (ctx.res(Metrics, 'orders0') + given[0]) | 0)
      ctx.setRes(Metrics, 'orders1', (ctx.res(Metrics, 'orders1') + given[1]) | 0)
    }

    queryColumns(world, thinkers, (entities, [gameId, kindCol, pos, teamCol, targets]) => {
      for (let i = 0; i < entities.length; i++) {
        const e = entities[i]
        if (ordered.has(e)) continue
        const kind = kindCol.value[i]
        if (kind === KIND.SUMMONER) continue
        const stats = UNIT_STATS[kind]
        const team = teamCol.value[i], x = pos.x[i], y = pos.y[i]
        const id = gameId.id[i]
        const cur = ctx.entityOf.get(targets.to[i])
        let best: EntityId | undefined

        if (kind === KIND.HEALER) {
          const curHurt = cur !== undefined && get(cur, Health, 'hp') < get(cur, Health, 'maxHp')
          if (cur !== undefined && curHurt && inRange(x, y, get(cur, Position, 'x'), get(cur, Position, 'y'), stats.range)) continue
          if (isThinkTick(id, tick)) {
            let bestHp = 0, bestMax = 0, bestId = 0
            ctx.grid.forNear(x, y, stats.range, (h, _d2, vid) => {
              const v = ctx.unitAt[h]
              if (ctx.teamAt[h] !== team || v === e) return
              const hp = get(v, Health, 'hp'), maxHp = get(v, Health, 'maxHp')
              if (hp >= maxHp) return
              if (best !== undefined) {
                const a = hp * bestMax, b = bestHp * maxHp
                if (a > b || (a === b && vid > bestId)) return
              }
              best = v; bestHp = hp; bestMax = maxHp; bestId = vid
            })
          }
        } else {
          best = retaliation(e, team, x, y, stats.sight)
          if (best === undefined && cur !== undefined && validTarget(team, x, y, stats.sight, cur)) best = cur
          if (best === undefined && isThinkTick(id, tick)) {
            seekerTeam = team
            const h = ctx.grid.nearest(x, y, stats.sight, isEnemy)
            best = h === -1 ? undefined : ctx.unitAt[h]
          }
        }
        if (best !== cur) retarget.push([e, best])
      }
    })

    for (const [e, t] of retarget) {
      ctx.setLink(e, Targets, t)
    }
  })
}
