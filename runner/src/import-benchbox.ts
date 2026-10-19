import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { SCENARIOS, TIMED_PHASES } from '@ecs-arena/spec'
import { commit, upsertSummary, writeResultsPage, writeTicks } from './results.ts'
import { median, medianCI, scoreTargets } from './stats.ts'

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
  summary: Record<string, string | number | undefined>
}

const ms = (ns: number) => ns / 1e6
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)

/** Turns protocol benches (group `<scenario>/<target>`, samples in ns) into per-tick rows and summary values. A group with an error bench is reported and skipped. A group with only a `total` bench (a quick run) gives no tick rows and empty phase and GC cells. */
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
    const deep = cols.has('tick')
    const tick = deep ? need('tick') : []
    const columns = deep ? [...TIMED_PHASES, 'tick', 'gc'].map((c) => need(c).map(ms)) : []
    if (sorted.has(group)) log(`${group}: samples have no ordered flag, so benchbox sorted them. The per-tick CSV is skipped and run_totals are sorted.`)
    // benchbox downsamples a series over 50k samples with an even stride, so the index maps back to the real tick (approximate).
    const n = SCENARIOS[scenario]?.ticks ?? tick.length
    const at = (t: number) => (tick.length > 1 && n > tick.length ? Math.round((t * (n - 1)) / (tick.length - 1)) : t)
    const ticks = sorted.has(group) || !deep ? [] : tick.map((_, t) => [at(t), ...columns.map((c) => +c[t].toFixed(4)), '', ''].join(','))
    const ci = medianCI(total)
    out.push({
      target, scenario, ticks,
      summary: {
        target, scenario, runs: total.length, total_ms: median(total), total_lo: ci.lo, total_hi: ci.hi,
        run_totals: total.map((x) => +x.toFixed(2)).join(';'),
        ...Object.fromEntries(TIMED_PHASES.map((p, k) => [`${p}_ms`, deep ? sum(columns[k]) : undefined])),
        gc_ms: deep ? sum(columns[columns.length - 1]) : undefined,
      },
    })
  }
  return out
}

const ROOT = resolve(import.meta.dirname, '../..')
const BASELINE = 'baseline-js'

/** Runs `benchbox results` for every impl, one Project each (named by its path, impls/<impl>). An impl with no done job at the commit is skipped with a note, except the baseline, because the headline divides by it. */
export const fetchResult = (impls: string[], commit?: string, run: (args: string[]) => string = (a) => execFileSync(process.env.BENCHBOX ?? 'benchbox', a, { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 30, stdio: ['ignore', 'pipe', 'inherit'] })): BenchboxResult => {
  const results: BenchboxResult[] = []
  for (const impl of impls) {
    try {
      results.push(JSON.parse(run(['results', '--project', `impls/${impl}`, ...(commit ? ['--commit', commit] : [])])) as BenchboxResult)
    } catch (e) {
      if (impl === BASELINE) throw new Error(`no ${BASELINE} result: the headline needs it (${e})`)
      console.error(`skipping ${impl}: no result`)
    }
  }
  return { timestamp: results[0]?.timestamp, files: results.flatMap((r) => r.files) }
}

const geomean = (xs: number[]) => Math.exp(xs.reduce((a, b) => a + Math.log(b), 0) / xs.length)

/** The headline geometric mean with its interval, then per target and phase the geometric mean over scenarios of phase ms divided by the baseline phase ms. */
export const report = (rows: Imported[]): string[] => {
  const totals: Record<string, Record<string, number[]>> = {}
  for (const r of rows) (totals[r.target] ??= {})[r.scenario] = String(r.summary.run_totals).split(';').map(Number)
  const out = scoreTargets(totals).map((s) => `headline ${s.target}: ${s.point.toFixed(3)} (95% ${s.lo.toFixed(3)} to ${s.hi.toFixed(3)}), geomean of total ms over ${BASELINE}`)
  const base = new Map(rows.filter((r) => r.target === BASELINE).map((r) => [r.scenario, r.summary]))
  for (const t of Object.keys(totals).filter((t) => t !== BASELINE))
    for (const p of [...TIMED_PHASES, 'gc']) {
      const ratios = rows.filter((r) => r.target === t).flatMap((r) => {
        const [a, b] = [Number(r.summary[`${p}_ms`]), Number(base.get(r.scenario)?.[`${p}_ms`])]
        return a > 0 && b > 0 ? [a / b] : []
      })
      if (ratios.length) out.push(`  ${t} ${p}: ${geomean(ratios).toFixed(3)}`)
    }
  return out
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { positionals, values } = parseArgs({ allowPositionals: true, options: { commit: { type: 'string' } } })
  if (positionals.length > 1) {
    console.error('usage: pnpm import:benchbox [--commit sha] [results.json]\n  with no file, fetches the results of every impl at the commit (default HEAD) with `benchbox results`')
    process.exit(2)
  }
  const result = positionals[0] ? (JSON.parse(readFileSync(resolve(positionals[0]), 'utf8')) as BenchboxResult) : fetchResult(readdirSync(resolve(ROOT, 'impls')), values.commit)
  const imported = parseBenchbox(result)
  for (const r of imported) if (r.ticks.length) writeTicks(r.scenario, r.target, r.ticks)
  upsertSummary(imported.map((r) => r.summary), (result.timestamp ?? new Date().toISOString()).slice(0, 10), values.commit ?? commit())
  writeResultsPage()
  console.log(report(imported).join('\n'))
}
