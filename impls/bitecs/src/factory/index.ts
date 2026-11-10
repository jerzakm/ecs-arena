// Idiomatic bitECS 0.4 implementation of SPEC-factory.md. One system function for each phase.
// Machines, drones and crates are entities. Working, Powered and Manual are tag components, the optional boost is a component that only some
// machines carry, and a crate has a depth tag and a `parent` link. The districts and the changed list are plain per-world data.
import { deleteWorld } from 'bitecs'
import { factory, type CreateSim, type FactoryKernel } from '@ecs-arena/spec'
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
  const phases = Object.fromEntries(factory.PHASES.map((p) => [p, table[p](ctx)])) as Record<factory.FPhase, () => void>
  return {
    phases,
    snapshot: () => snapshot(ctx),
    save: () => save(ctx),
    load: (state) => load(ctx, state as Saved),
    dispose: () => deleteWorld(ctx.world),
  }
}
export default createSim
