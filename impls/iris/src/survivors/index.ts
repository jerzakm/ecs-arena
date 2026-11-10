// Idiomatic iris implementation of SPEC-survivors.md. One system for each row of the SYSTEMS table of the spec, wired by that table.
// Mobs, projectiles, pickups, particles, status tags and held upgrades are iris entities. The spatial grid, the event lists and the
// loadout are plain per-world data, the same as the RTS impl keeps its unit grid.
import { defineSystem } from 'iris-ecs'
import { type Sim, survivors, type SvKernel } from '@ecs-arena/spec'
import { flushEvents, runSystem } from '../shared/driver.ts'
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

const createSim = (scenario: survivors.SurvivorsScenario, k: SvKernel): Sim<survivors.SvPhase> => {
  const ctx = createContext(scenario, k)
  const { world } = ctx
  const phases = survivors.wirePhases(table, ctx, (id, tick) => {
    const system = defineSystem(id, () => void tick())
    return () => runSystem(world, system)
  })
  const stats = phases.stats
  phases.stats = () => {
    stats()
    flushEvents(world) // the last phase ends the frame
  }
  return { phases, snapshot: () => snapshot(ctx), save: () => save(ctx), load: (state) => load(ctx, state as Saved) }
}

export default createSim
