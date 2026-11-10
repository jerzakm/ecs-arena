// Idiomatic koota implementation of SPEC-survivors.md. One system function per system id, wired by the SYSTEMS table of the spec.
// Mobs, projectiles, pickups, particles and the weapon records of the player are koota entities. Status tags, affixes, projectile
// traits and what a kind can do are tags. gameId is a trait, never the entity id. Owners, targets and summoners are relations.
import { survivors, type CreateSim, type SvKernel } from '@ecs-arena/spec'
import { createContext, type Ctx } from './context.ts'
import { load, save, type Saved } from './save.ts'
import { snapshot } from './snapshot.ts'
import { aiSystems } from './systems/ai.ts'
import { cleanupSystems } from './systems/cleanup.ts'
import { combatSystems } from './systems/combat.ts'
import { moveSystems } from './systems/move.ts'
import { progressSystems } from './systems/progress.ts'
import { spawnSystems } from './systems/spawn.ts'
import { statsSystems } from './systems/stats.ts'
import { statusSystems } from './systems/status.ts'
import { weaponSystems } from './systems/weapons.ts'

const table: survivors.SystemTable<Ctx> = {
  ...spawnSystems, ...weaponSystems, ...aiSystems, ...moveSystems, ...combatSystems, ...statusSystems, ...cleanupSystems,
  ...progressSystems, ...statsSystems,
}

const createSim: CreateSim<survivors.SurvivorsScenario, SvKernel, survivors.SvPhase> = (scenario, k) => {
  const ctx = createContext(scenario, k)
  return {
    phases: survivors.wirePhases(table, ctx),
    snapshot: () => snapshot(ctx),
    save: () => save(ctx),
    load: (state) => load(ctx, state as Saved),
    dispose: () => ctx.world.destroy(),
  }
}

export default createSim
