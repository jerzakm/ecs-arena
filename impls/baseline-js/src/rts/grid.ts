import type { Ctx } from './context.ts'

const noop = () => {}

/**
 * The function that a system calls before it searches the kernel grid. The normal code keeps the grid in step as units move,
 * so it needs no call. The naive code (region `grid.update`) sends every unit to the grid again.
 */
export const resendGridFor = (ctx: Ctx): (() => void) => {
  if (!ctx.isNaive('grid.update')) return noop
  return () => {
    ctx.begin('grid.update')
    for (let u_i = 0, u = ctx.units[0]; u_i < ctx.units.length; u = ctx.units[++u_i]) if (!u.garrison) ctx.grid.update(u.h, u.x, u.y)
    ctx.end('grid.update')
  }
}
