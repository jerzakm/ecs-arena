import { describe, expect, it } from 'vitest'
import { aggregate, deltaPct, isNoise, median, p95, spread } from './stats.ts'

describe('stats', () => {
  it('median and p95', () => {
    expect(median([3, 1, 2])).toBe(2)
    expect(median([4, 1, 3, 2])).toBe(2.5)
    expect(p95([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])).toBeCloseTo(9.55)
    expect(p95([7])).toBe(7)
  })
  it('aggregates per metric', () => {
    const r = (t: number) => ({ totalMs: t, phasesMs: { move: t / 2 }, peakHeap: t * 10 })
    const a = aggregate([r(10), r(30), r(20)])
    expect(a.runs).toBe(3)
    expect(a.totalMs.median).toBe(20)
    expect(a.phasesMs.move.median).toBe(10)
    expect(a.phasesSumMs.median).toBe(10)
    expect(a.peakHeap.p95).toBeCloseTo(290)
  })
  it('deltaPct', () => {
    expect(deltaPct(100, 110)).toBeCloseTo(10)
    expect(deltaPct(100, 80)).toBeCloseTo(-20)
  })
  it('flags deltas smaller than the combined spread as noise', () => {
    const a = { median: 100, p95: 110 }
    expect(spread(a)).toBe(10)
    expect(isNoise(a, { median: 115, p95: 125 })).toBe(true) // delta 15 < 20
    expect(isNoise(a, { median: 130, p95: 140 })).toBe(false) // delta 30 > 20
    expect(isNoise(a, { median: 80, p95: 85 })).toBe(false) // delta 20 > 15
  })
})
