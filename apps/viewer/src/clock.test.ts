import { describe, expect, it } from 'vitest'
import { advance, MAX_CATCHUP, tickIntervalMs } from './clock.ts'

describe('clock', () => {
  it('1x is 10 ticks/s, 4x is 40 ticks/s, max has no interval', () => {
    expect(tickIntervalMs('1x')).toBe(100)
    expect(tickIntervalMs('4x')).toBe(25)
    expect(tickIntervalMs('max')).toBe(0)
  })
  it('runs whole ticks and carries the remainder', () => {
    let r = advance(0, '1x', 250)
    expect(r).toEqual({ ticks: 2, acc: 50 })
    r = advance(r.acc, '1x', 50)
    expect(r).toEqual({ ticks: 1, acc: 0 })
  })
  it('runs no tick before the interval has elapsed', () => {
    expect(advance(0, '4x', 10)).toEqual({ ticks: 0, acc: 10 })
  })
  it('caps catch-up after a stall and drops the backlog', () => {
    const r = advance(0, '4x', 10_000)
    expect(r.ticks).toBe(MAX_CATCHUP)
    expect(r.acc).toBeLessThan(25)
  })
  it('max asks for unbounded ticks and keeps no accumulator', () => {
    expect(advance(7, 'max', 16)).toEqual({ ticks: Infinity, acc: 0 })
  })
})
