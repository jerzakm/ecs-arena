import type { Context } from './context.ts'
import type { Unit } from './types.ts'

export const memberIndex = (ctx: Context): Map<number, Unit[]> => {
  const units = ctx.units
  const index = new Map<number, Unit[]>()
  for (let u_i = 0, u = units[0]; u_i < units.length; u = units[++u_i]) if (u.memberOf !== -1) {
    const list = index.get(u.memberOf)
    if (list) list.push(u)
    else index.set(u.memberOf, [u])
  }
  return index
}
