import type { Context } from './context.ts'
import type { Unit } from './types.ts'

export const CELL = 16 * 1024 // grid cell size, an implementation detail

// Implementation-owned spatial index: units bucketed by position, rebuilt when a phase needs it.
export type Grid = Unit[][]
const cellOf = (n: number, v: number) => Math.min(n - 1, Math.max(0, Math.floor(v / CELL)))

export const buildGrid = (ctx: Context): Grid => {
  const { units, gridN, add } = ctx
  add('grid.build'); add('grid.inserted', units.length)
  const grid: Grid = Array.from({ length: gridN * gridN }, () => [])
  for (let u_i = 0, u = units[0]; u_i < units.length; u = units[++u_i]) grid[cellOf(gridN, u.y) * gridN + cellOf(gridN, u.x)].push(u)
  return grid
}

// Calls fn for every unit in the cells that overlap the square of half-size r around (x, y).
export const forNear = (ctx: Context, grid: Grid, x: number, y: number, r: number, fn: (u: Unit) => void, q: string) => {
  const n = ctx.gridN
  let scanned = 0
  for (let cy = cellOf(n, y - r); cy <= cellOf(n, y + r); cy++)
    for (let cx = cellOf(n, x - r); cx <= cellOf(n, x + r); cx++)
      for (const u of grid[cy * n + cx]) { scanned++; fn(u) }
  if (ctx.counters) { ctx.add(`query.${q}`); ctx.add(`query.${q}.scanned`, scanned) }
}
