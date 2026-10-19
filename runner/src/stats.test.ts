import { describe, expect, it } from 'vitest'
import { aggregate, enough, FULL, fixed, deltaPct, geomeanScore, hlRatio, mannWhitney, median, medianCI, MIN_RUNS, noise, p95, prng, rankScores, scoreTargets, tailMetrics } from './stats.ts'

describe('stats', () => {
  it('median and p95', () => {
    expect(median([3, 1, 2])).toBe(2)
    expect(median([4, 1, 3, 2])).toBe(2.5)
    expect(p95([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])).toBeCloseTo(9.55)
    expect(p95([7])).toBe(7)
  })
  it('aggregates per metric', () => {
    const r = (t: number) => ({ totalMs: t, tickMs: [t], deep: { phasesMs: { move: t / 2 }, peakHeap: t * 10, gcMs: 0, allocBytes: 0, ticks: [[t]] } })
    const rs = [r(10), r(30), r(20)]
    const a = aggregate(rs, rs.map((x) => ({ ...x, totalMs: x.totalMs * 1.1 })))
    expect(a.runs).toBe(3)
    expect(a.totalMs.median).toBe(20)
    expect(a.deep!.phasesMs.move.median).toBe(10)
    expect(a.deep!.phasesSumMs.median).toBe(10)
    expect(a.deep!.peakHeap.p95).toBeCloseTo(290)
    expect(a.deep!.overhead).toBeCloseTo(0.1)
    expect(a.samples.move).toEqual([5, 15, 10])
  })
  it('deltaPct', () => {
    expect(deltaPct(100, 110)).toBeCloseTo(10)
    expect(deltaPct(100, 80)).toBeCloseTo(-20)
  })
  it('rank test, shift and noise', () => {
    const a = [100, 101, 99, 102, 98, 100, 101, 99]
    expect(mannWhitney(a, a.map((x) => x * 1.1))).toBeLessThan(0.01)
    expect(mannWhitney(a, [...a].reverse())).toBeCloseTo(1)
    expect(hlRatio(a, a.map((x) => x * 1.1))).toBeCloseTo(1.1, 2)
    expect(noise([10, 10, 10])).toBe(0)
    expect(noise([9, 10, 11])).toBeCloseTo(0.14826)
  })
  it('tail metrics', () => {
    const t = Array.from({ length: 100 }, (_, i) => (i === 99 ? 40 : i === 98 ? 17 : 1))
    const m = tailMetrics(t)
    expect(m.max).toBe(40)
    expect(m.over).toBe(2)
    expect(m.p99).toBeCloseTo(17 + (40 - 17) * 0.01)
  })
  it('bootstrap is deterministic and brackets the median', () => {
    const xs = [10, 11, 9, 12, 10, 13, 10, 11, 9, 10]
    expect(prng(7)()).toBe(prng(7)())
    const a = medianCI(xs)
    expect(medianCI(xs)).toEqual(a)
    expect(a.lo).toBeLessThanOrEqual(a.point)
    expect(a.hi).toBeGreaterThanOrEqual(a.point)
    expect(medianCI([5, 5, 5, 5])).toEqual({ point: 5, lo: 5, hi: 5 })
  })
  it('stop rule: max stops, min holds, a tight interval stops early, spread keeps going', () => {
    const spread = [10, 14, 8, 12, 9, 15, 11, 13, 10, 12]
    expect(enough(spread, FULL)).toBe(true)
    expect(enough(spread.slice(0, 9), FULL)).toBe(false)
    expect(enough([5, 5], FULL)).toBe(false)
    expect(enough([5, 5, 5], FULL)).toBe(true)
    expect(enough([5], fixed(3, 2))).toBe(false)
    expect(enough([5, 6, 7], fixed(3, 2))).toBe(true)
    // wall-time cap: stops a wide interval, but never before min runs
    expect(enough(spread.slice(0, 5), FULL, FULL.wallMs)).toBe(true)
    expect(enough(spread.slice(0, 2), FULL, FULL.wallMs)).toBe(false)
  })
  it('geomean score is the geometric mean of matched ratios', () => {
    const base = { a: [10, 10, 10], b: [100, 100, 100] }
    const g = geomeanScore({ a: [20, 20, 20], b: [800, 800, 800] }, base)
    expect(g.point).toBeCloseTo(Math.sqrt(2 * 8))
    expect(g.lo).toBeCloseTo(4)
    expect(g.hi).toBeCloseTo(4)
    expect(geomeanScore(base, base).point).toBe(1)
  })
  it('shares a rank when intervals overlap', () => {
    const r = rankScores([{ point: 3, lo: 2.5, hi: 3.5 }, { point: 1, lo: 0.9, hi: 1.1 }, { point: 1.2, lo: 1.0, hi: 1.4 }, { point: 2, lo: 1.8, hi: 2.2 }])
    expect(r.map((x) => x.rank)).toEqual([1, 1, 3, 4])
    expect(scoreTargets({ x: { a: [1] } })).toEqual([])
  })
  it('four runs per side reach p < 0.05 and three do not', () => {
    expect(MIN_RUNS).toBe(4)
    expect(mannWhitney([1, 2, 3, 4], [5, 6, 7, 8])).toBeLessThan(0.05)
    expect(mannWhitney([1, 2, 3], [4, 5, 6])).toBeGreaterThan(0.05)
  })
})
