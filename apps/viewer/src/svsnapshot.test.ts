import { describe, expect, it } from 'vitest'
import { SURVIVORS, runPhases } from '@ecs-arena/spec'
import createSim from '../../../impls/baseline-js/src/survivors/index.ts'
import { parseSvSnapshot } from './svsnapshot.ts'
import { KIND_LOOK } from './svlook.ts'

describe('parseSvSnapshot', () => {
  it('reads a real sim snapshot to the end, so the layout matches the spec', () => {
    const sim = createSim(SURVIVORS.scenarios['grove-smoke'], SURVIVORS.kernel)
    for (let t = 0; t < 400; t++) runPhases(SURVIVORS, sim)
    const raw = sim.snapshot()
    const s = parseSvSnapshot(raw)
    expect(s.world.tick).toBe(399)
    expect(s.units[0]).toMatchObject({ gameId: 1, team: 0, kind: 100 })
    expect(s.units.length - 1).toBe(s.world.alive)
    expect(s.units.length).toBeGreaterThan(20)
    expect(s.held[0]).toEqual({ id: 0, level: expect.any(Number) })
    for (const u of s.units.slice(1)) expect(KIND_LOOK[u.kind]).toBeDefined()
    // The parser must consume the whole array: the particle list is the last section.
    expect(s.projectiles.every((p) => p.gameId >= 10)).toBe(true)
    expect(s.particles.every((p) => p.kind === 0 || p.kind === 1)).toBe(true)
    expect(s.pickups.every((p) => p.kind >= 0 && p.kind <= 2)).toBe(true)
  })
})
