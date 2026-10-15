import type { Context } from '../context.ts'
import type { Unit } from '../types.ts'

export const aiTargetSystem = (ctx: Context) => {
  const { k, add, begin, end, unitById, isStunned, inRange, targetOf } = ctx
  const { KIND, UNIT_STATS } = k
  let seeker!: Unit
  const isEnemy = (h: number) => { const v = ctx.slots[h]; return v.team !== seeker.team && !v.fleeing && !v.garrison }
  const naiveLookup = ctx.isNaive('orders.lookup')
  const ordered = new Set<Unit>() // units that took an order in this tick
  const find = (id: number): Unit | undefined => {
    if (!naiveLookup) return unitById.get(id)
    const units = ctx.units
    for (let u_i = 0, u = units[0]; u_i < units.length; u = units[++u_i]) if (u.gameId === id) return u
    return undefined
  }
  const isThinkTick = (u: Unit) => (u.gameId + ctx.tick) % k.THINK_INTERVAL === 0

  return () => {
    const units = ctx.units
    const setTarget = (u: Unit, t: number) => {
      if (u.target !== t) {
        add(u.target === -1 ? 'rel.Targets.add' : t === -1 ? 'rel.Targets.remove' : 'rel.Targets.retarget')
        ctx.retarget(u, t)
      }
    }
    const validTarget = (u: Unit, v: Unit) =>
      v.team !== u.team && !v.fleeing && !v.garrison && inRange(u.x, u.y, v.x, v.y, UNIT_STATS[u.kind].sight)

    const healTarget = (u: Unit): number => {
      const range = UNIT_STATS[u.kind].range
      const cur = targetOf(u)
      if (cur && cur.hp < cur.maxHp && inRange(u.x, u.y, cur.x, cur.y, range)) return cur.gameId
      if (!isThinkTick(u)) return -1
      let best: Unit | null = null
      ctx.grid.forNear(u.x, u.y, range, (h) => {
        const v = ctx.slots[h]
        if (v.team !== u.team || v === u || v.hp >= v.maxHp || v.garrison) return
        if (!best) { best = v; return }
        const a = v.hp * best.maxHp, b = best.hp * v.maxHp
        if (a < b || (a === b && v.gameId < best.gameId)) best = v
      }, 'heal')
      return best ? (best as Unit).gameId : -1
    }

    const retaliationTarget = (u: Unit): number => {
      let best = -1, bestAmount = 0
      for (let e_i = 0, e = u.threat[0]; e_i < u.threat.length; e = u.threat[++e_i]) {
        if (e.amount < k.THREAT_RETALIATE) continue
        const a = unitById.get(e.attacker)
        if (!a || !validTarget(u, a)) continue
        if (best === -1 || e.amount > bestAmount || (e.amount === bestAmount && a.gameId < best)) { best = a.gameId; bestAmount = e.amount }
      }
      return best
    }

    const enemyTarget = (u: Unit): number => {
      const retaliate = retaliationTarget(u)
      if (retaliate !== -1) { add('q.ai.retaliate'); return retaliate }
      const cur = targetOf(u)
      if (cur && validTarget(u, cur)) { add('q.ai.kept'); return cur.gameId }
      if (!isThinkTick(u)) { add('q.ai.thinkSkipped'); return -1 }
      seeker = u
      const h = ctx.grid.nearest(u.x, u.y, UNIT_STATS[u.kind].sight, isEnemy, 'target')
      return h === -1 ? -1 : ctx.slots[h].gameId
    }

    // SPEC §6.12. A key can name anything that ever had a gameId, so most orders find no unit or no valid target.
    ordered.clear()
    const n = ctx.nextId
    if (ctx.tick % k.ORDER_PERIOD === 0 && n > 1) {
      begin('orders.lookup')
      for (let team = 0; team < 2; team++) for (let o = 0; o < ctx.scenario.ordersPerTeam; o++) {
        const [sk, ok] = k.orderKeys(n, ctx.scenario.seed, ctx.tick, team, o)
        const s = find(sk), t = find(ok)
        if (!s || !t || s.team !== team || isStunned(s) || s.fleeing || s.garrison || s.kind === KIND.HEALER || s.kind === KIND.SUMMONER || !validTarget(s, t)) { add('q.ai.orderIgnored'); continue }
        setTarget(s, t.gameId)
        ordered.add(s)
        ctx.world.orders[team] = (ctx.world.orders[team] + 1) | 0
        add('q.ai.ordered')
      }
      end('orders.lookup')
    }

    for (let u_i = 0, u = units[0]; u_i < units.length; u = units[++u_i]) {
      if (isStunned(u) || u.garrison || ordered.has(u)) continue
      add('q.ai.evaluated')
      if (u.fleeing || u.kind === KIND.SUMMONER) setTarget(u, -1)
      else if (u.kind === KIND.HEALER) setTarget(u, healTarget(u))
      else setTarget(u, enemyTarget(u))
    }
  }
}
