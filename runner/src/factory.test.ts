import { describe, expect, it } from 'vitest'
import { FACTORY, hashState, factory } from '@ecs-arena/spec'
import createSim from '../../impls/baseline-js/src/factory/index.ts'
import { HARNESS } from './games.ts'
import { runScheduled } from './schedule.ts'
const k = FACTORY.kernel
const run = (sim: ReturnType<typeof createSim>) => {
  for (const p of FACTORY.phases) sim.phases[p]()
}
describe('factory harness', () => {
  it('derives the regions and liveness rows from the facet table', () => {
    expect(HARNESS.factory.regions).toBe(factory.REGIONS)
    expect(HARNESS.factory.liveness).toBe(factory.LIVENESS)
  })
  it('claims each region only in the scenarios that the facet table names', () => {
    expect(HARNESS.factory.regionsFor('works')).toContain('work.query')
    expect(HARNESS.factory.regionsFor('works')).not.toContain('work.step')
    expect(HARNESS.factory.regionsFor('mill')).toContain('work.step')
    expect(HARNESS.factory.regionsFor('mill')).toContain('work.tag')
    expect(HARNESS.factory.regionsFor('mill')).not.toContain('work.query')
    expect(HARNESS.factory.livenessFor('mill-smoke').length).toBeLessThan(HARNESS.factory.liveness.length)
  })
  it('leaves the other games with one list for every scenario', () => {
    expect(HARNESS.rts.regionsFor('skirmish')).toBe(HARNESS.rts.regionsFor('war'))
    expect(HARNESS.survivors.livenessFor('grove')).toBe(HARNESS.survivors.liveness)
  })
})
describe('factory baseline-js', () => {
  // 3 districts, 460 ticks: loads at 199 and 399 replay, the shift at 250 and 4 outage draws happen
  const sc = { ...FACTORY.scenarios['mill-smoke'], districtsX: 3, districtsY: 1, dronesPerDistrict: 20, ticks: 460 }
  const hashes = (naive: string | null, scenario = sc): string[] => {
    const sim = createSim(scenario, k, undefined, { begin() {}, end() {}, naive: new Set(naive ? [naive] : []) })
    const out: string[] = []
    runScheduled(sim, scenario, { tick: () => run(sim), after: (t) => { if (t % 5 === 0) out.push(hashState(sim.snapshot())) } })
    return out
  }
  const base = hashes(null)
  for (const r of HARNESS.factory.regions) it(`${r} keeps the hash`, () => expect(hashes(r)).toEqual(base))
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
    // The machines part lists the changes of the tick, and a load starts a new tick, so it is left out.
    const withoutChanged = (s: number[]) => [...s.slice(0, 10), ...s.slice(11 + 6 * s[10])]
    const atSave = withoutChanged(sim.snapshot())
    const saved = sim.save()
    for (let t = 0; t < 60; t++) run(sim)
    expect(withoutChanged(sim.snapshot())).not.toEqual(atSave)
    sim.load(saved)
    expect(withoutChanged(sim.snapshot())).toEqual(atSave)
  })
  it('lists only the machines that changed after tick 0, and all of them at tick 0', () => {
    const sim = createSim(sc, k)
    run(sim)
    const total = k.machineCount(sc)
    expect(sim.snapshot()[10]).toBe(total)
    run(sim)
    expect(sim.snapshot()[10]).toBeLessThan(total / 2)
  })
})
