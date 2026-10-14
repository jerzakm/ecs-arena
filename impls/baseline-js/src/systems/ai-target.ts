import type { Context } from '../context.ts'
import { buildGrid, forNear } from '../spatial.ts'
import type { Unit } from '../types.ts'

export const aiTargetSystem = (ctx: Context) => {
  const { k, add, unitById, isStunned, inRange, targetOf } = ctx
  const { distSq, KIND, UNIT_STATS } = k
  const isThinkTick = (u: Unit) => (u.gameId + ctx.tick) % k.THINK_INTERVAL === 0

  return () => {
    const units = ctx.units
    const grid = buildGrid(ctx)
    const setTarget = (u: Unit, t: number) => {
      if (u.target !== t) {
        add(u.target === -1 ? 'rel.Targets.add' : t === -1 ? 'rel.Targets.remove' : 'rel.Targets.retarget')
        u.target = t
      }
    }
    const validTarget = (u: Unit, v: Unit) =>
      v.team !== u.team && !v.fleeing && inRange(u.x, u.y, v.x, v.y, UNIT_STATS[u.kind].sight)

    const healTarget = (u: Unit): number => {
      const range = UNIT_STATS[u.kind].range
      const cur = targetOf(u)
      if (cur && cur.hp < cur.maxHp && inRange(u.x, u.y, cur.x, cur.y, range)) return cur.gameId
      if (!isThinkTick(u)) return -1
      let best: Unit | null = null
      forNear(ctx, grid, u.x, u.y, range, (v) => {
        if (v.team !== u.team || v === u || v.hp >= v.maxHp || !inRange(u.x, u.y, v.x, v.y, range)) return
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
      let best: Unit | null = null
      let bestD = 0
      forNear(ctx, grid, u.x, u.y, UNIT_STATS[u.kind].sight, (v) => {
        if (!validTarget(u, v)) return
        const d = distSq(u.x, u.y, v.x, v.y)
        if (!best || d < bestD || (d === bestD && v.gameId < best.gameId)) { best = v; bestD = d }
      }, 'target')
      return best ? (best as Unit).gameId : -1
    }

    for (let u_i = 0, u = units[0]; u_i < units.length; u = units[++u_i]) {
      if (isStunned(u)) continue
      add('q.ai.evaluated')
      if (u.fleeing || u.kind === KIND.SUMMONER) setTarget(u, -1)
      else if (u.kind === KIND.HEALER) setTarget(u, healTarget(u))
      else setTarget(u, enemyTarget(u))
    }
  }
}
