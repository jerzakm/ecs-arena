import type { Entity } from 'koota'
import type { Context } from './context.ts'
import { Fleeing } from './components.ts'

export const CELL = 16 * 1024

export interface Cell { e: Entity; id: number; team: number; x: number; y: number; hp: number; maxHp: number; fleeing: boolean }

const cellOf = (n: number, v: number) => Math.min(n - 1, Math.max(0, Math.floor(v / CELL)))

export const buildGrid = (ctx: Context): Cell[][] => {
  const { gridN } = ctx
  const grid: Cell[][] = Array.from({ length: gridN * gridN }, () => [])
  ctx.world.query(ctx.q.unitsQuery).readEach(([g, t, p, h], e) => {
    grid[cellOf(gridN, p.y) * gridN + cellOf(gridN, p.x)].push({ e, id: g.id, team: t.value, x: p.x, y: p.y, hp: h.hp, maxHp: h.maxHp, fleeing: e.has(Fleeing) })
  })
  return grid
}

export const forNear = (ctx: Context, grid: Cell[][], x: number, y: number, r: number, fn: (c: Cell) => void) => {
  const { gridN } = ctx
  const cx0 = cellOf(gridN, x - r), cx1 = cellOf(gridN, x + r), cy1 = cellOf(gridN, y + r)
  for (let cy = cellOf(gridN, y - r); cy <= cy1; cy++)
    for (let cx = cx0; cx <= cx1; cx++)
      for (const c of grid[cy * gridN + cx]) fn(c)
}
