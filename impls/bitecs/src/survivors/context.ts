import { createWorld, observe, onRemove, type World } from 'bitecs'
import { SpatialGrid, survivors, type SvKernel } from '@ecs-arena/spec'
import { Mob } from './components.ts'
import { GameId } from '../shared/components.ts'
import { spawnPlayer } from './entities.ts'
import { createEvents, type Events } from './events.ts'
import { type Loadout, refreshLoadout, spawnHeld } from './loadout.ts'

/** The world-level values: the custom context of bitECS (`createWorld(context)` returns the same object). `tick` is the running tick. */
export interface Resources { tick: number }

export interface Ctx {
  k: SvKernel
  scenario: survivors.SurvivorsScenario
  world: World<Resources>
  totals: survivors.kernel.Totals
  events: Events
  loadout: Loadout
  grid: SpatialGrid // handle: entity id
  mobById: Map<number, number> // gameId -> entity, for mobs
  player: number
  px: number; py: number // the player position of this tick, set by player.path
  doomed: number[] // entities to remove when the system ends. bitECS recycles ids at once, so a loop must not see a reused id.
}

/** The observers of one world. A fresh world (and `resetWorld`) has none, so `load` calls this again. */
export const observeWorld = (ctx: Ctx) => {
  // The kernel grid and the gameId lookup lose a mob when it is removed, also when the minion cascade removes it.
  observe(ctx.world, onRemove(Mob), (e) => { ctx.grid.remove(e); ctx.mobById.delete(GameId.id[e]) })
}

/** The world at the start of a run: the player and the starting upgrades (SPEC-survivors §3.2). */
export const createContext = (scenario: survivors.SurvivorsScenario, k: SvKernel): Ctx => {
  const ctx: Ctx = {
    k, scenario, world: createWorld<Resources>({ tick: 0 }), totals: survivors.kernel.newTotals(), events: createEvents(),
    loadout: { weapons: [], stats: k.deriveLoadout([]).stats }, grid: new SpatialGrid(), mobById: new Map(), player: -1, px: 0, py: 0,
    doomed: [],
  }
  observeWorld(ctx)
  const [x, y] = k.playerPos(0)
  spawnPlayer(ctx, x, y)
  for (const id of k.START_HELD) spawnHeld(ctx, { id, level: 1, cd: 0 })
  refreshLoadout(ctx)
  return ctx
}
