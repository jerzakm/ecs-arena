import { describe, it, expect } from 'vitest'
import { PHASES, SCENARIOS, hashState, kernel } from '@ecs-arena/spec'
import createSim from '../../impls/baseline-js/src/index.ts'
import { runScheduled } from './schedule.ts'
import { REGIONS } from './budget.ts'

const TICKS = 500 // past tick 417, where cleanup.unlink once changed the hash
const hashes = (naive: string | null): string[] => {
  const sc = { ...SCENARIOS.skirmish, targetPop: 170, maxSquadsPerWave: 15, surgeBase: 3, surgeCap: 260, ticks: TICKS, loadTick: 362 } // one save at 350, one load, a replay
  const regions = { begin() {}, end() {}, naive: new Set(naive ? [naive] : []) }
  const sim = createSim(sc, kernel, undefined, regions)
  const out: string[] = []
  runScheduled(sim, sc, {
    tick: () => { for (const p of PHASES) sim.phases[p]() },
    after: (t) => { if (t % 5 === 0) out.push(hashState(sim.snapshot())) },
  })
  return out
}

describe('naive variants', () => {
  const base = hashes(null)
  for (const r of REGIONS) it(`${r} keeps the hash`, () => expect(hashes(r)).toEqual(base))
})
