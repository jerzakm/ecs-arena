import type { Scenario } from './contract.ts'

const SEED = 0xec5a7e7a
const SMOKE_TICKS = 400
const base = [
  { name: 'skirmish', targetPop: 170, wavePeriod: 200, maxSquadsPerWave: 15, surgePeriod: 120, surgeBase: 3, surgeCap: 260, ticks: 2000 },
  { name: 'battle', targetPop: 1600, wavePeriod: 200, maxSquadsPerWave: 100, surgePeriod: 120, surgeBase: 20, surgeCap: 2400, ticks: 2000 },
  { name: 'war', targetPop: 8000, wavePeriod: 200, maxSquadsPerWave: 420, surgePeriod: 120, surgeBase: 100, surgeCap: 12000, ticks: 1000 },
]

export const SCENARIOS: Record<string, Scenario> = {}
for (const b of base) {
  SCENARIOS[b.name] = { ...b, seed: SEED }
  SCENARIOS[`${b.name}-smoke`] = { ...b, name: `${b.name}-smoke`, seed: SEED, ticks: SMOKE_TICKS }
}
