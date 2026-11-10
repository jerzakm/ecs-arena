import { SpatialGrid, type Kernel, type Scenario } from '@ecs-arena/spec'
import type { Counters, Regions } from '../shared/instrumentation.ts'
import type { GroundItem, Projectile, Shrine, Unit } from './types.ts'

export interface Ctx {
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
  world: { tick: number; alive: number[]; kills: number[]; damage: number[]; winner: number; score: number[]; orders: number[]; renderChain: number }
  buffed: Set<Unit> // units with a buff running
  threatened: Set<Unit> // units that may hold Threat edges, emptied lazily
  targeters: Map<number, Set<Unit>> // gameId -> units that target it (inverse of Targets)
  minionsOf: Map<number, Unit[]> // summoner gameId -> minions in gameId order (inverse of ChildOf)
  members: Map<number, Unit[]> // parent gameId -> units with MemberOf to it in gameId order (inverse of MemberOf), kept by the normal links code
  veterans: Set<Unit> // units with the Veteran tag
  overwhelmed: Set<Unit> // units with the Overwhelmed tag, kept by the normal combat.fanIn
  prevFleeing: Set<Unit> // only kept by the naive morale.onFlee
  dirty: Set<Unit> // units whose items, buffs, kills or Veteran changed since the last stats phase
  // Instrumentation hooks. Without a runner they do nothing.
  add(name: string, n?: number): void
  begin(region: string): void
  end(region: string): void
  isNaive(region: string): boolean
}

export const createContext = (scenario: Scenario, k: Kernel, counters?: Counters, regions?: Regions): Ctx => {
  const begin = regions ? regions.begin : () => {}, end = regions ? regions.end : () => {}
  return {
    k, scenario, counters,
    units: [],
    slots: [],
    freeSlots: [],
    projectiles: [],
    groundItems: [],
    shrines: [],
    unitById: new Map(),
    nextId: 1,
    tick: 0,
    world: { tick: -1, alive: [0, 0], kills: [0, 0], damage: [0, 0], winner: -1, score: [0, 0], orders: [0, 0], renderChain: k.RENDER_SEED },
    buffed: new Set<Unit>(),
    threatened: new Set<Unit>(),
    targeters: new Map(),
    minionsOf: new Map(),
    members: new Map(),
    veterans: new Set<Unit>(),
    overwhelmed: new Set<Unit>(),
    prevFleeing: new Set(),
    dirty: new Set<Unit>(),
    grid: new SpatialGrid(counters),
    add: (name, n = 1) => counters?.add(name, n),
    begin,
    end,
    isNaive: (region) => regions?.naive.has(region) ?? false,
  }
}
