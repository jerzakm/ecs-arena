import {
  defineSystem, type EntityId, EXPERIMENTAL_queryColumns as queryColumns, getComponentValue, getResourceValue, hasComponent,
  setResourceValue,
} from 'iris-ecs'
import { AnyGarrison, Clock, Fleeing, Health, Kind, Metrics, NextId, Position, Stun, Targets, Team, Threat } from '../components.ts'
import type { Ctx } from '../context.ts'
import { setLink, unitByKey } from '../links.ts'
import { thinkers } from '../queries.ts'

export const aiTargetSystem = (ctx: Ctx) => {
  const { k, world } = ctx
  const { KIND, UNIT_STATS } = k
  let seekerTeam = 0
  const ordered = new Set<EntityId>() // units that took an order in this tick
  const isHurt = (e: EntityId) => getComponentValue(world, e, Health, 'hp')! < getComponentValue(world, e, Health, 'maxHp')!
  const inReach = (x: number, y: number, t: EntityId, reach: number) =>
    k.inRange(x, y, getComponentValue(world, t, Position, 'x')!, getComponentValue(world, t, Position, 'y')!, reach)
  const unavailable = (e: EntityId) => hasComponent(world, e, Fleeing) || hasComponent(world, e, AnyGarrison)
  const isEnemy = (h: number) => ctx.units.tagAt[h] !== seekerTeam && !hasComponent(world, ctx.units.entityAt[h], Fleeing)

  return defineSystem('ai/target', () => {
    const tick = getResourceValue(world, Clock, 'tick')!
    const retarget: [EntityId, EntityId | undefined][] = []

    const validTarget = (team: number, x: number, y: number, sight: number, t: EntityId) =>
      getComponentValue(world, t, Team, 'value') !== team && !unavailable(t) && inReach(x, y, t, sight)

    const retaliation = (e: EntityId, team: number, x: number, y: number, sight: number) => {
      let best: EntityId | undefined
      let bestAmount = 0, bestId = 0
      const edges = getComponentValue(world, e, Threat, 'edges')!
      for (let i = 0; i < edges.length; i += 2) {
        const attacker = ctx.entityOf.get(edges[i]), amount = edges[i + 1], id = edges[i]
        if (attacker === undefined || amount < k.THREAT_RETALIATE || !validTarget(team, x, y, sight, attacker)) continue
        if (best === undefined || amount > bestAmount || (amount === bestAmount && id < bestId)) {
          best = attacker
          bestAmount = amount
          bestId = id
        }
      }
      return best
    }

    // SPEC 6.12. `unitByKey` reads the `entityOf` map by gameId, so a dead key finds nothing.
    ordered.clear()
    const n = getResourceValue(world, NextId, 'value')!
    if (tick % k.ORDER_PERIOD === 0 && n > 1) {
      const given = [0, 0]
      const pick = (team: number, role: number, o: number, own: boolean): EntityId | undefined => {
        for (let p = 0; p < k.ORDER_PROBES; p++) {
          const u = unitByKey(ctx, k.orderKey(n, ctx.scenario.seed, tick, team, role, o, p))
          if (u !== undefined && (getComponentValue(world, u, Team, 'value')! === team) === own) return u
        }
        return undefined
      }
      for (let team = 0; team < 2; team++) for (let o = 0; o < ctx.scenario.ordersPerTeam; o++) {
        const s = pick(team, k.PURPOSE.ORDER_SUBJECT, o, true), t = pick(team, k.PURPOSE.ORDER_OBJECT, o, false)
        if (s === undefined || t === undefined) continue
        const kind = getComponentValue(world, s, Kind, 'value')!
        if (hasComponent(world, s, Stun) || unavailable(s) || kind === KIND.HEALER || kind === KIND.SUMMONER || unavailable(t)) continue
        setLink(ctx, s, Targets, t)
        ordered.add(s)
        given[team]++
      }
      setResourceValue(world, Metrics, 'orders0', (getResourceValue(world, Metrics, 'orders0')! + given[0]) | 0)
      setResourceValue(world, Metrics, 'orders1', (getResourceValue(world, Metrics, 'orders1')! + given[1]) | 0)
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
          if (cur !== undefined && isHurt(cur) && inReach(x, y, cur, stats.range)) continue
          if (k.isThinkTick(id, tick)) {
            let bestHp = 0, bestMax = 0, bestId = 0
            ctx.units.grid.forNear(x, y, stats.range, (h, _d2, vid) => {
              const v = ctx.units.entityAt[h]
              if (ctx.units.tagAt[h] !== team || v === e) return
              const hp = getComponentValue(world, v, Health, 'hp')!, maxHp = getComponentValue(world, v, Health, 'maxHp')!
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
          if (best === undefined && k.isThinkTick(id, tick)) {
            seekerTeam = team
            const h = ctx.units.grid.nearest(x, y, stats.sight, isEnemy)
            best = h === -1 ? undefined : ctx.units.entityAt[h]
          }
        }
        if (best !== cur) retarget.push([e, best])
      }
    })

    for (const [e, t] of retarget) {
      setLink(ctx, e, Targets, t)
    }
  })
}
