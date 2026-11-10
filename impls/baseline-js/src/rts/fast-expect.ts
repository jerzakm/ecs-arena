import { expect as vitestExpect } from 'vitest'

const same = (a: unknown, b: unknown) => Object.is(a, b) || JSON.stringify(a) === JSON.stringify(b)
const subset = (a: any, b: any) => Object.entries(b).every(([k, v]) => same(a?.[k], v))

/**
 * `expect` for loops that check every unit of every tick. A passing check costs a plain comparison.
 * A failing check calls the real vitest matcher, so the failure message is the usual one.
 */
export const expect = (actual: any) => {
  const real = () => vitestExpect(actual) as any
  const fast: Record<string, (...a: any[]) => void> = {
    toBe: (b) => { if (!Object.is(actual, b)) real().toBe(b) },
    toEqual: (b) => { if (!same(actual, b)) real().toEqual(b) },
    toMatchObject: (b) => { if (!subset(actual, b)) real().toMatchObject(b) },
    toBeGreaterThan: (b) => { if (!(actual > b)) real().toBeGreaterThan(b) },
    toBeGreaterThanOrEqual: (b) => { if (!(actual >= b)) real().toBeGreaterThanOrEqual(b) },
    toBeLessThan: (b) => { if (!(actual < b)) real().toBeLessThan(b) },
    toBeLessThanOrEqual: (b) => { if (!(actual <= b)) real().toBeLessThanOrEqual(b) },
    toContain: (b) => { if (!actual.includes(b)) real().toContain(b) },
    toHaveLength: (b) => { if (actual.length !== b) real().toHaveLength(b) },
  }
  const not = new Proxy({} as any, {
    get: (_, k: string) => (k === 'toBe' ? (b: unknown) => { if (Object.is(actual, b)) real().not.toBe(b) } : (...a: any[]) => real().not[k](...a)),
  })
  return new Proxy(fast, { get: (t, k: string) => (k === 'not' ? not : t[k] ?? ((...a: any[]) => real()[k](...a))) }) as any
}
