import { addResource, createWorld, type EntityId, getComponentValue, hasComponent, registerObserverCallback, type World } from 'iris-ecs'
import type { Kernel, Scenario } from '@ecs-arena/spec'
import { GameId } from '../shared/components.ts'
import { HandleGrid } from '../shared/handle-grid.ts'
import { Clock, Metrics, NextId, Score } from './components.ts'
import { observeDirty } from './derived-stats.ts'

export interface Ctx {
  k: Kernel
  scenario: Scenario
  world: World // the resources Clock, NextId, Metrics and Score hold the singletons
  units: HandleGrid // the kernel grid and the handle table in front of it
  entityOf: Map<number, EntityId> // gameId -> live entity: every link field and list holds a gameId and resolves here
  dirty: Set<EntityId> // units whose derived stats may have changed
}

export const createContext = (scenario: Scenario, k: Kernel): Ctx => {
  const world = createWorld()
  addResource(world, Clock, { tick: -1 })
  addResource(world, NextId, { value: 1 })
  addResource(world, Metrics, {
    alive0: 0, alive1: 0, kills0: 0, kills1: 0, damage0: 0, damage1: 0, orders0: 0, orders1: 0, renderChain: 0x811c9dc5 | 0, winner: -1,
  })
  addResource(world, Score, { shrines0: 0, shrines1: 0 })

  const dirty = new Set<EntityId>()
  observeDirty(world, dirty)
  const units = new HandleGrid()
  const entityOf = new Map<number, EntityId>()
  // Observers keep the gameId map and the kernel grid current: they also see the minions that `ChildOf` destroys with their summoner.
  registerObserverCallback(world, 'componentAdded', (c, e) => {
    if (c === GameId) entityOf.set(getComponentValue(world, e, GameId, 'id')!, e)
  })
  registerObserverCallback(world, 'entityDestroying', (e) => {
    if (hasComponent(world, e, GameId)) entityOf.delete(getComponentValue(world, e, GameId, 'id')!)
    units.untrack(e)
  })
  return { k, scenario, world, units, entityOf, dirty }
}
