import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import * as k from './kernel.ts'
import { FACETS, LIVENESS, PHASES, REGIONS } from './facets.ts'
import { SCENARIOS } from './scenarios.ts'

const S = 0xec5a7e7a
const { works, mill } = SCENARIOS
/** `works` on a 4 by 4 grid of districts. */
const grid = { ...works, districtsX: 4, districtsY: 4 }
const layouts = { works, mill }

describe('machine layout', () => {
  it('names the machines of the first production lines of district 0', () => {
    expect(k.lineMachines(works, 0, 0)).toEqual([1, 2, 4, 7])
    expect(k.lineMachines(works, 0, 7)).toEqual([17, 29, 41, 63])
    expect(k.lineMachines(mill, 0, 0)).toEqual([1, 2, 3, 4])
    expect(k.lineMachines(mill, 0, 99)).toEqual([397, 398, 399, 400])
  })
  for (const [name, sc] of Object.entries(layouts)) {
    it(`${name}: gives each line one machine of each kind, in the district of the line`, () => {
      for (const d of [0, 3]) {
        for (let line = 0; line < sc.lines; line++) {
          const ids = k.lineMachines(sc, d, line)
          expect(ids.map((id) => k.kindOf(sc, id))).toEqual([0, 1, 2, 3])
          for (const id of ids) expect(Math.floor((id - 1) / sc.machinesPerDistrict)).toBe(d)
        }
      }
    })
    it(`${name}: uses no machine in two lines of a district`, () => {
      const ids = Array.from({ length: sc.lines }, (_, line) => k.lineMachines(sc, 3, line)).flat()
      expect(new Set(ids).size).toBe(4 * sc.lines)
    })
    it(`${name}: finds all machines of every line inside the district`, () => {
      for (let line = 0; line < sc.lines; line++) for (const id of k.lineMachines(sc, 0, line)) expect(id).toBeLessThanOrEqual(sc.machinesPerDistrict)
    })
  }
  it('puts every machine of mill on a line', () => {
    const on = new Set(Array.from({ length: mill.lines }, (_, line) => k.lineMachines(mill, 0, line)).flat())
    expect(on.size).toBe(mill.machinesPerDistrict)
  })
  it('puts slot 0 of district 0 at tile (4, 4) and slot 40 one row down', () => {
    expect(k.slotPos(grid, 1)).toEqual([4 * k.FX + k.FX / 2, 4 * k.FX + k.FX / 2])
    expect(k.slotPos(grid, 41)).toEqual([4 * k.FX + k.FX / 2, 5 * k.FX + k.FX / 2])
  })
  it('puts district 5 of a 4 wide grid at column 1 and row 1', () => {
    const [x, y] = k.slotPos(grid, 1 + 5 * grid.machinesPerDistrict)
    expect([x, y]).toEqual([(48 + 4) * k.FX + k.FX / 2, (48 + 4) * k.FX + k.FX / 2])
    expect(k.depotPos(grid, 5)).toEqual([(48 + 24) * k.FX, (48 + 46) * k.FX])
  })
  it('counts the machines', () => {
    expect(k.machineCount(mill)).toBe(1600)
    expect(k.machineCount(works)).toBe(150000)
  })
  it('keeps the whole district block inside the district and above the depot', () => {
    const [, y] = k.slotPos(grid, grid.machinesPerDistrict)
    expect(y).toBeLessThan(46 * k.FX)
  })
})

describe('kindOf and manualOf', () => {
  it('follows the kind pattern of the scenario by slot, also in a later district', () => {
    for (const sc of [works, mill]) {
      const n = sc.kindPattern.length
      for (let slot = 0; slot < 40; slot++) {
        expect(k.kindOf(sc, 1 + slot)).toBe(sc.kindPattern[slot % n])
        expect(k.kindOf(sc, 1 + 3 * sc.machinesPerDistrict + slot)).toBe(sc.kindPattern[slot % n])
      }
    }
  })
  it('makes every extractor Manual and about 1 in 8 of the others', () => {
    let others = 0
    let manual = 0
    for (let id = 1; id <= grid.machinesPerDistrict; id++) {
      if (k.kindOf(grid, id) === k.KIND.EXTRACTOR) expect(k.manualOf(grid, id)).toBe(true)
      else { others++; if (k.manualOf(grid, id)) manual++ }
    }
    expect(manual / others).toBeGreaterThan(0.09)
    expect(manual / others).toBeLessThan(0.16)
  })
  it('is a pure function of the seed and the gameId', () => {
    expect(k.manualOf(grid, 77)).toBe(k.manualOf({ ...grid }, 77))
    expect(k.boostOf(S, 123)).toBe(k.boostOf(S, 123))
  })
  it('gives a boost of 250 to 1000 on about 1 machine in 8, else 0', () => {
    let boosted = 0
    for (let id = 1; id <= 4000; id++) {
      const b = k.boostOf(S, id)
      if (b > 0) { boosted++; expect([250, 500, 750, 1000]).toContain(b) }
    }
    expect(boosted / 4000).toBeGreaterThan(0.09)
    expect(boosted / 4000).toBeLessThan(0.16)
  })
})

