import { fork } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { SCENARIOS } from '@ecs-arena/spec'
import { aggregate, type Aggregate, type RunResult } from './stats.ts'
import { recordReport, writeResultsPage } from './results.ts'
import { ensureVariant, parseTarget } from './variants.ts'

const HERE = dirname(fileURLToPath(import.meta.url))

const runOnce = (impl: string, scenario: string, alias: Record<string, string>, warmup: number): Promise<RunResult> =>
  new Promise((res, rej) => {
    // Fresh process per run so JIT/heap state never leaks. tsx loads the TS; alias hook resolves variant imports.
    const child = fork(resolve(HERE, 'bench-child.ts'), [impl, scenario, String(warmup)], {
      execArgv: ['--import', 'tsx', '--import', pathToFileURL(resolve(HERE, 'alias-register.mjs')).href, '--expose-gc'],
      env: { ...process.env, ECS_ALIAS: JSON.stringify(alias) },
    })
    let result: RunResult | undefined
    child.on('message', (m) => (result = m as RunResult))
    child.on('exit', (code) => (code === 0 && result ? res(result) : rej(new Error(`child ${impl} ${scenario} exited ${code}`))))
  })

export type BenchReport = Record<string, Record<string, Aggregate>>

/** Runs are interleaved target-by-target (ABAB...) so machine drift hits every target alike. */
export const bench = async (targets: string[], scenarios: string[], runs: number, warmup = 200): Promise<BenchReport> => {
  const prepared = targets.map((target) => {
    const { impl, variant } = parseTarget(target)
    const alias: Record<string, string> = variant ? { koota: ensureVariant(variant) } : {}
    return { target, impl, alias }
  })
  const report: BenchReport = Object.fromEntries(targets.map((t) => [t, {}]))
  for (const sc of scenarios) {
    if (!SCENARIOS[sc]) throw new Error(`unknown scenario ${sc}`)
    const rs: Record<string, RunResult[]> = Object.fromEntries(targets.map((t) => [t, []]))
    for (let i = 0; i < runs; i++)
      for (const { target, impl, alias } of prepared) rs[target].push(await runOnce(impl, sc, alias, warmup))
    for (const t of targets) report[t][sc] = aggregate(rs[t])
  }
  return report
}

export const printTable = (report: BenchReport) => {
  for (const [target, byScenario] of Object.entries(report)) {
    for (const [sc, a] of Object.entries(byScenario)) {
      console.log(`\n${target} ${sc} (${a.runs} runs)`)
      const row = (s: { median: number; p95: number }, div = 1) => ({
        median: +(s.median / div).toFixed(1),
        p95: +(s.p95 / div).toFixed(1),
      })
      console.table({
        'total ms': row(a.totalMs),
        'sum(phases) ms': row(a.phasesSumMs),
        ...Object.fromEntries(Object.entries(a.phasesMs).map(([p, s]) => [p, row(s)])),
        'heap MB': row(a.peakHeap, 1048576),
        'gc ms': row(a.gcMs),
        'alloc MB': row(a.allocBytes, 1048576),
      })
    }
  }
}

export const parseCli = (argv: string[]) => {
  const { positionals, values } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: { runs: { type: 'string', default: '5' }, warmup: { type: 'string', default: '200' }, out: { type: 'string' }, record: { type: 'boolean', default: false } },
  })
  return { pos: positionals, runs: Number(values.runs), warmup: Number(values.warmup), out: values.out, record: values.record }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { pos: [target, ...scenarios], runs, warmup, out, record } = parseCli(process.argv.slice(2))
  if (!target || scenarios.length === 0) {
    console.error('usage: pnpm bench <impl[@variant]> <scenario...> [--runs N] [--warmup N] [--out results/x.json] [--record]')
    process.exit(2)
  }
  const report = await bench([target], scenarios, runs, warmup)
  printTable(report)
  if (out) {
    mkdirSync(dirname(resolve(out)), { recursive: true })
    writeFileSync(out, JSON.stringify(report, (k, v) => (k === 'ticks' ? undefined : v), 2))
  }
  if (record) {
    recordReport(report)
    writeResultsPage()
  }
}
