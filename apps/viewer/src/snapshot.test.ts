import { describe, expect, it } from 'vitest'
import { SCENARIOS, PHASES, kernel } from '@ecs-arena/spec'
import createSim from '../../../impls/baseline-js/src/index.ts'
import { parseSnapshot } from './snapshot.ts'

describe('parseSnapshot', () => {
  it('parses a hand-built snapshot and skips variable-length sections', () => {
    const s = [
      7, 1, 1, 0, 0, 0, 0, -1, 0, 0, 3, 4, 77,
      1, 5, 1, 300, 0,
      2,
      // unit 1: two buffs, one item, flags=2, one threat, chronicle of two
      10, 0, 0, 100, 200, 50, 60, 1, 2, 3, 4, -1, -1, -1,
      2, 1, 9, 2, 8,
      1, 20, 3, 1,
      2, 0, 11, 5, 1, 1, 6, 2, 2, 1, 2,
      11, 1, 8, 5, 6, 70, 80, 1, 2, 3, 0, -1, -1, -1,
      0,
      0,
      0, 0, -1, -1, -1, 0, 0,
      1,
      30, 10, 11, 7, 8, 0, 9, 1,
      1,
      40, 0, 1, 9, 10, 0,
    ]
    const p = parseSnapshot(s)
    expect(p.world).toMatchObject({ tick: 7, alive0: 1, alive1: 1, winner: -1 })
    expect(p.shrines).toEqual([{ gameId: 5, owner: 1, progress: 300 }])
    expect(p.units).toHaveLength(2)
    expect(p.units[0]).toEqual({ gameId: 10, team: 0, kind: 0, x: 100, y: 200, hp: 50, maxHp: 60, cooldown: 4, flags: 2, buffs: [{ kind: 1, ticksLeft: 9 }, { kind: 2, ticksLeft: 8 }] })
    expect(p.units[1]).toMatchObject({ gameId: 11, team: 1, kind: 8, x: 5, y: 6, hp: 70, flags: 0, buffs: [] })
    expect(p.projectiles).toEqual([{ gameId: 30, x: 7, y: 8, volley: 1 }])
    expect(p.groundItems).toEqual([{ x: 9, y: 10 }])
  })

  it('matches a real baseline-js battle-smoke snapshot', () => {
    const sim = createSim(SCENARIOS['battle-smoke'], kernel)
    for (let t = 0; t < 150; t++) for (const ph of PHASES) sim.phases[ph]()
    const raw = sim.snapshot()
    for (const input of [raw, Int32Array.from(raw)]) {
      const p = parseSnapshot(input)
      expect(p.world.tick).toBe(raw[0])
      expect(p.units.length).toBe(p.world.alive0 + p.world.alive1)
      expect(p.units.length).toBeGreaterThan(0)
      expect(p.units.filter((u) => u.team === 0)).toHaveLength(p.world.alive0)
      expect(p.shrines.length).toBeGreaterThan(0)
      for (const u of p.units) {
        expect(u.hp).toBeGreaterThan(0)
        expect(u.hp).toBeLessThanOrEqual(u.maxHp)
        expect(u.x).toBeGreaterThanOrEqual(0)
        expect(u.x).toBeLessThan(262144)
        expect([0, 1, 2, 3, 4, 5, 8]).toContain(u.kind)
      }
    }
  })
})