describe('routes', () => {
  for (const [name, sc] of Object.entries(layouts)) {
    it(`${name}: serves one leg of one line of its district, with the source before the sink`, () => {
      for (let id = 1000; id < 1200; id++) {
        const d = id % k.districtCount(sc)
        const [source, sink] = k.route(sc, 250, id, d)
        const lines = Array.from({ length: sc.lines }, (_, line) => k.lineMachines(sc, d, line))
        const line = lines.find((l) => l.includes(source))!
        expect(line.indexOf(sink)).toBe(line.indexOf(source) + 1)
        expect(k.RECIPES[k.kindOf(sc, source)].output).toBe(k.RECIPES[k.kindOf(sc, sink)].input)
      }
    })
    it(`${name}: uses every leg and many lines`, () => {
      const legs = new Set<number>()
      const lines = new Set<number>()
      for (let id = 1; id < 600; id++) {
        const [source] = k.route(sc, 0, id, 0)
        legs.add(k.kindOf(sc, source))
        lines.add(source)
      }
      expect([...legs].sort()).toEqual([0, 1, 2])
      expect(lines.size).toBeGreaterThan(20)
    })
  }
})

describe('draws', () => {
  it('takes districts down at about the outage rate', () => {
    let down = 0
    for (let t = 100; t < 100 * 200; t += 100) for (let d = 0; d < 16; d++) if (k.districtDown(S, t, d, 125)) down++
    expect(down / (199 * 16)).toBeGreaterThan(0.09)
    expect(down / (199 * 16)).toBeLessThan(0.16)
    expect(k.districtDown(S, 100, 3, 0)).toBe(false)
    expect(k.districtDown(S, 100, 3, 1000)).toBe(true)
  })
  it('picks a depot district in range', () => {
    for (let id = 1; id < 300; id++) expect(k.depotOf(S, 250, id, 16)).toBeLessThan(16)
  })
})

describe('geometry', () => {
  it('velToward has the speed length and snaps when near', () => {
    expect(k.velToward(0, 0, 3000, 4000, 100)).toEqual([60, 80])
    expect(k.velToward(0, 0, 30, 40, 100)).toEqual([30, 40])
  })
  it('clamps to the world', () => {
    expect(k.clampX(grid, -5)).toBe(0)
    expect(k.clampX(grid, 1e9)).toBe(4 * 48 * k.FX - 1)
    expect(k.clampY(SCENARIOS.works, 1e9)).toBe(10 * 48 * k.FX - 1)
  })
})

describe('compose', () => {
  it('is the offset when the parent is not rotated', () => {
    expect(k.compose(1000, 2000, k.FX, 0, -384, 0, 1021, 75)).toEqual([616, 2000, 1021, 75])
  })
  it('turns the offset with the parent', () => {
    const [x, y, c, s] = k.compose(0, 0, 0, k.FX, -384, 0, k.FX, 0)
    expect([x, y, c, s]).toEqual([0, -384, 0, k.FX])
  })
  it('chains three crates to a rotation of 9 of 256 steps', () => {
    const { lx, ly, lc, ls } = k.CRATE_LOCAL
    let node: [number, number, number, number] = [0, 0, k.FX, 0]
    for (let i = 0; i < 3; i++) node = k.compose(...node, lx, ly, lc, ls)
    const angle = Math.atan2(node[3], node[2])
    expect(Math.abs(angle - 3 * 3 * ((2 * Math.PI) / 256))).toBeLessThan(0.02)
    expect(node[0]).toBeLessThan(-1000)
  })
  it('truncates toward zero like fx.div', () => {
    expect(k.compose(0, 0, 1, 0, -1, 0, 1, 0)[0]).toBe(0)
  })
})

describe('totals', () => {
  it('wraps a world value into int32', () => {
    expect(k.wrap32(2147483647, 1)).toBe(-2147483648)
    expect(k.worldHeader(k.newTotals(), { powered: 16, working: 3, drones: 4, crates: 5 })).toEqual([-1, 1, 0, 0, 0, 0, 16, 3, 4, 5])
  })
})

describe('facets and scenarios', () => {
  it('has 9 phases, 10 regions and one liveness row for each facet', () => {
    expect(PHASES).toHaveLength(9)
    expect(REGIONS).toEqual(['work.query', 'work.step', 'work.tag', 'state.changed', 'power.toggle', 'drone.move', 'transform', 'churn', 'save', 'load'])
    expect(LIVENESS).toHaveLength(FACETS.length)
    expect(new Set(FACETS.map((f) => f.id)).size).toBe(FACETS.length)
    for (const f of FACETS) expect(['archetype', 'sparse', 'neutral']).toContain(f.favors)
  })
  it('names the scenarios and sizes them as the spec says', () => {
    expect(Object.keys(SCENARIOS)).toEqual(['mill', 'mill-smoke', 'works', 'works-smoke'])
    for (const [name, sc] of Object.entries(SCENARIOS)) {
      expect(sc.name).toBe(name)
      expect(sc.ticks).toBe(name.endsWith('-smoke') ? 400 : 1000)
      const kinds = [0, 1, 2, 3].map((kind) => sc.kindPattern.filter((x) => x === kind).length)
      expect(Math.min(...kinds)).toBeGreaterThan(0)
      const slotsForLines = sc.kindPattern.length * Math.ceil(sc.lines / Math.min(...kinds))
      expect(sc.machinesPerDistrict).toBeGreaterThanOrEqual(slotsForLines)
      expect(sc.machinesPerDistrict).toBeLessThanOrEqual(1600)
    }
  })
})

describe('rng purposes', () => {
  it('every PURPOSE is drawn by a kernel function, so impls never build a draw by hand', () => {
    const src = readFileSync(new URL('kernel.ts', import.meta.url), 'utf8')
    for (const key of Object.keys(k.PURPOSE)) expect(src, key).toContain(`PURPOSE.${key}`)
    expect(readdirSync(new URL('.', import.meta.url))).toContain('kernel.ts')
  })
})
