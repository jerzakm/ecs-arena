import type { Context } from './context.ts'
import type { Shrine, Unit } from './types.ts'

// The normal code takes a garrisoned unit out of the kernel grid, so no search finds it. The naive code leaves it
// in the grid and relies on the `u.garrison` test that every search callback makes in both modes.
export const enterGarrison = (ctx: Context, u: Unit, s: Shrine) => {
  s.garrison.push(u)
  u.garrison = s
  if (u.target !== -1) { ctx.retarget(u, -1); ctx.add('rel.Targets.remove') }
  if (!ctx.isNaive('garrison')) ctx.grid.remove(u.h)
  ctx.add('tag.add.garrisoned'); ctx.add('rel.GarrisonOf.add'); ctx.add('rule.garrison')
}

export const leaveGarrison = (ctx: Context, u: Unit) => {
  const list = u.garrison!.garrison
  list.splice(list.indexOf(u), 1)
  u.garrison = null
  if (!ctx.isNaive('garrison')) ctx.grid.add(u.h, u.gameId, u.x, u.y)
  ctx.add('tag.remove.garrisoned'); ctx.add('rel.GarrisonOf.remove')
}

/** Drops every Targets relation to the units that entered a garrison, from units and from projectiles. */
export const dropTargetsTo = (ctx: Context, entered: Unit[]) => {
  if (entered.length === 0) return
  const ids = new Set<number>()
  for (let i = 0; i < entered.length; i++) ids.add(entered[i].gameId)
  if (ctx.isNaive('garrison')) {
    const units = ctx.units
    for (let u_i = 0, u = units[0]; u_i < units.length; u = units[++u_i]) if (ids.has(u.target)) { ctx.retarget(u, -1); ctx.add('rel.Targets.remove') }
  } else {
    for (let i = 0; i < entered.length; i++) {
      const inbound = ctx.targeters.get(entered[i].gameId)
      if (inbound) for (const s of Array.from(inbound)) { ctx.retarget(s, -1); ctx.add('rel.Targets.remove') }
    }
  }
  const ps = ctx.projectiles
  for (let p_i = 0, p = ps[0]; p_i < ps.length; p = ps[++p_i]) if (ids.has(p.target)) p.target = -1
}
