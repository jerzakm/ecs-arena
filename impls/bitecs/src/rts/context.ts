import { createWorld, observe, onAdd, onRemove, type World } from 'bitecs'
import { SpatialGrid, type Kernel, type Scenario } from '@ecs-arena/spec'
import { CAP, Fleeing, Routed, Unit, Veteran } from './components.ts'
import { GameId } from '../shared/components.ts'
import { observeDirty } from './derived-stats.ts'
import { resetStores } from './relations.ts'

/** World-level values: the custom world context of bitECS (`createWorld(context)` returns the same object). `tick` is the running tick. */
export interface Resources {
  tick: number
  nextId: number
  score: { shrines0: number; shrines1: number }
  metrics: {
    alive0: number; alive1: number; kills0: number; kills1: number; damage0: number; damage1: number
    orders0: number; orders1: number; renderChain: number; winner: number
  }
}

export const initialResources = (): Resources => ({
  tick: -1,
  nextId: 1,
  score: { shrines0: 0, shrines1: 0 },
  metrics: {
    alive0: 0, alive1: 0, kills0: 0, kills1: 0, damage0: 0, damage1: 0, orders0: 0, orders1: 0, renderChain: 0x811c9dc5 | 0, winner: -1,
  },
})

export interface Ctx {
  k: Kernel
  scenario: Scenario
  world: World<Resources>
  grid: SpatialGrid // handle: entity id
  inGrid: Uint8Array // grid handle -> the unit is in the grid (a garrisoned unit is not)
  unitById: Map<number, number> // gameId -> unit, for the keys of commander orders (SPEC 6.12)
  dirty: Set<number> // units whose derived stats may have changed
  destroyed: Set<number> // entities removed since the last sweep of links that name them (workarounds.ts)
  killsChanged: Set<number> // units whose KillCount was set (the onSet observer)
  newlyRouted: number[] // entities that got Routed, Fleeing or Veteran since the phase that reads them last drained the list
  newlyFleeing: number[]
  newlyVeteran: number[]
}

/** The observers of one world. A fresh world (and `resetWorld`) has none, so `load` calls this again. */
export const observeWorld = (ctx: Ctx) => {
  const { world, grid, inGrid, unitById } = ctx
  observeDirty(ctx)
  observe(world, onAdd(Routed), (e) => void ctx.newlyRouted.push(e))
  observe(world, onAdd(Fleeing), (e) => void ctx.newlyFleeing.push(e))
  observe(world, onAdd(Veteran), (e) => void ctx.newlyVeteran.push(e))
  // The kernel grid and the gameId lookup lose a unit when it is removed, also when the minion cascade of `destroyEntity` removes it.
  observe(world, onRemove(Unit), (e) => {
    if (inGrid[e]) { grid.remove(e); inGrid[e] = 0 }
    unitById.delete(GameId.id[e])
  })
}

export const createContext = (scenario: Scenario, k: Kernel): Ctx => {
  if (k.CHRONICLE_MAX > 8) throw new Error('Chronicle store holds 8 entries')
  resetStores()
  const world = createWorld<Resources>(initialResources())
  const ctx: Ctx = {
    k,
    scenario,
    world,
    grid: new SpatialGrid(),
    inGrid: new Uint8Array(CAP),
    unitById: new Map(),
    dirty: new Set(),
    destroyed: new Set(),
    killsChanged: new Set(),
    newlyRouted: [],
    newlyFleeing: [],
    newlyVeteran: [],
  }
  observeWorld(ctx)
  return ctx
}
