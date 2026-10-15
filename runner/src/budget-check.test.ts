import { describe, expect, it } from 'vitest'
import { CAP, FLOOR, MIN_NAIVE_RATIO, exitCode, judge, passes, summarize } from './budget-check.ts'

describe('load budget verdicts', () => {
  it('passes inside the band, at the edges and with a naive ratio of at least the minimum', () => {
    expect(passes(judge(0.1, 0.1, 2))).toBe(true)
    expect(passes(judge(0.001, FLOOR, MIN_NAIVE_RATIO))).toBe(true)
    expect(passes(judge(CAP, 0.1, Infinity))).toBe(true)
  })
  it('fails each check on its own', () => {
    expect(judge(0.1, FLOOR - 0.001, 2)).toEqual({ floor: false, cap: true, ratio: true })
    expect(judge(CAP + 0.001, 0.1, 2)).toEqual({ floor: true, cap: false, ratio: true })
    expect(judge(0.1, 0.1, MIN_NAIVE_RATIO - 0.01)).toEqual({ floor: true, cap: true, ratio: false })
  })
  it('judges the floor on the naive share and the cap on the normal share (D20)', () => {
    expect(judge(0.001, 0.05, 2).floor).toBe(true)
    expect(judge(0.3, 0.001, 2)).toMatchObject({ floor: false, cap: false })
  })
  it('exits non-zero on a failure unless only reporting', () => {
    const bad = judge(0.1, 0.001, 2)
    expect(exitCode([judge(0.1, 0.1, 2), bad], false)).toBe(1)
    expect(exitCode([judge(0.1, 0.1, 2), bad], true)).toBe(0)
    expect(exitCode([judge(0.1, 0.1, 2)], false)).toBe(0)
  })
  it('summarizes a sample by median and range', () => {
    expect(summarize([5, 1, 3])).toEqual({ median: 3, min: 1, max: 5 })
    expect(summarize([4, 1, 2, 10])).toEqual({ median: 3, min: 1, max: 10 })
  })
})
