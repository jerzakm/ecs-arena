import { TIMED_PHASES } from '@ecs-arena/spec'
import { expect, it } from 'vitest'
import { parseBenchbox, type BenchboxResult } from './import-benchbox.ts'
import { scoreTargets } from './stats.ts'

const NS = 1e6
/** Two ticks of every column, plus run totals. `scale` makes one target slower than the other. */
const group = (target: string, scale: number): BenchboxResult['files'][0]['benches'] => [
  ...[...TIMED_PHASES, 'tick', 'gc'].map((name) => ({ group: `skirmish/${target}`, name, samples: [NS * scale, 3 * NS * scale] })),
  { group: `skirmish/${target}`, name: 'total', samples: [100, 110, 105, 120, 98].map((t) => t * scale * NS) },
]

it('imports protocol benches into summary rows that give a headline score', () => {
  const result: BenchboxResult = { files: [{ file: 'dist/bench-baseline-js.mjs', benches: group('baseline-js', 1) }, { file: 'dist/bench-koota.mjs', benches: group('koota', 2) }] }
  const rows = parseBenchbox(result)
  const koota = rows.find((r) => r.target === 'koota')!
  expect(koota.summary).toMatchObject({ scenario: 'skirmish', runs: 5, total_ms: 210, spawn_ms: 8, gc_ms: 8 })
  expect(koota.summary.p99_ms).toBeUndefined()
  expect(koota.ticks).toHaveLength(2)
  expect(koota.ticks[0].endsWith(',,')).toBe(true)
  const totals = Object.fromEntries(rows.map((r) => [r.target, { skirmish: String(r.summary.run_totals).split(';').map(Number) }]))
  const [score] = scoreTargets(totals)
  expect(score).toMatchObject({ target: 'koota', rank: 1 })
  expect(score.point).toBeCloseTo(2)
})

it('skips a group with an error bench and logs it', () => {
  const logged: string[] = []
  const rows = parseBenchbox({ files: [{ file: 'f', benches: [{ group: 'war/koota', name: 'total', samples: [], error: 'HASH MISMATCH' }] }] }, (l) => logged.push(l))
  expect(rows).toEqual([])
  expect(logged[0]).toContain('HASH MISMATCH')
})
