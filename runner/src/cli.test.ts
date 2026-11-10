import { describe, expect, it } from 'vitest'
import { isBoard, outText, parseCli } from './bench.ts'
import { parseRuns } from './cli.ts'

describe('parseRuns', () => {
  it('passes a missing flag and a count', () => {
    expect(parseRuns(undefined)).toBeUndefined()
    expect(parseRuns('7')).toBe(7)
  })
  it.each(['0', '-2', 'abc', ''])('rejects %j', (text) => {
    expect(() => parseRuns(text)).toThrow('--runs needs a positive number')
  })
})

describe('parseCli', () => {
  it('keeps positionals apart from the value of --runs', () => {
    const { pos, plan } = parseCli(['koota', '--runs', '3', 'skirmish-smoke'])
    expect(pos).toEqual(['koota', 'skirmish-smoke'])
    expect(plan.min).toBe(3)
  })
})

describe('board and --out', () => {
  it('rejects an unknown --deep-scenarios value', () => {
    expect(() => parseCli(['koota', 'war', '--deep-scenarios', 'x'])).toThrow(/board or all/)
  })
  it('runs deep only on board scenarios with --deep-scenarios board', () => {
    const { deepFor } = parseCli(['koota', 'war', '--deep', '--deep-scenarios', 'board'])
    expect(['war', 'war-smoke', 'sweep-n'].map(deepFor)).toEqual([true, false, false])
    expect(isBoard('grove')).toBe(true)
  })
  it('strips only the per-tick deep matrix', () => {
    expect(JSON.parse(outText({ ticks: { war: 1000 }, deep: { ticks: [[1]] } }))).toEqual({ ticks: { war: 1000 }, deep: {} })
  })
})
