// Idiomatic bitECS 0.4 implementation of SPEC.md (v2). One system function per phase, in spec order.
// Components are SoA typed arrays, systems are plain functions over `query`, and the links between entities (hierarchy, targeting,
// ownership) are plain components that hold the target entity id (relations.ts), because bitECS relations cost too much for this workload.
// gameId is a component, never the entity id.
import { deleteWorld } from 'bitecs'
import type { CreateSim, Kernel, PhaseName, Scenario } from '@ecs-arena/spec'
import { createContext } from './context.ts'
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

const createSim: CreateSim<Scenario, Kernel, PhaseName> = (scenario: Scenario, k) => {
  const ctx = createContext(scenario, k)
  return {
    phases: {
      spawn: spawnSystem(ctx),
      'ai/target': aiTargetSystem(ctx),
      move: moveSystem(ctx),
      combat: combatSystem(ctx),
      effects: effectsSystem(ctx),
      morale: moraleSystem(ctx),
      cleanup: cleanupSystem(ctx),
      objectives: objectivesSystem(ctx),
      stats: statsSystem(ctx),
    },
    moveStart: moveStartSystem(ctx),
    snapshot: () => snapshot(ctx),
    save: () => save(ctx),
    load: (state) => load(ctx, state as Saved),
    dispose: () => deleteWorld(ctx.world),
  }
}

export default createSim
