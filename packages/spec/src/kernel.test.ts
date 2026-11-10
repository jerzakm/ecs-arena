import { describe, expect, it } from 'vitest'
import { FX, MAX_COORD, clampToArena, damage, distSq, fmix32, fx, isqrt, rand, randInt, stepToward, teamGameId, PURPOSE, volleyDamage } from './kernel.ts'
import { kernel, hashState, SCENARIOS } from './index.ts'

const S = 0xec5a7e7a

describe('rng (expected values from an independent python reference)', () => {
  it('fmix32', () => {
    expect(fmix32(0)).toBe(0)
    expect(fmix32(1)).toBe(0x514e28b7)
    expect(fmix32(0xdeadbeef)).toBe(0x0de5c6a9)
  })
  it('rand', () => {
    expect(rand(S, 0, 1, PURPOSE.CRIT)).toBe(0x541cb694)
    expect(rand(S, 5, teamGameId(1), PURPOSE.SQUAD_KIND, 3)).toBe(0x2e604107)
    expect(rand(S, 2000, 12345, PURPOSE.ITEM_KIND, 2)).toBe(0x3f3397e4)
  })
  it('randInt is rand % n and teamGameId offsets', () => {
    expect(randInt(100, S, 0, 1, PURPOSE.CRIT)).toBe(0x541cb694 % 100)
    expect(teamGameId(1)).toBe(0xffffff01)
  })
})

describe('isqrt', () => {
  it('small and edge values', () => {
    expect([0, 1, 2, 3, 4, 8, 9, 10].map(isqrt)).toEqual([0, 1, 1, 1, 2, 2, 3, 3])
  })
  it('exact near perfect squares up to 2^52 and below 2^53', () => {
    const ref = (n: number) => {
      let r = BigInt(Math.floor(Math.sqrt(n)))
      const b = BigInt(n)
      while (r * r > b) r--
      while ((r + 1n) * (r + 1n) <= b) r++
      return Number(r)
    }
    for (const s of [3, 1023, 65535, 1 << 20, 67108863, 67108864, 94906265]) {
      for (const n of [s * s - 1, s * s, s * s + 1]) {
        if (n >= 0 && n < 2 ** 53) expect(isqrt(n)).toBe(ref(n))
      }
    }
    expect(isqrt(2 ** 52)).toBe(2 ** 26)
    expect(isqrt(2 ** 52 - 1)).toBe(2 ** 26 - 1)
    expect(isqrt(2 ** 53 - 1)).toBe(94906265)
  })
})

describe('fx and distSq', () => {
  it('truncates toward zero', () => {
    expect(fx.div(7, 2)).toBe(3)
    expect(fx.div(-7, 2)).toBe(-3)
    expect(fx.mul(1536, 1536)).toBe(2304)
    expect(fx.mul(-1, 1)).toBe(0)
  })
  it('distSq is exact', () => {
    expect(distSq(0, 0, 3, 4)).toBe(25)
    expect(distSq(0, 0, MAX_COORD, MAX_COORD)).toBe(2 * MAX_COORD * MAX_COORD)
  })
})

describe('stepToward', () => {
  it('snaps when within a step (boundary inclusive)', () => {
    expect(stepToward(0, 0, 3, 4, 5)).toEqual([3, 4])
    expect(stepToward(0, 0, 3, 4, 6)).toEqual([3, 4])
  })
  it('steps by truncated components', () => {
    expect(stepToward(0, 0, 3, 4, 4)).toEqual([2, 3]) // d=5: trunc(12/5)=2, trunc(16/5)=3
    expect(stepToward(100, 100, 0, 0, 10)).toEqual([93, 93]) // d=141: trunc(-1000/141)=-7
  })
  it('clamps to the arena', () => {
    expect(stepToward(2, 0, -50, 0, 10)).toEqual([0, 0])
    expect(stepToward(MAX_COORD, 5, MAX_COORD + 100, 5, 1000)).toEqual([MAX_COORD, 5])
    expect(clampToArena(-1)).toBe(0)
  })
})

describe('damage', () => {
  it('floors at 1 and doubles on crit', () => {
    expect(damage(14, 4, false)).toBe(10)
    expect(damage(14, 4, true)).toBe(20)
    expect(damage(5, 9, false)).toBe(1)
    expect(damage(0, 2, true)).toBe(2)
  })
  it('halves a volley hit, truncating, and floors at 1', () => {
    expect(volleyDamage(14, 4, false)).toBe(5)
    expect(volleyDamage(15, 4, false)).toBe(5)
    expect(volleyDamage(10, 4, true)).toBe(6)
    expect(volleyDamage(1, 9, false)).toBe(1)
  })
})

