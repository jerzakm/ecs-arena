import type { Scenario } from './contract.ts'

const SEED = 0xec5a7e7a
const base = [
  { name: 'skirmish', targetPop: 250, wavePeriod: 200, maxSquadsPerWave: 20, ticks: 2000 },
  { name: 'battle', targetPop: 2500, wavePeriod: 200, maxSquadsPerWave: 150, ticks: 2000 },
  { name: 'war', targetPop: 12500, wavePeriod: 200, maxSquadsPerWave: 600, ticks: 1000 },
]

export const SCENARIOS: Record<string, Scenario> = {}
for (const b of base) {
  SCENARIOS[b.name] = { ...b, seed: SEED }
  SCENARIOS[`${b.name}-smoke`] = { ...b, name: `${b.name}-smoke`, seed: SEED, ticks: 100 }
}
