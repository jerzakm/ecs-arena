import { createWorld, type Entity, type World } from 'koota'
import type { factory, FactoryKernel } from '@ecs-arena/spec'
import { createQueries, type Queries } from './queries.ts'
import { District, Lit, Totals } from './traits.ts'

/** A machine whose values differ from the end of the last tick, with the values the snapshot lists. */
export interface Changed { gameId: number; kind: number; input: number; output: number; progress: number; flags: number }

export interface Ctx {
  k: FactoryKernel
  scenario: factory.FactoryScenario
  world: World // the world trait Totals holds the singletons
  q: Queries
  machines: Entity[] // index gameId - 1. koota has no lookup by a user key
  districts: Entity[] // index district
  changed: Changed[] // the list of this tick, in no order until the snapshot sorts it
}

export const createContext = (scenario: factory.FactoryScenario, k: FactoryKernel): Ctx => {
  const world = createWorld(Totals)
  const q = createQueries()
  const districts = Array.from({ length: k.districtCount(scenario) }, (_, index) => world.spawn(District({ index }), Lit))
  const ctx: Ctx = { k, scenario, world, q, machines: [], districts, changed: [] }
  drainTrackers(ctx) // registers the trackers before the first tick
  return ctx
}

/** Reading a tracker resets it. `load` reads them all, so no event of the discarded ticks reaches the next tick. */
export const drainTrackers = ({ world, q }: Ctx): void => {
  world.query(q.ioAble); world.query(q.ioUnable); world.query(q.gained); world.query(q.lost)
}
