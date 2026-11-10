import { describe, expect, it } from 'vitest'
import { aggregate, clockDrift, enough, FULL, fixed, deltaPct, geomeanScore, hlRatio, mannWhitney, median, planFor, medianCI, MIN_RUNS, relativeSpread, minDetectableEffect, p95, prng, rankScores, scoreTargets, tailMetrics, frameSeries, pickMedianRun } from './stats.ts'

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
  it('relative spread and min detectable change, by hand', () => {
    // [10 12 14 16 100]: median 14, deviations 4 2 0 2 86 sort to 0 2 2 4 86, MAD 2, spread 1.4826 * 2 / 14 = 0.21180.
    expect(relativeSpread([10, 12, 14, 16, 100])).toBeCloseTo(0.2118, 4)
    expect(relativeSpread([5])).toBe(0)
    expect(relativeSpread([0, 0, 0])).toBe(0)
    // 2.8 * 0.1 * sqrt(2 / 8) = 2.8 * 0.1 * 0.5 = 0.14. Four times the runs halve it: 2.8 * 0.1 * sqrt(2 / 32) = 0.07.
    expect(minDetectableEffect(0.1, 8)).toBeCloseTo(0.14, 10)
    expect(minDetectableEffect(0.1, 32)).toBeCloseTo(0.07, 10)
    expect(minDetectableEffect(0.1, 1)).toBe(0)
    expect(minDetectableEffect(0, 8)).toBe(0)
    const a = aggregate([10, 12, 14, 16, 100].map((t) => ({ totalMs: t, tickMs: [t] })))
    expect(a.spread).toBeCloseTo(0.2118, 4)
    // 2.8 * 0.2118 * sqrt(2 / 5) = 0.37508
    expect(a.minDetectable).toBeCloseTo(0.3751, 3)
  })
  it('counts the runs whose clock drifted', () => {
    // 6 / 97 = 6.2% drifts, 4 / 98 = 4.1% does not.
    expect(clockDrift({ before: 100, after: 94 })).toBeCloseTo(0.0619, 4)
    expect(clockDrift({ before: 100, after: 96 })).toBeCloseTo(0.0408, 4)
    const r = (before: number, after: number) => ({ totalMs: 10, tickMs: [10], clock: { before, after } })
    expect(aggregate([r(100, 94), r(100, 96), r(94, 100)]).unstable).toBe(2)
    expect(aggregate([{ totalMs: 10, tickMs: [10] }]).unstable).toBeUndefined()
    expect(aggregate([r(100, 94), r(100, 96), r(94, 100)]).drift).toEqual({ median: clockDrift({ before: 100, after: 94 }), max: clockDrift({ before: 100, after: 94 }) })
    expect(aggregate([r(100, 100), r(100, 96)]).drift).toEqual({ median: clockDrift({ before: 100, after: 96 }) / 2, max: clockDrift({ before: 100, after: 96 }) })
    expect(aggregate([{ totalMs: 10, tickMs: [10] }]).drift).toBeUndefined()
  })
  it('rank test, shift and noise', () => {
    const a = [100, 101, 99, 102, 98, 100, 101, 99]
    expect(mannWhitney(a, a.map((x) => x * 1.1))).toBeLessThan(0.01)
    expect(mannWhitney(a, [...a].reverse())).toBeCloseTo(1)
    expect(hlRatio(a, a.map((x) => x * 1.1))).toBeCloseTo(1.1, 2)
    expect(relativeSpread([10, 10, 10])).toBe(0)
    expect(relativeSpread([9, 10, 11])).toBeCloseTo(0.14826)
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
    expect(FULL.deep).toBe(0)
    expect(planFor(undefined, true).deep).toBe(2)
    expect(planFor(3, false).deep).toBe(0)
    expect(planFor(3, true)).toMatchObject({ min: 3, max: 3, deep: 2 })
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

  it('downsamples frame times by bucket max so spikes survive', () => {
    const ticks = Array.from({ length: 1200 }, (_, i) => (i === 777 ? 50 : 1))
    const f = frameSeries(ticks)
    expect(f.bucket).toBe(2)
    expect(f.max).toHaveLength(600)
    expect(f.max[388]).toBe(50)
    expect(f.worst).toBe(50)
    expect(f.over).toBe(1)
    expect(frameSeries([1, 2, 3]).max).toEqual([1, 2, 3])
    const partial = frameSeries(Array(1201).fill(1))
    expect(partial.bucket).toBe(3)
    expect(partial.max.length).toBe(401)
    expect(partial.ticks).toBe(1201)
  })
  it('keeps the frames of the median-length run and a memory row for deep runs', () => {
    expect(pickMedianRun([{ totalMs: 1 }, { totalMs: 9 }, { totalMs: 5 }]).totalMs).toBe(5)
    const run = (t: number) => ({ totalMs: t, tickMs: [t, t] })
    expect(aggregate([run(1), run(3), run(2)]).frames?.max).toEqual([2, 2])
    const deep = { totalMs: 4, tickMs: [2, 2], deep: { phasesMs: {}, peakHeap: 2 ** 21, gcMs: 1, allocBytes: 2 ** 21, ticks: [[2, 0.5, 0, 0], [2, 0.25, 0, 0]] } }
    expect(aggregate([run(2)], [deep]).memory).toEqual({ runs: 1, peakHeapMB: 2, gcMs: 1, gcShare: 0.25, allocMBPerFrame: 1, overhead: 1, gcFrames: [0.5, 0.25], gcBucket: 1 })
    expect(aggregate([run(2)]).memory).toBeUndefined()
  })
})
