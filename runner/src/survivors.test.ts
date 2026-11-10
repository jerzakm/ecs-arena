import { describe, expect, it } from 'vitest'
import { SURVIVORS, hashState, survivors } from '@ecs-arena/spec'
import createSim from '../../impls/baseline-js/src/survivors/index.ts'
import { HARNESS } from './games.ts'
import { runScheduled } from './schedule.ts'
const k = SURVIVORS.kernel
const run = (sim: ReturnType<typeof createSim>) => {
  for (const p of SURVIVORS.phases) sim.phases[p]()
}
describe('survivors harness', () => {
  it('derives the regions and liveness rows from the facet and system tables', () => {
    expect(HARNESS.survivors.regions).toBe(survivors.REGIONS)
    expect(HARNESS.survivors.liveness).toBe(survivors.LIVENESS)
    expect(HARNESS.survivors.liveness.some((r) => r[3] !== undefined)).toBe(true)
  })
})
describe('survivors baseline-js', () => {
  const sc = { ...SURVIVORS.scenarios['swarm-smoke'], ticks: 420 } // loads at 199 and 399, a replay
  const hashes = (naive: string | null, scenario = sc): string[] => {
    const sim = createSim(scenario, k, undefined, { begin() {}, end() {}, naive: new Set(naive ? [naive] : []) })
    const out: string[] = []
    runScheduled(sim, scenario, { tick: () => run(sim), after: (t) => { if (t % 5 === 0) out.push(hashState(sim.snapshot())) } })
    return out
  }
  const base = hashes(null)
  for (const r of HARNESS.survivors.regions) it(`${r} keeps the hash`, () => expect(hashes(r)).toEqual(base))
  it('replays to the same final hash as a run without the load', () => {
    const plain = createSim({ ...sc, loadEvery: Infinity }, k)
    runScheduled(plain, { ...sc, loadEvery: Infinity }, { tick: () => run(plain) })
    const sim = createSim(sc, k)
    runScheduled(sim, sc, { tick: () => run(sim) })
    expect(hashState(sim.snapshot())).toBe(hashState(plain.snapshot()))
  })
  it('a save is a deep copy: ticks after the save do not change what a load restores', () => {
    const sim = createSim(sc, k)
    for (let t = 0; t < 151; t++) run(sim)
    const atSave = hashState(sim.snapshot())
    const saved = sim.save()
    for (let t = 0; t < 60; t++) run(sim)
    expect(hashState(sim.snapshot())).not.toBe(atSave)
    sim.load(saved)
    expect(hashState(sim.snapshot())).toBe(atSave)
  })
})
