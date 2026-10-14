import type { Scenario } from './contract.ts'

const SEED = 0xec5a7e7a // SEEDS[0]
const SMOKE_TICKS = 400
const base = [
  { name: 'skirmish', targetPop: 170, wavePeriod: 200, maxSquadsPerWave: 15, surgePeriod: 120, surgeBase: 3, surgeCap: 260, garrisonCap: 8, ordersPerTeam: 8, ticks: 2000 },
  { name: 'battle', targetPop: 1600, wavePeriod: 200, maxSquadsPerWave: 100, surgePeriod: 120, surgeBase: 20, surgeCap: 2400, garrisonCap: 32, ordersPerTeam: 32, ticks: 2000 },
  { name: 'war', targetPop: 8000, wavePeriod: 200, maxSquadsPerWave: 420, surgePeriod: 120, surgeBase: 100, surgeCap: 12000, garrisonCap: 128, ordersPerTeam: 128, ticks: 1000 },
]

export const SCENARIOS: Record<string, Scenario> = {}
for (const b of base) {
  SCENARIOS[b.name] = { ...b, seed: SEED }
  SCENARIOS[`${b.name}-smoke`] = { ...b, name: `${b.name}-smoke`, seed: SEED, ticks: SMOKE_TICKS }
}

/** SPEC §11: timing uses `SEEDS[0]` (the seed of every `SCENARIOS` entry). Verify and the load budget use all of them. */
export const SEEDS = [0xec5a7e7a, 0x5eed0002, 0x5eed0003]

export const withSeed = (s: Scenario, i: number): Scenario => ({ ...s, seed: SEEDS[i] })

/** Seed 1 keeps the plain golden name, the others get `.s2`, `.s3`. */
export const goldenFile = (name: string, i: number): string => (i === 0 ? `${name}.json` : `${name}.s${i + 1}.json`)
