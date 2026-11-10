// Idiomatic iris implementation of SPEC-factory.md. One system for each phase of the spec, in spec order.
// Machines, drones and crates are iris entities. Working, Powered and Manual are tags, a crate holds a `Parent` pair with the drone or
// crate below it, and `changed` finds the machines that `state` must look at.
import { defineSystem } from 'iris-ecs'
import { factory, type FactoryKernel, type Sim } from '@ecs-arena/spec'
import { flushEvents, runSystem } from '../shared/driver.ts'
import { createContext, type Ctx } from './context.ts'
import { load, save } from './save.ts'
import { snapshot } from './snapshot.ts'
import { build } from './systems/build.ts'
import { dock } from './systems/dock.ts'
import { move, steer } from './systems/drone.ts'
import { state, STATE, work } from './systems/machines.ts'
import { power } from './systems/power.ts'
import { shift } from './systems/shift.ts'
import { transform } from './systems/transform.ts'

const table: Record<factory.FPhase, (ctx: Ctx) => () => void> = { build, power, shift, steer, move, dock, work, state, transform }

const createSim = (scenario: factory.FactoryScenario, k: FactoryKernel): Sim<factory.FPhase> => {
  const ctx = createContext(scenario, k)
  const { world } = ctx
  const phases = Object.fromEntries(factory.PHASES.map((p) => {
    const tick = table[p](ctx)
    // `state` reads change windows, and the windows belong to the system that reads them: `save.ts` drains them under the same name.
    const system = defineSystem(p === 'state' ? STATE : `factory.${p}`, () => void tick())
    return [p, () => runSystem(world, system)]
  })) as Record<factory.FPhase, () => void>
  const last = phases.transform
  phases.transform = () => {
    last()
    flushEvents(world) // the last phase ends the frame
  }
  return { phases, snapshot: () => snapshot(ctx), save: () => save(ctx), load: (state) => load(ctx, state as ReturnType<typeof save>) }
}

export default createSim
