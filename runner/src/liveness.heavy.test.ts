import { describe, it, expect } from 'vitest'
import { SCENARIOS, SEEDS, withSeed } from '@ecs-arena/spec'
import { deadRules } from './liveness.ts'
import { profile } from './profile.ts'

// Smoke scenarios, every seed, without the late rules. `pnpm run profile skirmish battle war` checks every rule on the full scenarios.
describe('facet liveness', () => {
  for (const name of ['skirmish-smoke', 'battle-smoke', 'war-smoke']) {
    SEEDS.forEach((_, i) => it(`${name} seed ${i + 1} activates every rule`, () => {
      expect(deadRules(profile(withSeed(SCENARIOS[name], i)).counts, true)).toEqual([])
    }))
  }
  it('reports a rule whose counter is 0', () => {
    expect(deadRules({}).length).toBeGreaterThan(10)
  })
})
