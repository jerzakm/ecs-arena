import { createWorld, type World } from 'bitecs'
import { factory, type FactoryKernel } from '@ecs-arena/spec'

/** The world-level values: the custom context of bitECS (`createWorld(context)` returns the same object). `tick` is the tick in progress. */
export interface Resources { tick: number }

export interface Ctx {
  k: FactoryKernel
  scenario: factory.FactoryScenario
  world: World<Resources>
  totals: factory.kernel.Totals
  machines: number[] // index gameId - 1: the machine entity
  districts: number[][] // district -> its machine entities
  up: boolean[] // district -> has power
  dirty: number[] // machines whose input, output or Powered changed in this tick
  changed: number[] // the machines of SPEC-factory §8 item 2, in no order until the snapshot sorts them
  doomed: number[] // entities to remove when the system ends. bitECS recycles ids at once, so a loop must not see a reused id.
}

export const createContext = (scenario: factory.FactoryScenario, k: FactoryKernel): Ctx => ({
  k, scenario, world: createWorld<Resources>({ tick: 0 }), totals: k.newTotals(), machines: [],
  districts: Array.from({ length: k.districtCount(scenario) }, () => []), up: [], dirty: [], changed: [], doomed: [],
})
