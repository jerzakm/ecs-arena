// Idiomatic koota implementation of SPEC-factory.md. Machines, drones and crates are koota entities. Working, Powered and Manual are
// tags, Boost is an optional trait, and a crate is a child of its drone or of the crate below it. The changed machines come from the
// change trackers of koota. gameId is a trait, never the entity id.
import type { CreateSim, factory, FactoryKernel } from '@ecs-arena/spec'
import { factory as fa } from '@ecs-arena/spec'
import { createContext, type Ctx } from './context.ts'
import { load, save, type Saved } from './save.ts'
import { snapshot } from './snapshot.ts'
import { build } from './systems/build.ts'
import { dock } from './systems/dock.ts'
import { move, steer } from './systems/drone.ts'
import { state, work } from './systems/machines.ts'
import { power } from './systems/power.ts'
import { shift } from './systems/shift.ts'
import { transform } from './systems/transform.ts'

const table: Record<factory.FPhase, (ctx: Ctx) => () => void> = { build, power, shift, steer, move, dock, work, state, transform }

const createSim: CreateSim<factory.FactoryScenario, FactoryKernel, factory.FPhase> = (scenario, k) => {
  const ctx = createContext(scenario, k)
  return {
    phases: Object.fromEntries(fa.PHASES.map((p) => [p, table[p](ctx)])) as Record<factory.FPhase, () => void>,
    snapshot: () => snapshot(ctx),
    save: () => save(ctx),
    load: (state) => load(ctx, state as Saved),
    dispose: () => ctx.world.destroy(),
  }
}

export default createSim
