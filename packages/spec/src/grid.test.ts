import { describe, expect, it } from 'vitest'
import { FX } from './kernel.ts'
import { SpatialGrid } from './grid.ts'

const near = (g: SpatialGrid, x: number, y: number, r: number) => {
  const out: number[] = []
  g.forNear(x, y, r, (h) => out.push(h))
  return out.sort((a, b) => a - b)
}

describe('SpatialGrid', () => {
  it('breaks a distance tie by the lowest gameId, whatever the handle order', () => {
    const g = new SpatialGrid()
    g.add(0, 30, 10 * FX, 10 * FX)
    g.add(1, 20, 12 * FX, 10 * FX)
    g.add(2, 10, 8 * FX, 10 * FX)
    g.add(3, 5, 50 * FX, 50 * FX)
    expect(g.nearest(10 * FX, 10 * FX, 5 * FX, (h) => h !== 0)).toBe(2)
  })

  it('moves a handle between cells on update, including across the arena', () => {
    const g = new SpatialGrid()
    g.add(7, 1, 5 * FX, 5 * FX)
    expect(near(g, 5 * FX, 5 * FX, 2 * FX)).toEqual([7])
    g.update(7, 200 * FX, 200 * FX)
    expect(near(g, 5 * FX, 5 * FX, 2 * FX)).toEqual([])
    expect(near(g, 200 * FX, 200 * FX, 2 * FX)).toEqual([7])
  })

  it('applies the squared-distance range test and drops removed handles', () => {
    const g = new SpatialGrid()
    g.add(0, 1, 0, 0)
    g.add(1, 2, 3 * FX, 4 * FX)
    g.add(2, 3, 3 * FX, 4 * FX + 1)
    expect(near(g, 0, 0, 5 * FX)).toEqual([0, 1])
    g.remove(1)
    expect(near(g, 0, 0, 5 * FX)).toEqual([0])
    g.add(1, 9, FX, FX)
    expect(near(g, 0, 0, 5 * FX)).toEqual([0, 1])
  })
})
