// Load budget check (D17). Times baseline-js regions normally and once per region with its naive code.
// Every run is a fresh child process that warms up with a full run of the same variant first. Runs are
// interleaved across variants, and the verdicts use medians over --runs runs.
// Usage: pnpm budget [scenario...] [--seeds] [--report-only] [--runs N]
import { spawnSync } from 'node:child_process'
import { SCENARIOS, SEEDS, runPhases, hashState, kernel, withSeed, type Scenario } from '@ecs-arena/spec'
import createSim from '../../impls/baseline-js/src/index.ts'
import { runScheduled } from './schedule.ts'
import { CAP, FLOOR, MIN_NAIVE_RATIO, exitCode, judge, summarize, type Verdict } from './budget-check.ts'

export const REGIONS = [
  'move.step', 'churn', 'effects.buffs', 'cleanup.unlink', 'move.depthOrder', 'cleanup.cascade', 'links',
  'objectives.capture', 'morale.rout', 'morale.onFlee', 'stats.recompute', 'stats.setBonus', 'stats.banner', 'combat.fanIn', 'threat', 'cleanup.credit', 'grid.update', 'garrison', 'orders.lookup', 'stats.render', 'save', 'load',
]
const HASH_EVERY = 25

interface Run { total: number; self: Map<string, number>; hashes: string[] }

/** One run. A region's time excludes the regions nested in it. Hashing happens outside the timed part of a tick. */
export const timeRun =(scenario: Scenario, naive: string | null): Run => {
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
  const sim = createSim(scenario, kernel, undefined, regions)
  let total = 0
  const hashes: string[] = []
  runScheduled(sim, scenario, {
    tick: () => {
      const t0 = performance.now()
      runPhases(sim)
      total += performance.now() - t0
    },
    after: (t) => { if (t % HASH_EVERY === 0 || t === scenario.ticks - 1) hashes.push(hashState(sim.snapshot())) },
    timed: (_, run) => { const t0 = performance.now(); run(); total += performance.now() - t0 },
  })
  return { total, self, hashes }
}

/** Child mode: warm up with a full run of the variant, then print the timed run as JSON. */
const child = (name: string, seed: number, naive: string) => {
  const sc = withSeed(SCENARIOS[name], seed)
  const v = naive === '-' ? null : naive
  timeRun(sc, v)
  const r = timeRun(sc, v)
  console.log(JSON.stringify({ total: r.total, self: [...r.self], hashes: r.hashes }))
}

const spawnRun = (name: string, seed: number, naive: string): Run => {
  const out = spawnSync(process.execPath, ['--import', 'tsx', import.meta.filename, '--child', name, String(seed), naive], { encoding: 'utf8', maxBuffer: 1 << 26 })
  if (out.status !== 0) throw new Error(`child ${name} ${naive} failed: ${out.stderr}`)
  const r = JSON.parse(out.stdout)
  return { total: r.total, self: new Map(r.self), hashes: r.hashes }
}

const mark = (ok: boolean) => (ok ? 'PASS' : 'FAIL')
const pct = (x: number) => (x * 100).toFixed(2)
const range = (xs: number[], f: (x: number) => string) => { const s = summarize(xs); return `${f(s.min)}-${f(s.max)}` }

const main = (): number => {
  const args = process.argv.slice(2)
  const reportOnly = args.includes('--report-only')
  const ri = args.indexOf('--runs')
  const runs = ri >= 0 ? Number(args[ri + 1]) : 5
  if (!(runs >= 1)) { console.error('--runs needs a positive number'); return 2 }
  const seeds = args.includes('--seeds') ? SEEDS.map((_, i) => i) : [0]
  const names = args.filter((a, i) => !a.startsWith('--') && (ri < 0 || i !== ri + 1))
  if (names.length === 0) names.push('skirmish', 'battle', 'war')
  const verdicts: Verdict[] = []
  for (const name of names) {
    if (!SCENARIOS[name]) { console.error(`unknown scenario ${name}`); return 2 }
    for (const i of seeds) {
      const normal: Run[] = []
      const naive = new Map<string, Run[]>(REGIONS.map((r) => [r, []]))
      for (let k = 0; k < runs; k++) {
        normal.push(spawnRun(name, i, '-'))
        for (const r of REGIONS) naive.get(r)!.push(spawnRun(name, i, r))
      }
      const med = (xs: number[]) => summarize(xs).median
      const tick = med(normal.map((n) => n.total))
      console.log(`\n== ${name} seed ${i + 1} (${SCENARIOS[name].ticks} ticks, tick total ${(tick / 1000).toFixed(2)} s, median of ${runs} runs, spread min-max)`)
      console.log(`${'region'.padEnd(18)}${'share %'.padStart(7)} ${'spread'.padStart(11)}  cap   ${'naive share %'.padStart(13)}  floor  ${'naive/normal'.padStart(12)} ${'spread'.padStart(11)}  ratio  ${'tick ratio'.padStart(10)}  hash`)
      let attributed = 0
      for (const r of REGIONS) {
        const nv = naive.get(r)!
        const sh = normal.map((n) => (n.self.get(r) ?? 0) / n.total)
        const ra = nv.map((x, k) => ((normal[k].self.get(r) ?? 0) === 0 ? Infinity : (x.self.get(r) ?? 0) / normal[k].self.get(r)!))
        const nsh = nv.map((x, k) => (x.self.get(r) ?? 0) / normal[k].total)
        const tr = med(nv.map((x, k) => x.total / normal[k].total))
        const sameHash = nv.every((x) => x.hashes.every((h, j) => h === normal[0].hashes[j]))
        const share = med(sh)
        const ratio = med(ra)
        attributed += share
        const nshare = med(nsh)
        const v = judge(share, nshare, ratio)
        verdicts.push(v, { floor: true, cap: true, ratio: sameHash })
        console.log(`${r.padEnd(18)}${pct(share).padStart(7)} ${range(sh, pct).padStart(11)}  ${mark(v.cap)}  ${pct(nshare).padStart(13)}  ${mark(v.floor)}  ${(ratio.toFixed(2) + 'x').padStart(12)} ${range(ra, (x) => x.toFixed(2)).padStart(11)}  ${mark(v.ratio)}   ${(tr.toFixed(2) + 'x').padStart(10)}  ${sameHash ? 'same' : 'DIFFERENT'}`)
      }
      console.log(`${'unattributed'.padEnd(18)}${pct(1 - attributed).padStart(7)}`)
    }
  }
  console.log(`\nfloor ${FLOOR * 100}% of the tick on the naive share, cap ${CAP * 100}% on the normal share (D20), naive region time at least ${MIN_NAIVE_RATIO}x normal region time`)
  return exitCode(verdicts, reportOnly)
}

if (process.argv[1] === import.meta.filename) {
  if (process.argv[2] === '--child') child(process.argv[3], Number(process.argv[4]), process.argv[5])
  else process.exit(main())
}
