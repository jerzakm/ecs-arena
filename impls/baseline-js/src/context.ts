import { SpatialGrid, type CreateSim, type Scenario } from '@ecs-arena/spec'
import type { Counters, GroundItem, Projectile, Regions, Shrine, Unit } from './types.ts'

export type Kernel = Parameters<CreateSim>[1]

export const byGameId = (a: { gameId: number }, b: { gameId: number }) => a.gameId - b.gameId
export const BUFF_NAME = ['stun', 'burn', 'haste']

export interface Context {
  // Config
  k: Kernel
  scenario: Scenario
  counters: Counters | undefined
  grid: SpatialGrid
  // State
  units: Unit[]
  slots: Unit[] // grid handle -> unit
  freeSlots: number[]
  projectiles: Projectile[]
  groundItems: GroundItem[]
  readonly shrines: Shrine[]
  readonly unitById: Map<number, Unit>
  nextId: number
  tick: number // advances in the last phase (stats system)
  world: { tick: number; alive: number[]; kills: number[]; damage: number[]; winner: number; score: number[] }
  buffed: Set<Unit> // units with a buff running
  threatened: Set<Unit> // units that may hold Threat edges, emptied lazily
  targeters: Map<number, Set<Unit>> // gameId -> units that target it (inverse of Targets)
  minionsOf: Map<number, Unit[]> // summoner gameId -> minions in gameId order (inverse of ChildOf)
  prevFleeing: Set<Unit> // only kept by the naive morale.onFlee
  dirty: Set<Unit> // units whose items, buffs, kills or Veteran changed since the last stats phase
  // Helpers
  add(name: string, n?: number): void
  begin(region: string): void
  end(region: string): void
  isNaive(region: string): boolean
  retarget(u: Unit, t: number): void
  kindName(kind: number): string
  isStunned(u: Unit): boolean
  homeX(team: number): number
  inRange(ax: number, ay: number, bx: number, by: number, r: number): boolean
  targetOf(u: Unit): Unit | undefined
  parentOf(u: Unit): Unit | undefined
  depthOf(u: Unit): number
}

export const createContext = (scenario: Scenario, k: Kernel, counters?: Counters, regions?: Regions): Context => {
  const { distSq, KIND, BUFF } = k
  const unitById = new Map<number, Unit>()
  const targeters = new Map<number, Set<Unit>>()
  const noop = () => {}
  const ctx: Context = {
    k, scenario, counters,
    units: [],
    slots: [],
    freeSlots: [],
    projectiles: [],
    groundItems: [],
    shrines: [],
    unitById,
    nextId: 1,
    tick: 0,
    world: { tick: -1, alive: [0, 0], kills: [0, 0], damage: [0, 0], winner: -1, score: [0, 0] },
    buffed: new Set<Unit>(),
    threatened: new Set<Unit>(),
    targeters,
    minionsOf: new Map(),
    prevFleeing: new Set(),
    dirty: new Set<Unit>(),
    grid: new SpatialGrid(counters),
    add: (name, n = 1) => counters?.add(name, n),
    begin: regions ? regions.begin : noop,
    end: regions ? regions.end : noop,
    isNaive: (region) => regions?.naive.has(region) ?? false,
    retarget: (u, t) => {
      if (u.target !== -1) {
        const s = targeters.get(u.target)
        if (s) { s.delete(u); if (s.size === 0) targeters.delete(u.target) }
      }
      u.target = t
      if (t === -1) return
      const s = targeters.get(t)
      if (s) s.add(u)
      else targeters.set(t, new Set([u]))
    },
    kindName: (kind) => (kind === KIND.MINION ? 'minion' : kind === KIND.WARLORD ? 'warlord' : 'unit'),
    isStunned: (u) => u.buffs[BUFF.STUN] > 0,
    homeX: (team) => (team === 0 ? 0 : k.MAX_COORD),
    inRange: (ax, ay, bx, by, r) => distSq(ax, ay, bx, by) <= r * r,
    targetOf: (u) => (u.target === -1 ? undefined : unitById.get(u.target)),
    parentOf: (u) => unitById.get(u.memberOf !== -1 ? u.memberOf : u.childOf),
    depthOf: (u) => {
      let d = 0
      for (let p = ctx.parentOf(u); p; p = ctx.parentOf(p)) d++
      return d
    },
  }
  return ctx
}
