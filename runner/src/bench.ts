import { fork } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { TIMED_PHASES, SCENARIOS } from '@ecs-arena/spec'
import { aggregate, enough, planFor, scoreTargets, type Aggregate, type RunPlan, type RunResult } from './stats.ts'
import { commit, recordReport, writeResultsPage } from './results.ts'
import { cpus, platform, release } from 'node:os'
import { ensureVariant, parseTarget } from './variants.ts'

const HERE = dirname(fileURLToPath(import.meta.url))

const WRAP = (process.env.BENCH_WRAP ?? '').split(' ').filter(Boolean)

/** Where and how a report was made, so a result file from any machine stays comparable. */
export const machine = (plan: RunPlan) => ({
  date: new Date().toISOString(),
  commit: commit(),
  cpu: cpus()[0]?.model,
  cores: cpus().length,
  os: `${platform()} ${release()}`,
  arch: process.arch,
  node: process.version,
  wrap: WRAP.join(' '),
  plan,
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

/** Headline runs are interleaved target by target (ABAB...) so machine drift hits every target alike. They go on until every target has `enough` runs, so all targets keep the same count. `t0` is when the entry started, for the wall-time cap. Then `plan.deep` interleaved deep-dive runs follow. */
export const bench = async (targets: string[], scenarios: string[], plan: RunPlan, child = DEV_CHILD, t0 = Date.now()): Promise<BenchReport> => {
  const prepared = targets.map((target) => {
    const { impl, variant } = parseTarget(target)
    // A bundled entry has its variant built in.
    const alias: Record<string, string> = variant && child === DEV_CHILD ? { koota: ensureVariant(variant) } : {}
    return { target, impl, alias }
  })
  const report: BenchReport = Object.fromEntries(targets.map((t) => [t, {}]))
  // benchbox progress records (protocol mode only). Total counts every planned run and shrinks when adaptive headline runs stop early.
  const perScenario = targets.length * (plan.max + plan.deep)
  let done = 0
  let total = scenarios.length * perScenario
  for (const sc of scenarios) {
    if (!SCENARIOS[sc]) throw new Error(`unknown scenario ${sc}`)
    const head: Record<string, RunResult[]> = Object.fromEntries(targets.map((t) => [t, []]))
    const dp: Record<string, RunResult[]> = Object.fromEntries(targets.map((t) => [t, []]))
    const round = async (kind: 'headline' | 'deep', rs: Record<string, RunResult[]>) => {
      for (const { target, impl, alias } of prepared) {
        if (quiet) process.stdout.write(JSON.stringify({ type: 'progress', done, total, text: `${sc} ${kind} ${rs[target].length + 1}/${kind === 'deep' ? plan.deep : plan.max}` }) + '\n')
        rs[target].push(await runOnce(impl, sc, alias, kind, child))
        done++
      }
    }
    do {
      await round('headline', head)
    } while (!targets.every((t) => enough(head[t].map((r) => r.totalMs), plan, Date.now() - t0)))
    total -= (plan.max - head[targets[0]].length) * targets.length
    for (let i = 0; i < plan.deep; i++) await round('deep', dp)
    for (const t of targets) report[t][sc] = aggregate(head[t], dp[t])
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

/** Bench of the tick times of the headline runs. It is not `tick`, which is the deep-run column. */
export const HEADLINE_TICK = 'headline-tick'

/** benchbox native protocol v1. Per scenario: one bench per column (per-tick median ns), plus the run totals and the per-tick median GC time. Each scenario also gets `headline-tick`: the tick ns of every timed tick of every headline run. With no deep runs only the run totals and `headline-tick` go out. */
export const writeProtocol = async (target: string, scenarios: string[], plan: RunPlan, child = DEV_CHILD) => {
  quiet = true
  const t0 = Date.now()
  const out = (r: object) => process.stdout.write(JSON.stringify(r) + '\n')
  out({ type: 'meta', language: 'js', toolchain: process.version, target: `${process.arch}-${process.platform}`, machine: machine(plan) })
  for (const sc of scenarios) {
    const group = `${sc}/${target}`
    try {
      const a = (await bench([target], [sc], plan, child, t0))[target][sc]
      const ns = (ms: number) => Math.round(ms * 1e6)
      if (a.deep) COLS.forEach((c, i) => out({ type: 'bench', group, name: c, ordered: true, samples: a.deep!.ticks.map((r) => ns(r[i])) }))
      out({ type: 'bench', group, name: 'total', ordered: true, samples: a.samples.total.map(ns) })
      // Not ordered: the runs are pooled, and tick t of one run has no pairing with tick t of another (the run counts differ across targets and the adaptive plan stops early). benchbox then uses its sorted quantile grid if it must cap the series. Size: at most max runs x ticks = 10 x about 2250 timed ticks (battle, loads replay ticks) = about 22k samples, under benchbox's 50k cap (DEFAULT_MAX_SAMPLES), so there is no subsampling.
      out({ type: 'bench', group, name: HEADLINE_TICK, samples: a.tickSamples.map(ns) })
      if (a.deep) out({ type: 'bench', group, name: 'gc', ordered: true, samples: a.deep.ticks.map((r) => ns(r[COLS.length])) })
    } catch (e) {
      // A golden hash mismatch exits the child with code 3, so a wrong result never gives samples.
      for (const c of plan.deep ? [...COLS, 'total', HEADLINE_TICK, 'gc'] : ['total', HEADLINE_TICK]) out({ type: 'error', group, name: c, message: String(e) })
    }
  }
}

export const parseCli = (argv: string[]) => {
  const { positionals, values } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: { runs: { type: 'string' }, out: { type: 'string' }, record: { type: 'boolean', default: false }, deep: { type: 'boolean', default: false }, protocol: { type: 'boolean', default: !!process.env.BENCHBOX_PROTOCOL } },
  })
  const deep = values.record || values.deep ? 2 : 0
  const plan = planFor(values.runs === undefined ? undefined : Number(values.runs), deep > 0)
  return { pos: positionals, plan, out: values.out, record: values.record, protocol: values.protocol }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { pos, plan, out, record, protocol } = parseCli(process.argv.slice(2))
  const scenarios = pos.filter((p) => SCENARIOS[p])
  const targets = pos.filter((p) => !SCENARIOS[p])
  if (targets.length === 0 || scenarios.length === 0 || (protocol && targets.length > 1)) {
    console.error('usage: pnpm bench <impl[@variant]...> <scenario...> [--runs N] [--deep] [--out results/x.json] [--record] [--protocol]')
    process.exit(2)
  }
  if (protocol) {
    await writeProtocol(targets[0], scenarios, plan)
    process.exit(0)
  }
  const report = await bench(targets, scenarios, plan)
  printTable(report)
  printScores(report)
  if (out) {
    mkdirSync(dirname(resolve(out)), { recursive: true })
    writeFileSync(out, JSON.stringify({ machine: machine(plan), report }, (k, v) => (k === 'ticks' || k === 'tickSamples' ? undefined : v), 2))
  }
  if (record) {
    recordReport(report)
    writeResultsPage()
  }
}
