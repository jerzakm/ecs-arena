// Plain-JS reference implementation of SPEC-factory.md. One function per phase.
// Machines, drones and crates are plain objects in arrays that stay sorted by gameId. No ECS library.
import { factory, type FactoryKernel, type Sim } from '@ecs-arena/spec'
import { createContext, type Ctx } from './context.ts'
import { createLoad, createSave } from './save.ts'
import { snapshot } from './snapshot.ts'
import { build } from './systems/build.ts'
import { dock } from './systems/dock.ts'
import { move, steer } from './systems/drone.ts'
import { work, state } from './systems/machines.ts'
import { power } from './systems/power.ts'
import { shift } from './systems/shift.ts'
import { transform } from './systems/transform.ts'
import type { Counters, Regions } from '../shared/instrumentation.ts'
export type { Counters, Regions }

const table: Record<factory.FPhase, (ctx: Ctx) => () => void> = { build, power, shift, steer, move, dock, work, state, transform }

const createSim = (scenario: factory.FactoryScenario, k: FactoryKernel, counters?: Counters, regions?: Regions): Sim<factory.FPhase> => {
  const ctx = createContext(scenario, k, counters, regions)
  const phases = Object.fromEntries(factory.PHASES.map((p) => [p, table[p](ctx)])) as Record<factory.FPhase, () => void>
  return { phases, snapshot: () => snapshot(ctx), save: createSave(ctx), load: createLoad(ctx) }
}
export default createSim
