import { fork } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { findScenario, GAMES, hasScenario } from '@ecs-arena/spec'
import { aggregate, CLOCK_DRIFT_MAX, enough, planFor, type Aggregate, type RunPlan, type RunResult } from './stats.ts'
import { scoreByGame } from './games.ts'
import { commit, recordReport, writeResultsPage } from './results.ts'
import { cpus, platform, release } from 'node:os'
import { ensureVariant, parseTarget } from './variants.ts'
import { WRAP, wrapped } from './wrap.ts'
import { isMain, parseRuns } from './cli.ts'

const HERE = dirname(fileURLToPath(import.meta.url))

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

const ROOT = resolve(HERE, '../..')

/** How to start a child run: the script, its node flags and the directory it runs in. */
export interface ChildCmd {
  script: string
  execArgv: string[]
  cwd: string
}

/** The child of the repo tree at `root`. It loads TS through tsx and resolves variant imports through the alias hook, all from that tree. */
export const treeChild = (root: string): ChildCmd => ({
  script: resolve(root, 'runner/src/bench-child.ts'),
  execArgv: ['--import', 'tsx', '--import', pathToFileURL(resolve(root, 'runner/src/alias-register.mjs')).href],
  cwd: root,
})

/** What one bench target runs: the impl, the import aliases of its koota variant and the child to fork. */
export interface Runner {
  impl: string
  alias: Record<string, string>
  cmd: ChildCmd
}

/** A plain target runs the impl of this tree. `impl@variant` swaps its koota for the variant build. */
export const currentTree = (target: string): Runner => {
  const { impl, variant } = parseTarget(target)
  return { impl, alias: variant ? { koota: ensureVariant(variant) } : {}, cmd: treeChild(ROOT) }
}

const runOnce = ({ impl, alias, cmd }: Runner, scenario: string, kind: 'headline' | 'deep'): Promise<RunResult> =>
  new Promise((res, rej) => {
    // Fresh process per run so JIT/heap state never leaks.
    const child = fork(cmd.script, [impl, scenario, kind], {
      cwd: cmd.cwd,
      ...wrapped([...cmd.execArgv, '--expose-gc']),
      env: { ...process.env, ECS_ALIAS: JSON.stringify(alias) },
    })
    child.stdout?.pipe(process.stderr)
    child.stderr?.pipe(process.stderr)
    let result: RunResult | undefined
    child.on('message', (m) => (result = m as RunResult))
    child.on('exit', (code) => (code === 0 && result ? res(result) : rej(new Error(`child ${impl} ${scenario} exited ${code}`))))
  })

export type BenchReport = Record<string, Record<string, Aggregate>>

/** Headline runs are interleaved target by target (ABAB...) so machine drift hits every target alike. They go on until every target has `enough` runs, so all targets keep the same count. Then `plan.deep` interleaved deep-dive runs follow. `runnerOf` says what each target name runs, so a target can come from another tree of this repo. */
export const bench = async (targets: string[], scenarios: string[], plan: RunPlan, runnerOf = currentTree, deepFor: (sc: string) => boolean = () => true): Promise<BenchReport> => {
  const t0 = Date.now()
  const prepared = targets.map((target) => ({ target, runner: runnerOf(target) }))
  const report: BenchReport = Object.fromEntries(targets.map((t) => [t, {}]))
  for (const sc of scenarios) {
    findScenario(sc)
    const head: Record<string, RunResult[]> = Object.fromEntries(targets.map((t) => [t, []]))
    const dp: Record<string, RunResult[]> = Object.fromEntries(targets.map((t) => [t, []]))
    const round = async (kind: 'headline' | 'deep', rs: Record<string, RunResult[]>) => {
      for (const { target, runner } of prepared) {
        rs[target].push(await runOnce(runner, sc, kind))
      }
    }
    do {
      await round('headline', head)
    } while (!targets.every((t) => enough(head[t].map((r) => r.totalMs), plan, Date.now() - t0)))
    for (let i = 0; i < (deepFor(sc) ? plan.deep : 0); i++) await round('deep', dp)
    for (const t of targets) report[t][sc] = aggregate(head[t], dp[t])
  }
  return report
}

