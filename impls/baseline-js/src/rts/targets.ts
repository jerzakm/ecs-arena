import type { Ctx } from './context.ts'
import type { Unit } from './types.ts'

// Targets is stored as `u.target` (a gameId) and `u.tref` (the unit). `ctx.targeters` is its inverse. This keeps the three in step.
export const retarget = (ctx: Ctx, u: Unit, t: number) => {
  if (u.target !== -1) {
    const s = ctx.targeters.get(u.target)
    if (s) { s.delete(u); if (s.size === 0) ctx.targeters.delete(u.target) }
  }
  u.target = t
  u.tref = t === -1 ? undefined : ctx.unitById.get(t)
  if (t === -1) return
  const s = ctx.targeters.get(t)
  if (s) s.add(u)
  else ctx.targeters.set(t, new Set([u]))
}
