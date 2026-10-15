import { fork } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { TIMED_PHASES, SCENARIOS } from '@ecs-arena/spec'
import { aggregate, scoreTargets, type Aggregate, type RunResult } from './stats.ts'
import { commit, recordReport, writeResultsPage } from './results.ts'
import { cpus, platform, release } from 'node:os'
import { ensureVariant, parseTarget } from './variants.ts'

const HERE = dirname(fileURLToPath(import.meta.url))

const WRAP = (process.env.BENCH_WRAP ?? '').split(' ').filter(Boolean)

/** Where and how a report was made, so a result file from any machine stays comparable. */
export const machine = (runs: number) => ({
  date: new Date().toISOString(),
  commit: commit(),
  cpu: cpus()[0]?.model,
  cores: cpus().length,
  os: `${platform()} ${release()}`,
  arch: process.arch,
  node: process.version,
  wrap: WRAP.join(' '),
  runs,
})

// Protocol mode keeps stdout for benchbox JSON lines, so child output goes to stderr.
let quiet = false

/** How to start a child run: the script, its leading args and its node flags. */
export interface ChildCmd {
  script: string
  args: string[]
  execArgv: string[]
}

/** The dev child loads TS through tsx and resolves variant imports through the alias hook. */
export const DEV_CHILD: ChildCmd = {
  script: resolve(HERE, 'bench-child.ts'),
  args: [],
  execArgv: ['--import', 'tsx', '--import', pathToFileURL(resolve(HERE, 'alias-register.mjs')).href],
}

