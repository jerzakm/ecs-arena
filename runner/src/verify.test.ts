import { describe, expect, it } from 'vitest'
import { SCENARIOS, PHASES, type CreateSim } from '@ecs-arena/spec'
import { firstDivergence, runTrace } from './verify.ts'

// Fake impl: state is [tick, counter]; `bugAt` makes the counter skip a tick from then on.
const fake = (bugAt: number): CreateSim => () => {
  let tick = -1
  let counter = 0
  const noop = () => {}
  return {
    phases: { ...(Object.fromEntries(PHASES.map((p) => [p, noop])) as Record<(typeof PHASES)[number], () => void>), spawn: () => { tick++; counter += tick >= bugAt ? 2 : 1 } },
    snapshot: () => [tick, counter],
  }
}

describe('runTrace / firstDivergence', () => {
  const sc = SCENARIOS['skirmish-smoke']
  it('has one hash per tick and is deterministic', () => {
    const a = runTrace(fake(Infinity), sc)
    expect(a).toHaveLength(sc.ticks)
    expect(runTrace(fake(Infinity), sc)).toEqual(a)
    expect(runTrace(fake(Infinity), sc, 7)).toEqual(a.slice(0, 7))
  })
  it('reports the first divergent tick', () => {
    const golden = runTrace(fake(Infinity), sc)
    expect(firstDivergence(runTrace(fake(Infinity), sc), golden)).toBe(-1)
    expect(firstDivergence(runTrace(fake(42), sc), golden)).toBe(42)
    expect(firstDivergence(golden.slice(0, 10), golden)).toBe(10)
  })
})
