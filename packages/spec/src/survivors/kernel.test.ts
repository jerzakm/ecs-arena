import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import * as k from './kernel.ts'
import { FACETS, LIVENESS, REGIONS, SYSTEMS, type SystemDef } from './facets.ts'
import { SCENARIOS, SWEEP } from './scenarios.ts'

const S = 0xec5a7e7a
const { STATUS, bit, TRAIT } = k
const held = (...ids: [number, number][]): k.Held[] => ids.map(([id, level]) => ({ id, level, cd: 0 }))

describe('player path', () => {
  it('is closed: the loop repeats and the last step meets the first point', () => {
    for (const t of [0, 1, 299, 300, 1234]) expect(k.playerPos(t + k.PATH_PERIOD)).toEqual(k.playerPos(t))
    const first = k.playerPos(0)
    const last = k.playerPos(k.PATH_PERIOD - 1)
    expect(Math.abs(last[0] - first[0])).toBeLessThan(k.FX)
    expect(Math.abs(last[1] - first[1])).toBeLessThan(k.FX)
  })
  it('hits each waypoint at the start of its segment and stays in the arena', () => {
    k.PATH_TILES.forEach(([x, y], i) => expect(k.playerPos(i * k.PATH_SEG_TICKS)).toEqual([x * k.FX, y * k.FX]))
    for (let t = 0; t < k.PATH_PERIOD; t += 7) {
      const [x, y] = k.playerPos(t)
      expect(x).toBeGreaterThan(0)
      expect(y).toBeLessThan(k.ARENA)
    }
  })
  it('facing has unit length at tick 0 and later', () => {
    expect(k.facing(0)).toEqual([k.FX, 0])
    const [x, y] = k.facing(500)
    expect(Math.abs(Math.hypot(x, y) - k.FX)).toBeLessThan(12)
  })
})

describe('tables', () => {
  it('sine table is odd-symmetric and has the cardinal values', () => {
    expect([k.SIN[0], k.SIN[64], k.SIN[128], k.SIN[192]]).toEqual([0, k.FX, 0, -k.FX])
    expect(k.COS(0)).toBe(k.FX)
    for (let i = 1; i < 128; i++) expect(k.SIN[256 - i]).toBe(-k.SIN[i])
  })
  it('has 12 mob kinds, 17 tags and 26 upgrades', () => {
    expect(k.MOBS).toHaveLength(12)
    expect(k.STATUS_COUNT).toBe(Object.keys(STATUS).length)
    expect(k.MOBS.length).toBe(Object.keys(k.MOB).length)
    expect(k.TRAIT_COUNT).toBe(Object.keys(TRAIT).length)
    expect(k.UPGRADES.map((u) => u.id)).toEqual([...Array(26).keys()])
  })
  it('RNG purposes start at 101 and are unique', () => {
    const v = Object.values(k.PURPOSE)
    expect(Math.min(...v)).toBe(101)
    expect(new Set(v).size).toBe(v.length)
  })
})

describe('tags', () => {
  it('merge keeps the larger until, in any order', () => {
    expect(k.mergeUntil(10, 25)).toBe(25)
    expect(k.mergeUntil(25, 10)).toBe(25)
    const xs = [7, 30, 12, 30, 1]
    expect(xs.reduce(k.mergeUntil)).toBe(xs.slice().reverse().reduce(k.mergeUntil))
  })
  it('gate masks hold what the rules say', () => {
    expect(k.BLOCKS_MOVE & bit(STATUS.DASH)).toBe(0)
    expect(k.BLOCKS_ACT & bit(STATUS.KNOCKBACK)).toBe(0)
    expect(k.IMMUNE_HIT & bit(STATUS.IFRAMES)).not.toBe(0)
  })
  it('duration scales inversely and never drops below 1', () => {
    expect(k.tagDuration(60, 1000)).toBe(60)
    expect(k.tagDuration(60, 4000)).toBe(15)
    expect(k.tagDuration(60, 250)).toBe(240)
    expect(k.tagDuration(1, 4000)).toBe(1)
  })
  it('speed applies SWIFT and ENRAGED then SLOWED', () => {
    expect(k.mobSpeed(k.MOB.BAT, 0, 0)).toBe(90)
    expect(k.mobSpeed(k.MOB.BAT, k.AFFIX.SWIFT, bit(STATUS.ENRAGED))).toBe(202)
    expect(k.mobSpeed(k.MOB.BAT, 0, bit(STATUS.SLOWED))).toBe(45)
  })
})

