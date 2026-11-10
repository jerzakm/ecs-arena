import { factory, type FactoryKernel } from '@ecs-arena/spec'
import type { Counters, Regions } from '../shared/instrumentation.ts'
import { createChurn, type Churn } from './entities.ts'
import type { Crate, Drone, Machine } from './types.ts'

/** The context before the functions that the naive switches select are added to it. The factories of those functions take this type. */
export interface CtxData {
  k: FactoryKernel
  scenario: factory.FactoryScenario
  counters: Counters | undefined
  tick: number // the tick in progress. It advances at the end of `transform`
  totals: factory.kernel.Totals
  machines: Machine[] // index gameId - 1
  machineById: Map<number, Machine> // filled only when `work.step` is naive
  work: Machine[] // the machines with Working, in no order
  dirty: Machine[] // machines whose input, output or Powered changed in this tick
  changed: Machine[] // the machines of SPEC-factory §8 item 2, in no order until the snapshot sorts them
  districts: Machine[][] // district -> its machines
  up: boolean[] // district -> has power
  drones: Drone[] // ascending gameId
  droneById: Map<number, Drone>
  crates: Crate[] // ascending gameId, so a parent comes before its children
  // Instrumentation. Without a runner the hooks do nothing and no region is naive.
  nv: Record<factory.Region, boolean>
  add(name: string, n?: number): void
  begin(region: string): void
  end(region: string): void
}

export interface Ctx extends CtxData {
  churn: Churn
}

export const createContext = (scenario: factory.FactoryScenario, k: FactoryKernel, counters?: Counters, regions?: Regions): Ctx => {
  const isNaive = (region: factory.Region) => regions?.naive.has(region) ?? false
  const nv = Object.fromEntries(factory.REGIONS.map((region) => [region, isNaive(region)])) as Record<factory.Region, boolean>
  const data: CtxData = {
    k, scenario, counters, tick: 0, totals: k.newTotals(),
    machines: [], machineById: new Map(), work: [], dirty: [], changed: [],
    districts: Array.from({ length: k.districtCount(scenario) }, () => []), up: [],
    drones: [], droneById: new Map(), crates: [],
    nv,
    add: (name, n = 1) => counters?.add(name, n),
    begin: regions ? regions.begin : () => {},
    end: regions ? regions.end : () => {},
  }
  return Object.assign(data, { churn: createChurn(data) })
}