const runOnce = (impl: string, scenario: string, alias: Record<string, string>, kind: 'headline' | 'deep', cmd: ChildCmd): Promise<RunResult> =>
  new Promise((res, rej) => {
    // Fresh process per run so JIT/heap state never leaks.
    // BENCH_WRAP prefixes the child command, for example "taskset -c 3" or "chrt -f 99" on a tuned box.
    const [wrap, ...wrapArgs] = WRAP
    const child = fork(cmd.script, [...cmd.args, impl, scenario, kind], {
      ...(wrap && { execPath: wrap }),
      execArgv: [...wrapArgs, ...(wrap ? [process.execPath] : []), ...cmd.execArgv, '--expose-gc'],
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

/** Runs are interleaved target-by-target (ABAB...) so machine drift hits every target alike. `deep` adds deep-dive runs after the headline runs. */
export const bench = async (targets: string[], scenarios: string[], runs: number, deep = false, child = DEV_CHILD): Promise<BenchReport> => {
  const prepared = targets.map((target) => {
    const { impl, variant } = parseTarget(target)
    // A bundled entry has its variant built in.
    const alias: Record<string, string> = variant && child === DEV_CHILD ? { koota: ensureVariant(variant) } : {}
    return { target, impl, alias }
  })
  const report: BenchReport = Object.fromEntries(targets.map((t) => [t, {}]))
  for (const sc of scenarios) {
    if (!SCENARIOS[sc]) throw new Error(`unknown scenario ${sc}`)
    const collect = async (kind: 'headline' | 'deep') => {
      const rs: Record<string, RunResult[]> = Object.fromEntries(targets.map((t) => [t, []]))
      for (let i = 0; i < runs; i++)
        for (const { target, impl, alias } of prepared) rs[target].push(await runOnce(impl, sc, alias, kind, child))
      return rs
    }
    const head = await collect('headline')
    const dp = deep ? await collect('deep') : undefined
    for (const t of targets) report[t][sc] = aggregate(head[t], dp?.[t])
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
      const d = a.deep
      console.table({
        'total ms': { ...row(a.totalMs), 'ci95 lo': +a.totalMs.lo.toFixed(1), 'ci95 hi': +a.totalMs.hi.toFixed(1) },
        'p99 tick ms': row(a.p99Ms),
        'max tick ms': row(a.maxMs),
        'ticks > 16.6 ms': row(a.over),
        ...(d && {
          'sum(phases) ms': row(d.phasesSumMs),
          ...Object.fromEntries(Object.entries(d.phasesMs).map(([p, s]) => [p, row(s)])),
          'heap MB': row(d.peakHeap, 1048576),
          'gc ms': row(d.gcMs),
          'alloc MB': row(d.allocBytes, 1048576),
        }),
      })
      if (d) console.log(`deep-dive instrumentation overhead: ${(d.overhead * 100).toFixed(1)}% (deep total ${d.totalMs.median.toFixed(1)} ms vs headline ${a.totalMs.median.toFixed(1)} ms)`)
    }
  }
}

export const printScores = (report: BenchReport) => {
  const totals = Object.fromEntries(Object.entries(report).map(([t, bySc]) => [t, Object.fromEntries(Object.entries(bySc).map(([sc, a]) => [sc, a.samples.total]))]))
  const scores = scoreTargets(totals)
  if (!scores.length) return
  console.log('\nheadline score: geomean over scenarios of target total / baseline-js total, 95% bootstrap interval, equal rank when intervals overlap')
  console.table(Object.fromEntries(scores.map((s) => [s.target, { rank: s.rank, score: +s.point.toFixed(3), 'ci95 lo': +s.lo.toFixed(3), 'ci95 hi': +s.hi.toFixed(3) }])))
}

const COLS = [...TIMED_PHASES, 'tick']

/** benchbox native protocol v1. Per scenario: one bench per column (per-tick median ns), plus the run totals and the per-tick median GC time. */
export const writeProtocol = async (target: string, scenarios: string[], runs: number, child = DEV_CHILD) => {
  quiet = true
  const out = (r: object) => process.stdout.write(JSON.stringify(r) + '\n')
  out({ type: 'meta', language: 'js', toolchain: process.version, target: `${process.arch}-${process.platform}`, machine: machine(runs) })
  for (const sc of scenarios) {
    const group = `${sc}/${target}`
    try {
      const a = (await bench([target], [sc], runs, true, child))[target][sc]
      const ns = (ms: number) => Math.round(ms * 1e6)
      COLS.forEach((c, i) => out({ type: 'bench', group, name: c, samples: a.deep!.ticks.map((r) => ns(r[i])) }))
      out({ type: 'bench', group, name: 'total', samples: a.samples.total.map(ns) })
      out({ type: 'bench', group, name: 'gc', samples: a.deep!.ticks.map((r) => ns(r[COLS.length])) })
    } catch (e) {
      // A golden hash mismatch exits the child with code 3, so a wrong result never gives samples.
      for (const c of [...COLS, 'total', 'gc']) out({ type: 'error', group, name: c, message: String(e) })
    }
  }
}

export const parseCli = (argv: string[]) => {
  const { positionals, values } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: { runs: { type: 'string' }, out: { type: 'string' }, record: { type: 'boolean', default: false }, deep: { type: 'boolean', default: false }, protocol: { type: 'boolean', default: !!process.env.BENCHBOX_PROTOCOL } },
  })
  // 10 runs for recorded results, 5 for a quick look.
  const runs = Number(values.runs ?? (values.record ? 10 : 5))
  return { pos: positionals, runs, out: values.out, record: values.record, deep: values.deep, protocol: values.protocol }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { pos, runs, out, record, deep, protocol } = parseCli(process.argv.slice(2))
  const scenarios = pos.filter((p) => SCENARIOS[p])
  const targets = pos.filter((p) => !SCENARIOS[p])
  if (targets.length === 0 || scenarios.length === 0 || (protocol && targets.length > 1)) {
    console.error('usage: pnpm bench <impl[@variant]...> <scenario...> [--runs N] [--deep] [--out results/x.json] [--record] [--protocol]')
    process.exit(2)
  }
  if (protocol) {
    await writeProtocol(targets[0], scenarios, runs)
    process.exit(0)
  }
  const report = await bench(targets, scenarios, runs, deep || record)
  printTable(report)
  printScores(report)
  if (out) {
    mkdirSync(dirname(resolve(out)), { recursive: true })
    writeFileSync(out, JSON.stringify({ machine: machine(runs), report }, (k, v) => (k === 'ticks' ? undefined : v), 2))
  }
  if (record) {
    recordReport(report)
    writeResultsPage()
  }
}
