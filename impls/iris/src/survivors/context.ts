import {
  addResource, createEntity, createWorld, type EntityId, getComponentValue, hasComponent, registerObserverCallback, type World,
} from 'iris-ecs'
import { survivors, type SvKernel } from '@ecs-arena/spec'
import { GameId } from '../shared/components.ts'
import { HandleGrid } from '../shared/handle-grid.ts'
import { Player, PlayerHp, Position, Run } from './components.ts'
import { makeHeld } from './entities.ts'
import { createEvents, type Events } from './events.ts'
import { type Loadout, refreshLoadout } from './loadout.ts'

export interface Ctx {
  k: SvKernel
  scenario: survivors.SurvivorsScenario
  world: World // the resource Run holds the totals of the spec
  mobs: HandleGrid // the kernel grid and the handle table in front of it
  entityOf: Map<number, EntityId> // gameId -> live mob or player
  player: EntityId
  tick: number // the running tick: it advances in the last phase (stats.render)
  px: number // the player position of this tick, set by player.path
  py: number
  events: Events
  loadout: Loadout
}

/** The world at the start of a run: the player and the starting upgrades (SPEC-survivors §3.2). */
export const createContext = (scenario: survivors.SurvivorsScenario, k: SvKernel): Ctx => {
  const world = createWorld()
  addResource(world, Run, survivors.kernel.newTotals())
  const mobs = new HandleGrid()
  const entityOf = new Map<number, EntityId>()
  // Observers keep the gameId map and the kernel grid current: they also see the mobs that `ChildOf` removal leaves behind.
  registerObserverCallback(world, 'componentAdded', (c, e) => {
    if (c === GameId) entityOf.set(getComponentValue(world, e, GameId, 'id')!, e)
  })
  registerObserverCallback(world, 'entityDestroying', (e) => {
    if (hasComponent(world, e, GameId)) entityOf.delete(getComponentValue(world, e, GameId, 'id')!)
    mobs.untrack(e)
  })
  const [px, py] = k.playerPos(0)
  const player = createEntity(world, [Player, [GameId, { id: k.PLAYER_ID }], [Position, { x: px, y: py }], [PlayerHp, { hp: k.PLAYER_HP }]])
  entityOf.set(k.PLAYER_ID, player)
  const ctx: Ctx = {
    k, scenario, world, mobs, entityOf, player, tick: 0, px, py, events: createEvents(),
    loadout: { weapons: [], stats: k.deriveLoadout([]).stats },
  }
  for (const id of k.START_HELD) makeHeld(ctx, id, 1, 0)
  refreshLoadout(ctx)
  return ctx
}