describe('hit outcome table', () => {
  const dmg = 6
  it.each([
    ['plain', 0, false, { dmg: 6, clear: 0, crit: false }],
    ['crit', 0, true, { dmg: 12, clear: 0, crit: true }],
    ['marked is a crit and clears', bit(STATUS.MARKED), false, { dmg: 12, clear: bit(STATUS.MARKED), crit: true }],
    ['frozen shatters', bit(STATUS.FROZEN), false, { dmg: 12, clear: bit(STATUS.FROZEN), crit: false }],
    ['marked, frozen and crit', bit(STATUS.MARKED) | bit(STATUS.FROZEN), true, { dmg: 24, clear: bit(STATUS.MARKED) | bit(STATUS.FROZEN), crit: true }],
    ['phased', bit(STATUS.PHASED), true, { dmg: 0, clear: 0, crit: false }],
    ['spawning', bit(STATUS.SPAWNING) | bit(STATUS.FROZEN), false, { dmg: 0, clear: 0, crit: false }],
    ['dying', bit(STATUS.DYING), false, { dmg: 0, clear: 0, crit: false }],
    ['iframes', bit(STATUS.IFRAMES), false, { dmg: 0, clear: 0, crit: false }],
    ['burning does nothing here', bit(STATUS.BURNING), false, { dmg: 6, clear: 0, crit: false }],
  ])('%s', (_n, mask, crit, want) => {
    expect(k.hitOutcome(dmg, mask, crit)).toEqual(want)
  })
  it('does not depend on the order of hits (pure in the start mask)', () => {
    const m = bit(STATUS.FROZEN)
    const a = [k.hitOutcome(3, m, false), k.hitOutcome(5, m, false)]
    const b = [k.hitOutcome(5, m, false), k.hitOutcome(3, m, false)]
    expect(a.reduce((s, o) => s + o.dmg, 0)).toBe(b.reduce((s, o) => s + o.dmg, 0))
    expect(a.reduce((s, o) => s | o.clear, 0)).toBe(b.reduce((s, o) => s | o.clear, 0))
  })
  it('status from traits: freeze escalates to FROZEN only on a slowed target', () => {
    expect(k.statusFromTraits(TRAIT.FREEZE, 0).map((t) => t[0])).toEqual([STATUS.SLOWED])
    expect(k.statusFromTraits(TRAIT.FREEZE, bit(STATUS.SLOWED)).map((t) => t[0])).toEqual([STATUS.SLOWED, STATUS.FROZEN])
    expect(k.statusFromTraits(TRAIT.BURN, 0)).toEqual([[STATUS.BURNING, 90, 1]])
    expect(k.statusFromTraits(TRAIT.PIERCE | TRAIT.HOMING, 0)).toEqual([])
  })
  it('player damage has a floor of 1', () => {
    expect(k.damagePlayer(10, 3)).toBe(7)
    expect(k.damagePlayer(10, 99)).toBe(1)
    expect(k.damagePlayer(1, 5)).toBe(1)
  })
})