describe('hash', () => {
  it('FNV-1a over LE bytes (python reference)', () => {
    expect(hashState([])).toBe('811c9dc5')
    expect(hashState([0x61])).toBe('f5e1d3e4')
    expect(hashState([1, 2, 3])).toBe('794671b5')
    expect(hashState([-1, 0x7fffffff, -2147483648])).toBe('b7baab2d')
  })
})

describe('tables', () => {
  it('namespace export, scenarios and unit ranges', () => {
    expect(kernel.FX).toBe(FX)
    expect(kernel.UNIT_STATS[0].range).toBe(1536)
    expect(SCENARIOS['battle'].ticks).toBe(2000)
    expect(SCENARIOS['war-smoke']).toMatchObject({ ticks: 400, targetPop: SCENARIOS['war'].targetPop, seed: S })
    expect(kernel.UNIT_STATS[kernel.KIND.WARLORD]).toMatchObject({ maxHp: 400, attack: 20, armor: 6, range: 1536, sight: 7.5 * FX, cooldown: 25, speed: 416 })
    expect(kernel.SQUADS[3].members).toEqual([0, 0, 4, 3])
    expect([0, 1, 2, 3, 4, 5, 6].map(kernel.shrineY)).toEqual([16, 48, 80, 112, 144, 176, 208].map((t) => t * FX))
    expect(PURPOSE.SURGE_KIND).toBe(7)
    expect(PURPOSE.SURGE_Y).toBe(8)
    expect(PURPOSE.ORDER_SUBJECT).toBe(9)
    expect(PURPOSE.ORDER_OBJECT).toBe(10)
    expect(kernel.ORDER_PERIOD).toBe(10)
    expect(Object.keys(SCENARIOS)).toHaveLength(6)
  })

describe('orderKey', () => {
  it('draws probe p of order k as 1 + randInt(n - 1, ..., role, k * ORDER_PROBES + p)', () => {
    for (const [n, tick, team, k, p] of [[2, 0, 0, 0, 0], [40, 10, 1, 3, 5], [100_000, 1990, 0, 127, 2]]) {
      for (const role of [PURPOSE.ORDER_SUBJECT, PURPOSE.ORDER_OBJECT]) {
        expect(kernel.orderKey(n, S, tick, team, role, k, p)).toBe(1 + randInt(n - 1, S, tick, teamGameId(team), role, k * kernel.ORDER_PROBES + p))
      }
    }
    expect(kernel.ORDER_PROBES).toBe(6)
  })
  it('stays in [1, n - 1] and is not constant', () => {
    const seen = new Set<number>()
    for (let k = 0; k < 40; k++) for (let p = 0; p < kernel.ORDER_PROBES; p++) {
      const key = kernel.orderKey(50, S, 10, 0, PURPOSE.ORDER_SUBJECT, k, p)
      expect(key).toBeGreaterThanOrEqual(1); expect(key).toBeLessThanOrEqual(49); seen.add(key)
    }
    expect(seen.size).toBeGreaterThan(30)
  })
})

describe('foldRender', () => {
  const independent = (chain: number, ints: number[]) => {
    const view = new DataView(new ArrayBuffer(4 * ints.length))
    ints.forEach((v, i) => view.setInt32(4 * i, v, true))
    let h = chain >>> 0
    for (let i = 0; i < 4 * ints.length; i++) h = Math.imul(h ^ view.getUint8(i), 0x01000193) >>> 0
    return h | 0
  }
  it('is FNV-1a over little-endian bytes and returns an int32', () => {
    const ints = [3, -1, 0x01020304, -(2 ** 31), 2 ** 31 - 1, 262143]
    expect(kernel.foldRender(kernel.RENDER_SEED, ints, ints.length)).toBe(independent(kernel.RENDER_SEED, ints))
    expect(kernel.foldRender(-5, ints, 2)).toBe(independent(-5, ints.slice(0, 2)))
    expect(kernel.RENDER_SEED).toBe(0x811c9dc5 | 0)
  })
  it('folds only the first n values and chains across calls', () => {
    const a = [7, 8, 9, 10]
    expect(kernel.foldRender(kernel.foldRender(kernel.RENDER_SEED, a, 2), a.slice(2), 2)).toBe(kernel.foldRender(kernel.RENDER_SEED, a, 4))
  })
})
})
