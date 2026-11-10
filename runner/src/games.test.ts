import { relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { FACTORY, RTS, SURVIVORS, timedSteps, type Sim } from '@ecs-arena/spec'
import { dirOf, pageOf } from './results.ts'

const ROOT = new URL('../..', import.meta.url).pathname

describe('per-game output paths', () => {
  it('keeps the RTS names and gives other games a suffix', () => {
    expect([RTS, SURVIVORS, FACTORY].map((g) => [relative(ROOT, dirOf(g)), relative(ROOT, pageOf(g))])).toEqual([
      ['bench-data', 'docs/results.md'],
      ['bench-data/survivors', 'docs/results-survivors.md'],
      ['bench-data/factory', 'docs/results-factory.md'],
    ])
  })
})

describe('timedSteps', () => {
  const calls: string[] = []
  const phase = (p: string) => () => void calls.push(p)
  const sim = (withHook: boolean): Sim<string> => ({
    phases: Object.fromEntries(['spawn', 'ai/target', 'move', 'combat', 'effects', 'morale', 'cleanup', 'objectives', 'stats'].map((p) => [p, phase(p)])),
    ...(withHook && { moveStart: phase('hook') }),
  } as Sim<string>)

  it('runs the hook as its own step before the start phase', () => {
    calls.length = 0
    const steps = timedSteps(RTS, sim(true))
    expect(steps.map((s) => s.key)).toEqual([...RTS.timedPhases])
    for (const s of steps) s.run()
    expect(calls.slice(1, 4)).toEqual(['ai/target', 'hook', 'move'])
  })

  it('treats a missing hook as a no-op', () => {
    calls.length = 0
    for (const s of timedSteps(RTS, sim(false))) s.run()
    expect(calls).not.toContain('hook')
    expect(calls).toHaveLength(RTS.timedPhases.length - 1)
  })
})
