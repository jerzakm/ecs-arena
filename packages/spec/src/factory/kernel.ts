// Rule tables and pure rule functions of factory (SPEC-factory.md). Integer math only. No entity knowledge.
// It reuses the RTS fixed point and counter RNG. Every random draw has a named function here, so no impl builds a draw by hand.
import { FX, distSq, fx, isqrt, rand, randInt } from '../kernel.ts'
export { FX, distSq, fx, isqrt, rand, randInt }

/** The part of a scenario that the layout functions read. `FactoryScenario` extends it. */
export interface Layout {
  seed: number
  districtsX: number
  districtsY: number
  machinesPerDistrict: number
  /** The kinds of one block of slots. Slot `i` has kind `kindPattern[i % kindPattern.length]`. */
  kindPattern: readonly number[]
  /** Production lines in each district. Line `k` is the `k`-th machine of each kind. */
  lines: number
}

export const DISTRICT_TILES = 48
export const CAP = 8
export const MAX_SPEED = 256
export const ACCEL = 24
export const DOCK = 512
export const MAX_CARGO = 3
/** The district part of the gameId that a power draw uses (SPEC-factory §5.2). */
export const DISTRICT_BASE = 0x7fff0000

export const KIND = { EXTRACTOR: 0, SMELTER: 1, ASSEMBLER: 2, SINK: 3 } as const
export const ITEM = { NONE: 0, ORE: 1, PLATE: 2, GEAR: 3 } as const
export const PURPOSE = { BOOST: 1, OUTAGE: 2, DEPOT: 3, ROUTE: 4, MANUAL: 5 } as const

export interface Recipe { input: number; output: number; cycle: number }
export const RECIPES: readonly Recipe[] = [
  { input: ITEM.NONE, output: ITEM.ORE, cycle: 40 },
  { input: ITEM.ORE, output: ITEM.PLATE, cycle: 40 },
  { input: ITEM.PLATE, output: ITEM.GEAR, cycle: 40 },
  { input: ITEM.GEAR, output: ITEM.NONE, cycle: 40 },
]

/** The `output` of a machine at tick 0: an extractor starts full, so the world starts idle (SPEC-factory §5.1). */
export const startOutput = (kind: number): number => (kind === KIND.EXTRACTOR ? CAP : 0)

/** The local transform of every crate (SPEC-factory §3.3). (1021, 75) is the rotation by 3 of 256 steps. */
export const CRATE_LOCAL = { lx: -384, ly: 0, lc: 1021, ls: 75 } as const

/** Bits of the `flags` value in the snapshot. */
export const FLAG = { WORKING: 1, POWERED: 2, MANUAL: 4, BOOST: 8 } as const

export const districtCount = (s: Layout): number => s.districtsX * s.districtsY
export const machineCount = (s: Layout): number => districtCount(s) * s.machinesPerDistrict

const districtOf = (s: Layout, gameId: number): number => Math.floor((gameId - 1) / s.machinesPerDistrict)
const slotOf = (s: Layout, gameId: number): number => (gameId - 1) % s.machinesPerDistrict

export const kindOf = (s: Layout, gameId: number): number => s.kindPattern[slotOf(s, gameId) % s.kindPattern.length]

/** `[x, y]` of machine `gameId`: its slot on the 40-wide grid inside its district. */
export const slotPos = (s: Layout, gameId: number): [x: number, y: number] => {
  const d = districtOf(s, gameId)
  const slot = slotOf(s, gameId)
  const dx = d % s.districtsX
  const dy = Math.floor(d / s.districtsX)
  return [(dx * DISTRICT_TILES + 4 + (slot % 40)) * FX + FX / 2, (dy * DISTRICT_TILES + 4 + Math.floor(slot / 40)) * FX + FX / 2]
}

/** Every extractor is `Manual`. Any other machine is `Manual` on 1 draw in 8. */
export const manualOf = (s: Layout, gameId: number): boolean =>
  kindOf(s, gameId) === KIND.EXTRACTOR || randInt(8, s.seed, 0, gameId, PURPOSE.MANUAL) === 0

/** The `boost` of a machine in permille ticks of progress per tick. 0 for none. */
export const boostOf = (seed: number, gameId: number): number =>
  randInt(8, seed, 0, gameId, PURPOSE.BOOST, 0) === 0 ? 250 * (1 + randInt(4, seed, 0, gameId, PURPOSE.BOOST, 1)) : 0

