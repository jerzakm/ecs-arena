import { describe, expect, it } from 'vitest'
import { newTotals, worldHeader } from './totals.ts'
import { SNAPSHOT } from './render.ts'

describe('survivors totals', () => {
  it('writes one header value per SNAPSHOT.WORLD field, the tick first', () => {
    const t = newTotals()
    expect(t.tick).toBe(-1)
    expect(worldHeader(t)).toHaveLength(SNAPSHOT.WORLD.length)
    expect(worldHeader(t)[0]).toBe(-1)
  })
})
