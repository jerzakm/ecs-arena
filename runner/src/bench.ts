import { fork } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { SCENARIOS } from '@ecs-arena/spec'
import { aggregate, type Aggregate, type RunResult } from './stats.ts'
import { ensureVariant, parseTarget } from './variants.ts'

const HERE = dirname(fileURLToPath(import.meta.url))

const runOnce = (impl: string, scenario: string, alias: Record<string, string>): Promise<RunResult> =>
  new Promise((res, rej) => {
    // Fresh process per run so JIT/heap state never leaks. tsx loads the TS; alias hook resolves variant imports.
    const child = fork(resolve(HERE, 'bench-child.ts'), [impl, scenario], {
      execArgv: ['--import', 'tsx', '--import', pathToFileURL(resolve(HERE, 'alias-register.mjs')).href, '--expose-gc'],
      env: { ...process.env, ECS_ALIAS: JSON.stringify(alias) },
    })
    let result: RunResult | undefined
    child.on('message', (m) => (result = m as RunResult))
    child.on('exit', (code) => (code === 0 && result ? res(result) : rej(new Error(`child ${impl} ${scenario} exited ${code}`))))
  })

export type BenchReport = Record<string, Record<string, Aggregate>>

export const bench = async (targets: string[], scenarios: string[], runs: number): Promise<BenchReport> => {
  const report: BenchReport = {}
  for (const target of targets) {
    const { impl, variant } = parseTarget(target)
    const alias: Record<string, string> = variant ? { koota: ensureVariant(variant) } : {}
    report[target] = {}
    for (const sc of scenarios) {
      if (!SCENARIOS[sc]) throw new Error(`unknown scenario ${sc}`)
      const rs: RunResult[] = []
      for (let i = 0; i < runs; i++) rs.push(await runOnce(impl, sc, alias))
      report[target][sc] = aggregate(rs)
    }
  }
  return report
}

export const printTable = (report: BenchReport) => {
  const f = (n: number) => n.toFixed(1).padStart(9)
  for (const [target, byScenario] of Object.entries(report)) {
    for (const [sc, a] of Object.entries(byScenario)) {
      console.log(`\n${target} ${sc} (${a.runs} runs)   median / p95`)
      const row = (label: string, s: { median: number; p95: number }, div = 1) =>
        console.log(`  ${label.padEnd(10)}${f(s.median / div)}${f(s.p95 / div)}`)
      row('total ms', a.totalMs)
      for (const [p, s] of Object.entries(a.phasesMs)) row(p, s)
      row('heap MB', a.peakHeap, 1048576)
    }
  }
}

export const parseArgs = (argv: string[]) => {
  const pos: string[] = []
  const opt: Record<string, string> = {}
  for (let i = 0; i < argv.length; i++) argv[i].startsWith('--') ? (opt[argv[i].slice(2)] = argv[++i]) : pos.push(argv[i])
  return { pos, runs: Number(opt.runs ?? 5), out: opt.out }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { pos: [target, ...scenarios], runs, out } = parseArgs(process.argv.slice(2))
  if (!target || scenarios.length === 0) {
    console.error('usage: pnpm bench <impl[@variant]> <scenario...> [--runs N] [--out results/x.json]')
    process.exit(2)
  }
  const report = await bench([target], scenarios, runs)
  printTable(report)
  if (out) {
    mkdirSync(dirname(resolve(out)), { recursive: true })
    writeFileSync(out, JSON.stringify(report, null, 2))
  }
}
