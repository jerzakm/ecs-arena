// Idiomatic koota implementation of SPEC.md (v2). One system function per phase, in spec order.
// Units, projectiles, items and shrines are koota entities. gameId is a trait, never the entity id.
import type { CreateSim, Scenario } from '@ecs-arena/spec'
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

const createSim: CreateSim = (scenario: Scenario, k) => {
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
    dispose: () => ctx.world.destroy(),
  }
}

export default createSim
