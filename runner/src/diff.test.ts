import { describe, expect, it } from 'vitest'
import { runPhases, RTS, kernel } from '@ecs-arena/spec'
import baseline from '../../impls/baseline-js/src/rts/index.ts'
import { parse, scenario } from '../../impls/baseline-js/src/rts/testkit.ts'
import { diffParsed } from './diff.ts'

const snapshot = () => {
  const sim = baseline(scenario({ ticks: 1 }), kernel)
  runPhases(RTS, sim)
  return parse(sim.snapshot())
}

describe('diffParsed', () => {
  it('is empty for equal snapshots', () => {
    expect(diffParsed(snapshot(), snapshot())).toEqual([])
  })
  it('names the differing field of the first differing unit, shrine and world field', () => {
    const a = snapshot(), b = snapshot()
    b.units[2].hp += 1
    b.units[2].threat = [{ attacker: 1, amount: 5 }]
    b.shrines[3].progress = 7
    b.damage[1] = 9
    const d = diffParsed(a, b)
    expect(d.map((r) => [r.section, r.key, r.differing])).toEqual([
      ['world', 'world', ['damage1']],
      ['shrine', String(b.shrines[3].gameId), ['progress']],
      ['unit', String(b.units[2].gameId), ['hp', 'threat']],
    ])
  })
  it('reports a record that only one side has', () => {
    const a = snapshot(), b = snapshot()
    b.projectiles.push({ gameId: 999, owner: 1, target: 2, x: 0, y: 0, age: 0, speed: 512, volley: 1 })
    const [r] = diffParsed(a, b)
    expect([r.section, r.key, r.vanilla]).toEqual(['projectile', '999', undefined])
  })
  it('reports a different record order when every record is equal', () => {
    const a = snapshot(), b = snapshot()
    b.units.reverse()
    expect(diffParsed(a, b).map((r) => [r.section, r.key, r.differing])).toEqual([['unit', 'order', ['keys']]])
  })
})