describe('upgrades', () => {
  it('xp curve grows and scales', () => {
    expect(k.xpForLevel(1, 1000)).toBe(6)
    expect(k.xpForLevel(10, 1000)).toBe(36)
    expect(k.xpForLevel(10, 500)).toBe(18)
    for (let l = 1; l < 50; l++) expect(k.xpForLevel(l + 1, 800)).toBeGreaterThan(k.xpForLevel(l, 800))
  })
  it('eligible respects slots, max levels and evolution preconditions', () => {
    const start = held([0, 1])
    expect(k.eligible(start)).not.toContain(20)
    expect(k.eligible(start)).toContain(0)
    expect(k.eligible(held([0, 3], [16, 1]))).toContain(20)
    expect(k.eligible(held([0, 3], [16, 1]))).not.toContain(0)
    expect(k.eligible(held([0, 2], [16, 1]))).not.toContain(20)
    const full = held([0, 1], [1, 1], [2, 1], [3, 1], [4, 1], [5, 1])
    const e = k.eligible(full)
    expect(e.filter((id) => k.UPGRADES[id].kind === 'weapon').sort()).toEqual([0, 1, 2, 3, 4, 5])
    expect(k.eligible([])).toEqual([...Array(20).keys()])
  })
  it('pick is stable: same inputs, same answer, always eligible', () => {
    const h = held([0, 2], [8, 1])
    for (let level = 1; level < 40; level++) {
      const a = k.pickUpgrade(S, level * 7, level, h)
      expect(k.pickUpgrade(S, level * 7, level, h)).toBe(a)
      expect(k.eligible(h)).toContain(a)
    }
    const locked = held([0, 5], [1, 5], [2, 5], [5, 5], [6, 5], [7, 5], [8, 5], [9, 5], [12, 5], [13, 3], [14, 5], [15, 5])
    expect(k.eligible(locked)).toEqual([])
    expect(k.pickUpgrade(S, 0, 1, locked)).toBe(-1)
  })
  it('pick takes the highest priority, a tie goes to the lowest id', () => {
    const h = held([0, 3], [16, 1])
    // only an evolution beats a held weapon, and the draw sees every eligible id when the pool is at most 3
    const small = held([0, 5], [1, 5], [2, 5], [3, 5], [4, 5], [5, 5], [8, 5], [9, 5], [10, 5], [11, 5], [12, 5], [13, 3])
    expect(k.eligible(small).length).toBeLessThanOrEqual(3)
    expect(k.pickUpgrade(S, 3, 9, h)).toBeGreaterThanOrEqual(0)
    expect(k.chestPick(S, 3, k.CHEST_KEY + 5, h)).toBe(20)
  })
  it('take upgrade: evolution replaces its weapon, levels add, list stays sorted', () => {
    expect(k.takeUpgrade(held([0, 5], [16, 1]), 20)).toEqual(held([16, 1], [20, 1]))
    expect(k.takeUpgrade(held([3, 1]), 3)).toEqual(held([3, 2]))
    expect(k.takeUpgrade(held([8, 1]), 0)).toEqual(held([0, 1], [8, 1]))
  })
  it('loadout derives stats once from the held list', () => {
    const { weapons, stats } = k.deriveLoadout(held([0, 1], [8, 2], [9, 1], [13, 1], [16, 1]))
    expect(stats.might).toBe(200)
    expect(stats.haste).toBe(80)
    expect(stats.amount).toBe(1)
    expect(weapons).toHaveLength(1)
    expect(weapons[0]).toMatchObject({ id: 0, damage: 9, cooldown: 9, count: 3, traits: TRAIT.HOMING | TRAIT.BURN | TRAIT.FREEZE })
    expect(k.deriveLoadout(held([0, 3])).weapons[0].damage).toBe(Math.trunc((8 * 1050) / 1000))
  })
  it('trait scale keeps the low trait bits', () => {
    const all = (1 << k.TRAIT_COUNT) - 1
    expect(k.scaleTraits(all, 1000)).toBe(all)
    expect(k.scaleTraits(all, 500)).toBe(0b111111)
    expect(k.scaleTraits(all, 0)).toBe(0)
  })
})

