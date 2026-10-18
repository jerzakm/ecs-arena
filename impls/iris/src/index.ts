// Idiomatic iris implementation of SPEC.md. One system for each phase, in spec order.
// Units, projectiles, items and shrines are iris entities. gameId is a component, never the entity id.
import { createWorld } from 'iris-ecs'
import type { CreateSim, Scenario } from '@ecs-arena/spec'
import { createContext } from './context.ts'
import { flushEvents, runSystem } from './driver.ts'
import { load, save, type Saved } from './save.ts'
import { snapshot } from './snapshot.ts'
import { aiTargetSystem } from './systems/ai-target.ts'
import { cleanupSystem } from './systems/cleanup.ts'
import { combatSystem } from './systems/combat.ts'
import { effectsSystem } from './systems/effects.ts'
import { moraleSystem } from './systems/morale.ts'
import { moveStartSystem, moveSystem } from './systems/move.ts'
import { objectivesSystem } from './systems/objectives.ts'
import { spawnSystem } from './systems/spawn.ts'
import { statsSystem } from './systems/stats.ts'

const createSim: CreateSim = (scenario: Scenario, k) => {
  const world = createWorld()
  const ctx = createContext(world, scenario, k)
  const phase = (system: ReturnType<typeof spawnSystem>) => () => runSystem(world, system)
  const stats = statsSystem(ctx)
  return {
    phases: {
      spawn: phase(spawnSystem(ctx)),
      'ai/target': phase(aiTargetSystem(ctx)),
      move: phase(moveSystem(ctx)),
      combat: phase(combatSystem(ctx)),
      effects: phase(effectsSystem(ctx)),
      morale: phase(moraleSystem(ctx)),
      cleanup: phase(cleanupSystem(ctx)),
      objectives: phase(objectivesSystem(ctx)),
      stats: () => {
        runSystem(world, stats)
        flushEvents(world) // the last phase ends the frame
      },
    },
    moveStart: phase(moveStartSystem(ctx)),
    snapshot: () => snapshot(ctx),
    save: () => save(ctx),
    load: (state) => load(ctx, state as Saved),
  }
}

export default createSim
