// Plain-JS reference implementation of SPEC-survivors.md. One function per system, wired by the SYSTEMS table of the spec.
// Mobs, projectiles, pickups and particles are plain objects in arrays that stay sorted by gameId. No ECS library.
// Array loops use an index, not for...of, in the hot paths (see ../index.ts).
import { survivors, type SvKernel, type Sim } from '@ecs-arena/spec'
import { createContext, type Ctx } from './context.ts'
import { refreshLoadout } from './loadout.ts'
import { createLoad, createSave } from './save.ts'
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
import type { Counters, Regions } from '../shared/instrumentation.ts'
export type { Counters, Regions }
const table: survivors.SystemTable<Ctx> = {
  ...spawnSystems, ...weaponSystems, ...aiSystems, ...moveSystems, ...combatSystems, ...statusSystems, ...cleanupSystems,
  ...progressSystems, ...statsSystems,
}
const createSim = (scenario: survivors.SurvivorsScenario, k: SvKernel, counters?: Counters, regions?: Regions): Sim<survivors.SvPhase> => {
  const ctx = createContext(scenario, k, counters, regions)
  ;[ctx.player.x, ctx.player.y] = k.playerPos(0)
  refreshLoadout(ctx, false)
  const phases = survivors.wirePhases(table, ctx)
  return { phases, snapshot: () => snapshot(ctx), save: createSave(ctx), load: createLoad(ctx) }
}
export default createSim
