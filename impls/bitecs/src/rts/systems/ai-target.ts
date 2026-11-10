import { hasComponent, query } from 'bitecs'
import type { Ctx } from '../context.ts'
import { Fleeing, Garrisoned, Health, Kind, Position, Stun, Team } from '../components.ts'
import { GameId } from '../../shared/components.ts'
import { Q } from '../queries.ts'
import { clearLink, setLink, Targets, Threat, threatCount } from '../relations.ts'

export const aiTargetSystem = (ctx: Ctx) => {
  const { k, world } = ctx
  const { KIND, UNIT_STATS, inRange, isThinkTick } = k
  let seekerTeam = 0
  const ordered = new Set<number>() // units that took an order in this tick
  const isEnemy = (h: number) => Team.value[h] !== seekerTeam && !hasComponent(world, h, Fleeing)

  return () => {
    const tick = world.tick
    const retarget: number[] = [] // pairs: unit, new target or -1

    const validTarget = (team: number, x: number, y: number, sight: number, t: number) =>
      Team.value[t] !== team && !hasComponent(world, t, Fleeing) && !hasComponent(world, t, Garrisoned)
      && inRange(x, y, Position.x[t], Position.y[t], sight)

    const retaliation = (e: number, team: number, x: number, y: number, sight: number) => {
      if (threatCount(e) === 0) return -1
      let best = -1
      let bestAmount = 0, bestId = 0
      const attackers = Threat.attackers[e], amounts = Threat.amount[e]
      for (let i = 0; i < attackers.length; i++) {
        const attacker = attackers[i], amount = amounts[i]
        if (amount < k.THREAT_RETALIATE || !validTarget(team, x, y, sight, attacker)) continue
        const id = GameId.id[attacker]
        if (best === -1 || amount > bestAmount || (amount === bestAmount && id < bestId)) {
          best = attacker; bestAmount = amount; bestId = id
        }
      }
      return best
    }

    // SPEC 6.12. bitECS has no lookup by key, so ctx.unitById finds the unit of each probe key.
    ordered.clear()
    const n = world.nextId
    if (tick % k.ORDER_PERIOD === 0 && n > 1) {
      const given = [0, 0]
      const pick = (team: number, role: number, o: number, own: boolean): number => {
        for (let p = 0; p < k.ORDER_PROBES; p++) {
          const u = ctx.unitById.get(k.orderKey(n, ctx.scenario.seed, tick, team, role, o, p))
          if (u !== undefined && (Team.value[u] === team) === own) return u
        }
        return -1
      }
      for (let team = 0; team < 2; team++) for (let o = 0; o < ctx.scenario.ordersPerTeam; o++) {
        const s = pick(team, k.PURPOSE.ORDER_SUBJECT, o, true), t = pick(team, k.PURPOSE.ORDER_OBJECT, o, false)
        if (s === -1 || t === -1) continue
        const kind = Kind.value[s]
        if (hasComponent(world, s, Stun) || hasComponent(world, s, Fleeing) || hasComponent(world, s, Garrisoned)
          || kind === KIND.HEALER || kind === KIND.SUMMONER
          || hasComponent(world, t, Fleeing) || hasComponent(world, t, Garrisoned)) continue
        setLink(s, Targets, t)
        ordered.add(s)
        given[team]++
      }
      world.metrics.orders0 = (world.metrics.orders0 + given[0]) | 0
      world.metrics.orders1 = (world.metrics.orders1 + given[1]) | 0
    }

    for (const e of query(world, Q.thinkers)) {
      if (ordered.has(e)) continue
      const kind = Kind.value[e]
      if (kind === KIND.SUMMONER) continue
      const stats = UNIT_STATS[kind]
      const team = Team.value[e], x = Position.x[e], y = Position.y[e]
      const cur = Targets.to[e]
      let best = -1

      if (kind === KIND.HEALER) {
        const curHurt = cur !== -1 && Health.hp[cur] < Health.maxHp[cur]
        if (cur !== -1 && curHurt && inRange(x, y, Position.x[cur], Position.y[cur], stats.range)) continue
        if (isThinkTick(GameId.id[e], tick)) {
          let bestHp = 0, bestMax = 0, bestId = 0
          ctx.grid.forNear(x, y, stats.range, (h, _d2, id) => {
            if (Team.value[h] !== team || h === e) return
            const hp = Health.hp[h], maxHp = Health.maxHp[h]
            if (hp >= maxHp) return
            if (best !== -1) {
              const a = hp * bestMax, b = bestHp * maxHp
              if (a > b || (a === b && id > bestId)) return
            }
            best = h; bestHp = hp; bestMax = maxHp; bestId = id
          })
        }
      } else {
        best = retaliation(e, team, x, y, stats.sight)
        if (best === -1 && cur !== -1 && validTarget(team, x, y, stats.sight, cur)) best = cur
        if (best === -1 && isThinkTick(GameId.id[e], tick)) {
          seekerTeam = team
          best = ctx.grid.nearest(x, y, stats.sight, isEnemy)
        }
      }
      if (best !== cur) retarget.push(e, best)
    }

    for (let i = 0; i < retarget.length; i += 2) {
      if (retarget[i + 1] !== -1) setLink(retarget[i], Targets, retarget[i + 1])
      else clearLink(retarget[i], Targets)
    }
  }
}
