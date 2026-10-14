import { fork } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { PHASES, SCENARIOS } from '@ecs-arena/spec'
import { aggregate, type Aggregate, type RunResult } from './stats.ts'
import { commit, recordReport, writeResultsPage } from './results.ts'
import { cpus, platform, release } from 'node:os'
import { ensureVariant, parseTarget } from './variants.ts'

const HERE = dirname(fileURLToPath(import.meta.url))

const WRAP = (process.env.BENCH_WRAP ?? '').split(' ').filter(Boolean)

/** Where and how a report was made, so a result file from any machine stays comparable. */
export const machine = (runs: number, warmup: number) => ({
  date: new Date().toISOString(),
  commit: commit(),
  cpu: cpus()[0]?.model,
  cores: cpus().length,
  os: `${platform()} ${release()}`,
  arch: process.arch,
  node: process.version,
  wrap: WRAP.join(' '),
  runs,
  warmup,
})

// Protocol mode keeps stdout for benchbox JSON lines, so child output goes to stderr.
let quiet = false

const runOnce = (impl: string, scenario: string, alias: Record<string, string>, warmup: number): Promise<RunResult> =>
  new Promise((res, rej) => {
    // Fresh process per run so JIT/heap state never leaks. tsx loads the TS; alias hook resolves variant imports.
    // BENCH_WRAP prefixes the child command, for example "taskset -c 3" or "chrt -f 99" on a tuned box.
    const [wrap, ...wrapArgs] = WRAP
    const child = fork(resolve(HERE, 'bench-child.ts'), [impl, scenario, String(warmup)], {
      ...(wrap && { execPath: wrap }),
      execArgv: [...wrapArgs, ...(wrap ? [process.execPath] : []), '--import', 'tsx', '--import', pathToFileURL(resolve(HERE, 'alias-register.mjs')).href, '--expose-gc'],
      env: { ...process.env, ECS_ALIAS: JSON.stringify(alias) },
      silent: quiet,
    })
    child.stdout?.pipe(process.stderr)
    child.stderr?.pipe(process.stderr)
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

const COLS = [...PHASES, 'tick']

/** benchbox native protocol v1: one bench per scenario and column, samples = per-tick median in ns. */
export const writeProtocol = async (target: string, scenarios: string[], runs: number, warmup: number) => {
  quiet = true
  const out = (r: object) => process.stdout.write(JSON.stringify(r) + '\n')
  out({ type: 'meta', language: 'js', toolchain: process.version, target: `${process.arch}-${process.platform}`, machine: machine(runs, warmup) })
  for (const sc of scenarios) {
    try {
      const a = (await bench([target], [sc], runs, warmup))[target][sc]
      COLS.forEach((c, i) => out({ type: 'bench', group: `${sc}/${target}`, name: c, samples: a.ticks.map((r) => Math.round(r[i] * 1e6)) }))
    } catch (e) {
      // A golden hash mismatch exits the child with code 3, so a wrong result never gives samples.
      for (const c of COLS) out({ type: 'error', group: `${sc}/${target}`, name: c, message: String(e) })
    }
  }
}

export const parseCli = (argv: string[]) => {
  const { positionals, values } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: { runs: { type: 'string', default: '5' }, warmup: { type: 'string', default: '200' }, out: { type: 'string' }, record: { type: 'boolean', default: false }, protocol: { type: 'boolean', default: !!process.env.BENCHBOX_PROTOCOL } },
  })
  return { pos: positionals, runs: Number(values.runs), warmup: Number(values.warmup), out: values.out, record: values.record, protocol: values.protocol }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { pos: [target, ...scenarios], runs, warmup, out, record, protocol } = parseCli(process.argv.slice(2))
  if (!target || scenarios.length === 0) {
    console.error('usage: pnpm bench <impl[@variant]> <scenario...> [--runs N] [--warmup N] [--out results/x.json] [--record] [--protocol]')
    process.exit(2)
  }
  if (protocol) {
    await writeProtocol(target, scenarios, runs, warmup)
    process.exit(0)
  }
  const report = await bench([target], scenarios, runs, warmup)
  printTable(report)
  if (out) {
    mkdirSync(dirname(resolve(out)), { recursive: true })
    writeFileSync(out, JSON.stringify({ machine: machine(runs, warmup), report }, (k, v) => (k === 'ticks' ? undefined : v), 2))
  }
  if (record) {
    recordReport(report)
    writeResultsPage()
  }
}
