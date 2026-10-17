import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { SCENARIOS, TIMED_PHASES } from '@ecs-arena/spec'
import { commit, upsertSummary, writeResultsPage, writeTicks } from './results.ts'
import { median, medianCI } from './stats.ts'

/** The part of `benchbox results <jobId>` this importer reads. */
export interface BenchboxResult {
  timestamp?: string
  files: { file: string; benches: { group: string; name: string; samples: number[]; ordered?: boolean; error?: string }[] }[]
}

export interface Imported {
  target: string
  scenario: string
  /** Per-tick CSV data rows, empty when the samples are not in tick order. */
  ticks: string[]
  summary: Record<string, string | number>
}

const ms = (ns: number) => ns / 1e6
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)

/** Turns protocol benches (group `<scenario>/<target>`, samples in ns) into per-tick rows and summary values. A group with an error bench is reported and skipped. */
export const parseBenchbox = (result: BenchboxResult, log: (line: string) => void = console.error): Imported[] => {
  const groups = new Map<string, Map<string, number[]>>()
  const sorted = new Set<string>()
  const failed = new Set<string>()
  for (const f of result.files)
    for (const b of f.benches) {
      if (b.error) {
        failed.add(b.group)
        log(`${b.group} ${b.name}: ${b.error}`)
      }
      if (!groups.has(b.group)) groups.set(b.group, new Map())
      groups.get(b.group)!.set(b.name, b.samples)
      if (b.ordered !== true) sorted.add(b.group)
    }
  const out: Imported[] = []
  for (const [group, cols] of groups) {
    if (failed.has(group)) continue
    const i = group.indexOf('/')
    const scenario = group.slice(0, i)
    const target = group.slice(i + 1)
    const need = (name: string) => {
      const s = cols.get(name)
      if (!s) throw new Error(`${group} has no ${name} bench`)
      return s
    }
    const total = need('total').map(ms)
    const tick = need('tick')
    const columns = [...TIMED_PHASES, 'tick', 'gc'].map((c) => need(c).map(ms))
    if (sorted.has(group)) log(`${group}: samples have no ordered flag, so benchbox sorted them. The per-tick CSV is skipped and run_totals are sorted.`)
    // benchbox downsamples a series over 50k samples with an even stride, so the index maps back to the real tick (approximate).
    const n = SCENARIOS[scenario]?.ticks ?? tick.length
    const at = (t: number) => (tick.length > 1 && n > tick.length ? Math.round((t * (n - 1)) / (tick.length - 1)) : t)
    const ticks = sorted.has(group) ? [] : tick.map((_, t) => [at(t), ...columns.map((c) => +c[t].toFixed(4)), '', ''].join(','))
    const ci = medianCI(total)
    out.push({
      target, scenario, ticks,
      summary: {
        target, scenario, runs: total.length, total_ms: median(total), total_lo: ci.lo, total_hi: ci.hi,
        run_totals: total.map((x) => +x.toFixed(2)).join(';'),
        ...Object.fromEntries(TIMED_PHASES.map((p, k) => [`${p}_ms`, sum(columns[k])])),
        gc_ms: sum(columns[columns.length - 1]),
      },
    })
  }
  return out
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { positionals, values } = parseArgs({ allowPositionals: true, options: { commit: { type: 'string' } } })
  if (positionals.length !== 1) {
    console.error('usage: pnpm import:benchbox <results.json> [--commit sha]')
    process.exit(2)
  }
  const result = JSON.parse(readFileSync(resolve(positionals[0]), 'utf8')) as BenchboxResult
  const imported = parseBenchbox(result)
  for (const r of imported) if (r.ticks.length) writeTicks(r.scenario, r.target, r.ticks)
  upsertSummary(imported.map((r) => r.summary), (result.timestamp ?? new Date().toISOString()).slice(0, 10), values.commit ?? commit())
  writeResultsPage()
}
