import { describe, expect, it } from 'vitest'
import { CAP, FLOOR, MIN_NAIVE_RATIO, exitCode, judge, passes } from './budget-check.ts'

describe('load budget verdicts', () => {
  it('passes inside the band, at the edges and with a naive ratio of at least the minimum', () => {
    expect(passes(judge(0.1, 2))).toBe(true)
    expect(passes(judge(FLOOR, MIN_NAIVE_RATIO))).toBe(true)
    expect(passes(judge(CAP, Infinity))).toBe(true)
  })
  it('fails each check on its own', () => {
    expect(judge(FLOOR - 0.001, 2)).toEqual({ floor: false, cap: true, ratio: true })
    expect(judge(CAP + 0.001, 2)).toEqual({ floor: true, cap: false, ratio: true })
    expect(judge(0.1, MIN_NAIVE_RATIO - 0.01)).toEqual({ floor: true, cap: true, ratio: false })
  })
  it('exits non-zero on a failure unless only reporting', () => {
    const bad = judge(0.001, 2)
    expect(exitCode([judge(0.1, 2), bad], false)).toBe(1)
    expect(exitCode([judge(0.1, 2), bad], true)).toBe(0)
    expect(exitCode([judge(0.1, 2)], false)).toBe(0)
  })
})
