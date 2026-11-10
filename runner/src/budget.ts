// Load budget check (D17). Times baseline-js regions normally and once per region with its naive code.
// Every run is a fresh child process that warms up with a full run of the same variant first. Runs are
// interleaved across variants, and the verdicts use medians over --runs runs.
// Usage: pnpm budget [scenario...] [--seeds] [--report-only] [--runs N]
import { spawnSync } from 'node:child_process'
import { parseArgs } from 'node:util'
import { GAMES, SEEDS, findScenario, runPhases, hashState, withSeed, type BaseScenario } from '@ecs-arena/spec'
import { HARNESS, loadBaseline, type BaselineSim } from './games.ts'
import { isMain, parseRuns } from './cli.ts'
import { wrapped } from './wrap.ts'
import { runScheduled } from './schedule.ts'
import { CAP, FLOOR, MIN_NAIVE_RATIO, exitCode, judge, summarize, type Verdict } from './budget-check.ts'

const HASH_EVERY = 25

interface Run { total: number; self: Map<string, number>; hashes: string[] }

/** One run. A region's time excludes the regions nested in it. Hashing happens outside the timed part of a tick. */
export const timeRun = (createSim: BaselineSim, scenario: BaseScenario, naive: string | null): Run => {
  const { game } = findScenario(scenario.name)
  const self = new Map<string, number>()
  const stack: { name: string; t0: number; child: number }[] = []
  const regions = {
    naive: new Set(naive ? [naive] : []),
    begin: (name: string) => void stack.push({ name, t0: performance.now(), child: 0 }),
    end: () => {
      const f = stack.pop()!
      const dt = performance.now() - f.t0
      self.set(f.name, (self.get(f.name) ?? 0) + dt - f.child)
      if (stack.length) stack[stack.length - 1].child += dt
    },
  }
  const sim = createSim(scenario, game.kernel, undefined, regions)
  let total = 0
  const hashes: string[] = []
  runScheduled(sim, scenario, {
    tick: () => {
      const t0 = performance.now()
      runPhases(game, sim)
      total += performance.now() - t0
    },
    after: (t) => { if (t % HASH_EVERY === 0 || t === scenario.ticks - 1) hashes.push(hashState(sim.snapshot())) },
    timed: (_, run) => { const t0 = performance.now(); run(); total += performance.now() - t0 },
  })
  return { total, self, hashes }
}

/** Child mode: warm up with a full run of the variant, then print the timed run as JSON. */
const child = async (name: string, seed: number, naive: string) => {
  const { game, scenario } = findScenario(name)
  const createSim = await loadBaseline(game)
  const sc = withSeed(scenario, seed)
  const v = naive === '-' ? null : naive
  timeRun(createSim, sc, v)
  const r = timeRun(createSim, sc, v)
  console.log(JSON.stringify({ total: r.total, self: [...r.self], hashes: r.hashes }))
}

const spawnRun = (name: string, seed: number, naive: string): Run => {
  const { execPath, execArgv } = wrapped(['--import', 'tsx'])
  const out = spawnSync(execPath, [...execArgv, import.meta.filename, '--child', name, String(seed), naive], { encoding: 'utf8', maxBuffer: 1 << 26 })
  if (out.status !== 0) throw new Error(`child ${name} ${naive} failed: ${out.stderr}`)
  const r = JSON.parse(out.stdout)
  return { total: r.total, self: new Map(r.self), hashes: r.hashes }
}

const mark = (ok: boolean) => (ok ? 'PASS' : 'FAIL')
const pct = (x: number) => (x * 100).toFixed(2)
const range = (xs: number[], f: (x: number) => string) => { const s = summarize(xs); return `${f(s.min)}-${f(s.max)}` }

const med = (xs: number[]) => summarize(xs).median

/** What the table shows for one region: medians over the runs, the spread of each, and the verdict. */
interface RegionRow {
  share: number
  shares: number[]
  naiveShare: number
  ratio: number
  ratios: number[]
  tickRatio: number
  sameHash: boolean
  verdict: Verdict
}

