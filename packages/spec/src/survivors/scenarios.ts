// One rule set at three sizes, sized by live entity count.
// Rules do not change between sizes. Only caps and pace change. Tick counts are first guesses until a measured run.
import type { BaseScenario } from '../contract.ts'

export interface SurvivorsScenario extends BaseScenario {
  mobCap: number        // target live mobs (spawnPlan stops above it)
  spawnEvery: number    // ticks between packs
  eliteEvery: number
  bossEvery: number
  paceScale: number     // permille: mob unlock ticks (MOBS[].from) scale by this
  xpScale: number       // permille: xp needed per level
  particleScale: number // permille: burst sizes. The churn knob that costs no gameplay
  tagScale: number      // permille: tag durations scale by 1000 / tagScale, so a higher value gives more adds and removes per tick
  traitScale: number    // permille: trait bits per projectile, so the count of live projectile archetypes
}

const SEED = 0xec5a7e7a
const SMOKE_TICKS = 600
const base = [
  // peak live entities = mobCap + about 500 projectiles + 400 particles + 150 pickups: about 1.1k, 2.0k, 3.0k
  { name: 'grove',   mobCap: 450,  spawnEvery: 6, eliteEvery: 200, bossEvery: 900, paceScale: 800, xpScale: 900, particleScale: 400,  ticks: 3000, loadEvery: 50, tagScale: 4000, traitScale: 1000 },
  { name: 'thicket', mobCap: 1000, spawnEvery: 3, eliteEvery: 150, bossEvery: 900, paceScale: 700, xpScale: 800, particleScale: 500, ticks: 3000, loadEvery: 50, tagScale: 4000, traitScale: 1000 },
  { name: 'swarm',   mobCap: 1700, spawnEvery: 2, eliteEvery: 120, bossEvery: 900, paceScale: 600, xpScale: 700, particleScale: 500, ticks: 2400, loadEvery: 50, tagScale: 4000, traitScale: 1000 },
] as const

// Crossover sweep: config only, no new impl code, never on the board. 3 mob caps x 3 tag rates = 9 cells.
// Each cell has one golden (timing seed only), written by baseline-js with --write. The real churn per cell is the
// measured mean of the `tag.add`, `tag.remove` and `ttl.expire` counters, not the knob value.
const SWEEP_MOBS = [300, 900, 1700] as const
const SWEEP_TAGS = [250, 1000, 4000] as const
const sweepCells: SurvivorsScenario[] = SWEEP_MOBS.flatMap((mobCap) => SWEEP_TAGS.map((tagScale) => ({
  ...base[1], name: `sweep-m${mobCap}-t${tagScale}`, seed: SEED, mobCap, tagScale, traitScale: 1000, ticks: 1200,
})))

export const SCENARIOS: Readonly<Record<string, SurvivorsScenario>> = Object.fromEntries([
  ...base.flatMap((b) => [
    [b.name, { ...b, seed: SEED }],
    // smoke: shorter, and faster pace and xp so late kinds and evolutions appear
    [`${b.name}-smoke`, { ...b, name: `${b.name}-smoke`, seed: SEED, ticks: SMOKE_TICKS, paceScale: 150, xpScale: 250, bossEvery: 200 }],
  ]),
  ...sweepCells.map((c) => [c.name, c]),
])
export const BOARD = ['grove', 'swarm'] as const
export const SMOKE = ['grove-smoke', 'thicket-smoke', 'swarm-smoke'] as const
export const SWEEP: readonly string[] = sweepCells.map((c) => c.name)