export const printTable = (report: BenchReport) => {
  for (const [target, byScenario] of Object.entries(report)) {
    for (const [sc, a] of Object.entries(byScenario)) {
      console.log(`\n${target} ${sc} (${a.runs} runs)`)
      console.log(`spread ${(a.spread * 100).toFixed(1)}%, min detectable change ${(a.minDetectable * 100).toFixed(1)}% at ${a.runs} runs`)
      if (a.unstable !== undefined) console.log(`unstable runs (clock drifted over ${CLOCK_DRIFT_MAX * 100}%): ${a.unstable}/${a.runs}`)
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

/** The headline score of each game in the report, from the raw totals. */
export const scoresOf = (report: BenchReport) => {
  const totalsOf = (bySc: Record<string, Aggregate>) => Object.fromEntries(Object.entries(bySc).map(([sc, a]) => [sc, a.samples.total]))
  return scoreByGame(Object.fromEntries(Object.entries(report).map(([t, bySc]) => [t, totalsOf(bySc)])))
}

/** What `--out` writes, and what the project page (site/index.html) reads: the machine, the scenarios of each game, the scores and the report. */
export const resultFile = (report: BenchReport, plan: RunPlan) => ({
  machine: machine(plan),
  games: Object.fromEntries(GAMES.map((g) => [g.id, Object.keys(g.scenarios)])),
  /** Ticks each benched scenario executes (loads rewind, so more than its nominal ticks), so the page can show ms per frame. */
  ticks: Object.fromEntries(Object.values(report).flatMap((bySc) => Object.entries(bySc).map(([sc, a]) => [sc, a.frames?.ticks ?? findScenario(sc).scenario.ticks]))),
  scores: scoresOf(report).map(({ game, scores }) => ({ game: game.id, scores })),
  report,
})

export const printScores = (report: BenchReport) => {
  const byGame = scoresOf(report)
  for (const { game, scores } of byGame) {
    console.log(`\n${game.tutorial ? 'tutorial' : 'headline'} score${byGame.length > 1 || game.tutorial ? ` (${game.id})` : ''}: geomean over scenarios of target total / ${game.vanilla ?? 'baseline-js'} total, 95% bootstrap interval, equal rank when intervals overlap`)
    console.table(Object.fromEntries(scores.map((s) => [s.target, { rank: s.rank, score: +s.point.toFixed(3), 'ci95 lo': +s.lo.toFixed(3), 'ci95 hi': +s.hi.toFixed(3) }])))
  }
}

/** Board scenarios are the ones a game is scored on in full: not the -smoke checks and not the sweep- series. */
export const isBoard = (sc: string) => !sc.endsWith('-smoke') && !sc.startsWith('sweep-')

/** The --out file text: minified, with the per-tick deep matrix left out. */
export const outText = (file: unknown) => JSON.stringify(file, (k, v) => (k === 'ticks' && Array.isArray(v) && Array.isArray(v[0]) ? undefined : v))

export const parseCli = (argv: string[]) => {
  const { positionals, values } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: { runs: { type: 'string' }, base: { type: 'string' }, out: { type: 'string' }, record: { type: 'boolean', default: false }, deep: { type: 'boolean', default: false }, 'deep-scenarios': { type: 'string' } },
  })
  const deep = values.record || values.deep ? 2 : 0
  const plan = planFor(parseRuns(values.runs), deep > 0)
  const ds = values['deep-scenarios']
  if (ds !== undefined && ds !== 'board' && ds !== 'all') throw new Error(`--deep-scenarios must be board or all, got "${ds}"`)
  const deepFor = ds === 'board' ? isBoard : () => true
  return { pos: positionals, plan, out: values.out, record: values.record, base: values.base, deepFor }
}

if (isMain(import.meta)) {
  const { pos, plan, out, record, deepFor } = parseCli(process.argv.slice(2))
  const scenarios = pos.filter(hasScenario)
  const targets = pos.filter((p) => !hasScenario(p))
  if (targets.length === 0 || scenarios.length === 0) {
    console.error('usage: pnpm bench <impl[@variant]...> <scenario...> [--runs N] [--deep] [--deep-scenarios board|all] [--out results/x.json] [--record]')
    process.exit(2)
  }
  const report = await bench(targets, scenarios, plan, currentTree, deepFor)
  printTable(report)
  printScores(report)
  if (out) {
    mkdirSync(dirname(resolve(out)), { recursive: true })
    writeFileSync(out, outText(resultFile(report, plan)))
  }
  if (record) {
    recordReport(report)
    writeResultsPage()
  }
}