/** `normal[k]` and `naive[k]` are run k of the normal variant and of the variant with this region's naive code. */
const regionRow = (region: string, normal: Run[], naive: Run[]): RegionRow => {
  const selfOf = (run: Run) => run.self.get(region) ?? 0
  const shares = normal.map((n) => selfOf(n) / n.total)
  const ratios = naive.map((x, k) => (selfOf(normal[k]) === 0 ? Infinity : selfOf(x) / selfOf(normal[k])))
  const share = med(shares)
  const naiveShare = med(naive.map((x, k) => selfOf(x) / normal[k].total))
  const ratio = med(ratios)
  return {
    share, shares, naiveShare, ratio, ratios,
    tickRatio: med(naive.map((x, k) => x.total / normal[k].total)),
    sameHash: naive.every((x) => x.hashes.every((h, j) => h === normal[0].hashes[j])),
    verdict: judge(share, naiveShare, ratio),
  }
}

const HEADER =
  `${'region'.padEnd(18)}${'share %'.padStart(7)} ${'spread'.padStart(11)}  cap   ${'naive share %'.padStart(13)}  floor  ` +
  `${'naive/normal'.padStart(12)} ${'spread'.padStart(11)}  ratio  ${'tick ratio'.padStart(10)}  hash`

const formatRow = (region: string, row: RegionRow): string =>
  `${region.padEnd(18)}${pct(row.share).padStart(7)} ${range(row.shares, pct).padStart(11)}  ${mark(row.verdict.cap)}  ` +
  `${pct(row.naiveShare).padStart(13)}  ${mark(row.verdict.floor)}  ` +
  `${(row.ratio.toFixed(2) + 'x').padStart(12)} ${range(row.ratios, (x) => x.toFixed(2)).padStart(11)}  ${mark(row.verdict.ratio)}   ` +
  `${(row.tickRatio.toFixed(2) + 'x').padStart(10)}  ${row.sameHash ? 'same' : 'DIFFERENT'}`

const main = (): number => {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    options: { 'report-only': { type: 'boolean', default: false }, seeds: { type: 'boolean', default: false }, runs: { type: 'string' } },
  })
  const reportOnly = values['report-only']
  let runs: number
  try {
    runs = parseRuns(values.runs) ?? 5
  } catch (e) {
    console.error((e as Error).message)
    return 2
  }
  const seeds = values.seeds ? SEEDS.map((_, i) => i) : [0]
  const names = positionals.length > 0 ? positionals : GAMES.flatMap((g) => g.board)
  const verdicts: Verdict[] = []
  for (const name of names) {
    const { game, scenario } = findScenario(name)
    const REGIONS = HARNESS[game.id].regionsFor(name)
    for (const i of seeds) {
      const normal: Run[] = []
      const naive = new Map<string, Run[]>(REGIONS.map((r) => [r, []]))
      for (let k = 0; k < runs; k++) {
        normal.push(spawnRun(name, i, '-'))
        for (const r of REGIONS) naive.get(r)!.push(spawnRun(name, i, r))
      }
      const tick = med(normal.map((n) => n.total))
      console.log(`\n== ${name} seed ${i + 1} (${scenario.ticks} ticks, tick total ${(tick / 1000).toFixed(2)} s, median of ${runs} runs, spread min-max)`)
      console.log(HEADER)
      let attributed = 0
      for (const r of REGIONS) {
        const row = regionRow(r, normal, naive.get(r)!)
        attributed += row.share
        verdicts.push(row.verdict, { floor: true, cap: true, ratio: row.sameHash })
        console.log(formatRow(r, row))
      }
      console.log(`${'unattributed'.padEnd(18)}${pct(1 - attributed).padStart(7)}`)
    }
  }
  console.log(`\nfloor ${FLOOR * 100}% of the tick on the naive share, cap ${CAP * 100}% on the normal share (D20), naive region time at least ${MIN_NAIVE_RATIO}x normal region time`)
  return exitCode(verdicts, reportOnly)
}

if (isMain(import.meta)) {
  // `--child <scenario> <seed> <naive region or ->` is the protocol of spawnRun, never typed by hand.
  const [mode, name, seed, naive] = process.argv.slice(2)
  if (mode === '--child') await child(name, Number(seed), naive)
  else process.exit(main())
}
