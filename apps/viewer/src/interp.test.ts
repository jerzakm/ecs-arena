import { describe, expect, it } from 'vitest'
import { alphaOf, PosTrack } from './interp.ts'

const it1 = (gameId: number, x: number, y: number) => ({ gameId, x, y })

describe('alphaOf', () => {
  it('is elapsed over interval, clamped to 0..1', () => {
    expect(alphaOf(25, 100)).toBe(0.25)
    expect(alphaOf(-5, 100)).toBe(0)
    expect(alphaOf(500, 100)).toBe(1)
  })
  it('is 1 when there is no interval (max speed)', () => {
    expect(alphaOf(0, 0)).toBe(1)
  })
})

describe('PosTrack', () => {
  const out = { x: 0, y: 0 }
  it('interpolates an entity between its previous and current position', () => {
    const t = new PosTrack()
    t.update([it1(1, 0, 0)], (i) => i)
    t.update([it1(1, 100, 200)], (i) => i)
    t.at(0, 0.5, out)
    expect(out).toEqual({ x: 50, y: 100 })
    t.at(0, 1, out)
    expect(out).toEqual({ x: 100, y: 200 })
  })
  it('uses the current position for an entity with no previous one', () => {
    const t = new PosTrack()
    t.update([it1(1, 0, 0)], (i) => i)
    t.update([it1(2, 40, 60), it1(1, 10, 10)], (i) => i)
    t.at(0, 0, out)
    expect(out).toEqual({ x: 40, y: 60 })
    t.at(1, 0, out)
    expect(out).toEqual({ x: 0, y: 0 })
  })
  it('matches by gameId when the order changes', () => {
    const t = new PosTrack()
    t.update([it1(1, 0, 0), it1(2, 100, 100)], (i) => i)
    t.update([it1(2, 200, 100), it1(1, 0, 0)], (i) => i)
    t.at(0, 0.5, out)
    expect(out).toEqual({ x: 150, y: 100 })
  })
  it('forgets after reset', () => {
    const t = new PosTrack()
    t.update([it1(1, 0, 0)], (i) => i)
    t.reset()
    t.update([it1(1, 100, 0)], (i) => i)
    t.at(0, 0, out)
    expect(out.x).toBe(100)
  })
})
