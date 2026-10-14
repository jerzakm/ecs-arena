import { describe, expect, it } from 'vitest'
import { lineChart } from './results.ts'

describe('lineChart', () => {
  it('keeps about one point per 2px and always keeps the last tick', () => {
    const ys = Array.from({ length: 2000 }, (_, i) => i)
    const pts = lineChart('t', 'ms', [{ name: 'a', slot: 0, ys }]).match(/points="([^"]*)"/)![1].split(' ')
    expect(pts.length).toBeLessThan(400)
    expect(pts.at(-1)!.startsWith('704.0,')).toBe(true)
  })
})
