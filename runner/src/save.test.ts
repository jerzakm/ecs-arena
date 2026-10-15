import { describe, it, expect } from 'vitest'
import { PHASES, SCENARIOS, hashState, kernel, type CreateSim } from '@ecs-arena/spec'
import baseline from '../../impls/baseline-js/src/index.ts'
import koota from '../../impls/koota/src/index.ts'
import { runScheduled } from './schedule.ts'

const sc = SCENARIOS['skirmish-smoke']
const SAVE_AT = 150
const run = (sim: ReturnType<CreateSim>, from: number, to: number) => {
  for (let t = from; t < to; t++) for (const p of PHASES) sim.phases[p]()
}

// A save must not change when the world changes after it (SPEC §10 "deep copy").
describe.each([['baseline-js', baseline], ['koota', koota]] as const)('%s save', (_, createSim) => {
  it('is a deep copy: ticks after the save do not change what a load restores', () => {
    const sim = createSim(sc, kernel)
    run(sim, 0, SAVE_AT + 1)
    const atSave = hashState(sim.snapshot())
    const saved = sim.save()
    run(sim, SAVE_AT + 1, SAVE_AT + 61)
    expect(hashState(sim.snapshot())).not.toBe(atSave)
    sim.load(saved)
    expect(hashState(sim.snapshot())).toBe(atSave)
    // The world still runs and a second load of the same save gives the same state again.
    run(sim, SAVE_AT + 1, SAVE_AT + 31)
    sim.load(saved)
    expect(hashState(sim.snapshot())).toBe(atSave)
    const after = hashState((run(sim, SAVE_AT + 1, SAVE_AT + 61), sim.snapshot()))
    const fresh = createSim(sc, kernel)
    run(fresh, 0, SAVE_AT + 61)
    expect(after).toBe(hashState(fresh.snapshot()))
    sim.dispose?.()
    fresh.dispose?.()
  })

  it('runScheduled replays to the same final hash as a run without the load', () => {
    const plain = createSim({ ...sc, loadEvery: Infinity }, kernel)
    runScheduled(plain, { ...sc, loadEvery: Infinity }, { tick: () => run(plain, 0, 1) })
    const sim = createSim(sc, kernel)
    runScheduled(sim, sc, { tick: () => run(sim, 0, 1) })
    expect(hashState(sim.snapshot())).toBe(hashState(plain.snapshot()))
    plain.dispose?.()
    sim.dispose?.()
  })
})