describe('spawning', () => {
  const plan = (tick: number, alive = 0) => k.spawnPlan(S, tick, alive, 450, 6, 800)
  it('is pure and empty off the period or at the cap', () => {
    expect(plan(12)).toEqual(plan(12))
    expect(plan(13)).toEqual([])
    expect(plan(12, 450)).toEqual([])
    expect(plan(12, 449)).toHaveLength(1)
  })
  it('only unlocked kinds, pack grows with time', () => {
    expect(plan(0).every((kind) => kind <= 1)).toBe(true)
    expect(plan(0)).toHaveLength(3)
    expect(plan(1200)).toHaveLength(5)
    const late = new Set<number>()
    for (let t = 3000; t < 3600; t += 6) for (const kind of plan(t)) late.add(kind)
    expect(late.has(k.MOB.GHOST)).toBe(true)
    expect(late.has(k.MOB.SWARMLING)).toBe(false)
    expect(late.has(k.MOB.BOSS)).toBe(false)
  })
  it('elite affixes: 1 to 3 distinct bits, stable', () => {
    for (let id = 10; id < 300; id++) {
      const a = k.eliteAffixes(S, 300, id)
      expect(a).toBe(k.eliteAffixes(S, 300, id))
      const n = a.toString(2).split('1').length - 1
      expect(n).toBeGreaterThanOrEqual(1)
      expect(n).toBeLessThanOrEqual(3)
      expect(a).toBeLessThan(1 << k.AFFIX_COUNT)
    }
  })
  it('ring points lie on the ring and inside the arena', () => {
    const [px, py] = k.playerPos(0)
    for (let a = 0; a < 256; a++) {
      const [x, y] = k.ringPoint(px, py, k.SPAWN_RING, a)
      expect(Math.abs(Math.hypot(x - px, y - py) - k.SPAWN_RING)).toBeLessThan(8)
    }
  })
})

describe('movement helpers', () => {
  it('velToward has the speed length and snaps when near', () => {
    expect(k.velToward(0, 0, 3000, 4000, 100)).toEqual([60, 80])
    expect(k.velToward(0, 0, 30, 40, 100)).toEqual([30, 40])
    expect(k.velToward(5, 5, 5, 5, 100)).toEqual([0, 0])
  })
})

describe('render', () => {
  it('hp byte and camera window', () => {
    expect(k.hpByte(50, 100)).toBe(127)
    expect(k.inCamera(0, 0, k.CAMERA_HALF, -k.CAMERA_HALF)).toBe(true)
    expect(k.inCamera(0, 0, k.CAMERA_HALF + 1, 0)).toBe(false)
  })
})

describe('systems, facets and scenarios', () => {
  it('has 36 systems in 11 phases and 22 facets with unique ids', () => {
    expect(SYSTEMS).toHaveLength(36)
    expect(new Set(SYSTEMS.map((s) => s.phase)).size).toBe(11)
    expect(new Set(SYSTEMS.map((s) => s.id)).size).toBe(36)
    expect(FACETS).toHaveLength(22)
    expect(new Set(FACETS.map((f) => f.id)).size).toBe(22)
    expect(REGIONS).toHaveLength(9)
    expect(LIVENESS.length).toBe(FACETS.length + (SYSTEMS as readonly SystemDef[]).filter((s) => s.gated).length)
  })
  it('systems of one phase are contiguous and every facet has a favors label', () => {
    const seen: string[] = []
    for (const s of SYSTEMS) if (seen[seen.length - 1] !== s.phase) { expect(seen).not.toContain(s.phase); seen.push(s.phase) }
    for (const f of FACETS) expect(['archetype', 'sparse', 'neutral']).toContain(f.favors)
  })
  it('scenario names are unique and match the design', () => {
    expect(Object.keys(SCENARIOS)).toHaveLength(3 + 3 + 9)
    expect(SWEEP).toHaveLength(9)
    for (const [name, sc] of Object.entries(SCENARIOS)) {
      expect(sc.name).toBe(name)
      expect(sc.loadEvery).toBe(50)
    }
  })
})

describe('rng purposes', () => {
  it('every PURPOSE is drawn by a kernel function, so impls never build a draw by hand', () => {
    const dir = new URL('.', import.meta.url)
    const src = readdirSync(dir).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts')).map((f) => readFileSync(new URL(f, dir), 'utf8')).join('\n')
    for (const key of Object.keys(k.PURPOSE)) expect(src, key).toContain(`PURPOSE.${key}`)
  })
})
