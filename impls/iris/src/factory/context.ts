import { addResource, createWorld, type EntityId, getComponentValue, hasComponent, registerObserverCallback, type World } from 'iris-ecs'
import { type factory, type FactoryKernel } from '@ecs-arena/spec'
import { GameId } from '../shared/components.ts'
import { Totals } from './components.ts'

export interface Ctx {
  k: FactoryKernel
  scenario: factory.FactoryScenario
  world: World // the resource Totals holds the totals of the spec
  tick: number // the running tick. It advances at the end of `transform`
  machineCount: number
  machines: EntityId[] // index gameId - 1
  districts: EntityId[][] // district -> its machines
  up: boolean[] // district -> has power
  entityOf: Map<number, EntityId> // gameId -> live drone or crate
  /** The values at the end of the last tick, 4 for each machine (input, output, progress, flags), for the changed list of SPEC-factory §8. */
  seen: Int32Array
  stamp: Int32Array // tick + 1 on which `state` last looked at the machine
  worked: number[] // gameIds of the machines that `work` stepped in this tick
  changed: number[] // gameIds of the machines of SPEC-factory §8 item 2, in no order until the snapshot sorts them
}

export const createContext = (scenario: factory.FactoryScenario, k: FactoryKernel): Ctx => {
  const world = createWorld()
  addResource(world, Totals, k.newTotals())
  const machineCount = k.machineCount(scenario)
  const entityOf = new Map<number, EntityId>()
  // Observers keep the gameId map current, and see the crates that a drone takes with it.
  registerObserverCallback(world, 'componentAdded', (c, e) => {
    if (c !== GameId) return
    const id = getComponentValue(world, e, GameId, 'id')!
    if (id > machineCount) entityOf.set(id, e)
  })
  registerObserverCallback(world, 'entityDestroying', (e) => {
    if (hasComponent(world, e, GameId)) entityOf.delete(getComponentValue(world, e, GameId, 'id')!)
  })
  return {
    k, scenario, world, tick: 0, machineCount, machines: [], districts: Array.from({ length: k.districtCount(scenario) }, () => []),
    up: [], entityOf, seen: new Int32Array(machineCount * 4).fill(-1), stamp: new Int32Array(machineCount), worked: [], changed: [],
  }
}