export const depotPos = (s: Layout, d: number): [x: number, y: number] => {
  const dx = d % s.districtsX
  const dy = Math.floor(d / s.districtsX)
  return [(dx * DISTRICT_TILES + 24) * FX, (dy * DISTRICT_TILES + 46) * FX]
}

const blockSlotsCache = new WeakMap<readonly number[], readonly (readonly number[])[]>()

/** Slots of each kind inside one block of the pattern, in slot order. */
const blockSlots = (pattern: readonly number[]): readonly (readonly number[])[] => {
  let slots = blockSlotsCache.get(pattern)
  if (!slots) {
    slots = [0, 1, 2, 3].map((kind) => pattern.flatMap((k, slot) => (k === kind ? [slot] : [])))
    blockSlotsCache.set(pattern, slots)
  }
  return slots
}

/** The slot of the `n`-th machine (from 0) of `kind` in a district. */
const nthSlot = (s: Layout, kind: number, n: number): number => {
  const per = blockSlots(s.kindPattern)[kind]
  return Math.floor(n / per.length) * s.kindPattern.length + per[n % per.length]
}

/** `[extractor, smelter, assembler, sink]` gameIds of production line `line` of district `d`. */
export const lineMachines = (s: Layout, d: number, line: number): [number, number, number, number] => {
  const base = 1 + d * s.machinesPerDistrict
  return [base + nthSlot(s, 0, line), base + nthSlot(s, 1, line), base + nthSlot(s, 2, line), base + nthSlot(s, 3, line)]
}

/** `[source, sink]` gameIds of the drone `droneId` that spawns in district `d` at `tick`. */
export const route = (s: Layout, tick: number, droneId: number, d: number): [source: number, sink: number] => {
  const line = lineMachines(s, d, randInt(s.lines, s.seed, tick, droneId, PURPOSE.ROUTE, 0))
  const leg = randInt(3, s.seed, tick, droneId, PURPOSE.ROUTE, 1)
  return [line[leg], line[leg + 1]]
}

export const districtDown = (seed: number, tick: number, d: number, outagePermille: number): boolean =>
  randInt(1000, seed, tick, DISTRICT_BASE + d, PURPOSE.OUTAGE) < outagePermille

export const depotOf = (seed: number, tick: number, id: number, districts: number): number =>
  randInt(districts, seed, tick, id, PURPOSE.DEPOT)

/** Velocity toward a point with length `speed`. It is the whole offset when the point is nearer than `speed`. */
export const velToward = (x: number, y: number, tx: number, ty: number, speed: number): [number, number] => {
  const dx = tx - x, dy = ty - y
  const d2 = dx * dx + dy * dy
  if (d2 <= speed * speed) return [dx, dy]
  const d = isqrt(d2)
  return [fx.div(dx * speed, d), fx.div(dy * speed, d)]
}

const clampTo = (v: number, max: number): number => (v < 0 ? 0 : v > max ? max : v)
export const clampX = (s: Layout, v: number): number => clampTo(v, s.districtsX * DISTRICT_TILES * FX - 1)
export const clampY = (s: Layout, v: number): number => clampTo(v, s.districtsY * DISTRICT_TILES * FX - 1)

/** The world transform of a child at local `(lx, ly, lc, ls)` below a parent at `(px, py, pc, ps)`. Returns `[x, y, c, s]`. */
export const compose = (
  px: number, py: number, pc: number, ps: number, lx: number, ly: number, lc: number, ls: number,
): [number, number, number, number] => [
  px + fx.div(pc * lx - ps * ly, FX),
  py + fx.div(ps * lx + pc * ly, FX),
  fx.div(pc * lc - ps * ls, FX),
  fx.div(ps * lc + pc * ls, FX),
]

/** Adds `n` to a world value and wraps it into int32 (SPEC §1). */
export const wrap32 = (v: number, n: number): number => (v + n) | 0

export interface Totals {
  /** The last finished tick. It is -1 before the first tick. */
  tick: number
  nextId: number
  score: number
  picked: number
  delivered: number
  lost: number
}

export const newTotals = (): Totals => ({ tick: -1, nextId: 1, score: 0, picked: 0, delivered: 0, lost: 0 })

export interface Counts { powered: number; working: number; drones: number; crates: number }

/** The first 10 values of the snapshot (SPEC-factory §8 item 1). */
export const worldHeader = (t: Totals, c: Counts): number[] =>
  [t.tick, t.nextId, t.score, t.picked, t.delivered, t.lost, c.powered, c.working, c.drones, c.crates]
