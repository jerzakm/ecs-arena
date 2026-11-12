import { describe, expect, it } from 'vitest'
import { FACTORY, GAMES, RTS, BRICKS, SURVIVORS, assertUniqueScenarioNames, findScenario, hasScenario } from './index.ts'

describe('games', () => {
  it('finds the game of a scenario by name', () => {
    expect(findScenario('war-smoke').game).toBe(RTS)
    expect(findScenario('war-smoke').scenario).toBe(RTS.scenarios['war-smoke'])
  })
  it('finds the survivors scenarios', () => {
    expect(findScenario('grove-smoke').game).toBe(SURVIVORS)
    expect(SURVIVORS.board).toEqual(['grove', 'swarm'])
    expect(GAMES).toContain(BRICKS)
  })
  it('finds the factory scenarios', () => {
    expect(findScenario('works-smoke').game).toBe(FACTORY)
    expect(FACTORY.board).toEqual(['mill', 'works'])
    expect(FACTORY.slug).toBe('factory')
  })
  it('throws on an unknown name, also one that Object.prototype owns', () => {
    expect(() => findScenario('nope')).toThrow('unknown scenario nope')
    expect(() => findScenario('toString')).toThrow('unknown scenario')
    expect(hasScenario('toString')).toBe(false)
  })
  it('rejects a scenario name in two games', () => {
    expect(() => assertUniqueScenarioNames(GAMES)).not.toThrow()
    expect(() => assertUniqueScenarioNames([RTS, { id: 'other', scenarios: { skirmish: RTS.scenarios.skirmish } }])).toThrow('skirmish is in games rts and other')
  })
})
