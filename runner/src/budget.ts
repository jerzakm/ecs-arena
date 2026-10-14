// Load budget check (D17). Runs baseline-js with timed regions, then once more for each region with its naive code.
// Usage: pnpm budget [scenario...] [--seeds] [--report-only]
import { SCENARIOS, SEEDS, PHASES, hashState, kernel, withSeed, type Scenario } from '@ecs-arena/spec'
import createSim from '../../impls/baseline-js/src/index.ts'
import { CAP, FLOOR, MIN_NAIVE_RATIO, exitCode, judge, type Verdict } from './budget-check.ts'

export const REGIONS = [
  'move.step', 'churn', 'effects.buffs', 'cleanup.unlink', 'move.depthOrder', 'cleanup.cascade', 'links',
  'objectives.capture', 'morale.rout', 'morale.onFlee', 'stats.recompute', 'threat', 'cleanup.credit', 'grid.update',
]
const HASH_EVERY = 25

interface Run { total: number; self: Map<string, number>; hashes: string[] }

/** One run. A region's time excludes the regions nested in it. Hashing happens outside the timed part of a tick. */
const timeRun = (scenario: Scenario, naive: string | null, ticks = scenario.ticks): Run => {
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
  for (let t = 0; t < ticks; t++) {
    const t0 = performance.now()
    for (const p of PHASES) sim.phases[p]()
    total += performance.now() - t0
    if (t % HASH_EVERY === 0 || t === ticks - 1) hashes.push(hashState(sim.snapshot()))
  }
  return { total, self, hashes }
}

const mark = (ok: boolean) => (ok ? 'PASS' : 'FAIL')

const main = (): number => {
  const args = process.argv.slice(2)
  const reportOnly = args.includes('--report-only')
  const seeds = args.includes('--seeds') ? SEEDS.map((_, i) => i) : [0]
  const names = args.filter((a) => !a.startsWith('--'))
  if (names.length === 0) names.push('skirmish', 'battle', 'war')
  const verdicts: Verdict[] = []
  for (const name of names) {
    if (!SCENARIOS[name]) { console.error(`unknown scenario ${name}`); return 2 }
    for (const i of seeds) {
      const sc = withSeed(SCENARIOS[name], i)
      timeRun(sc, null, Math.min(300, sc.ticks)) // warm the JIT
      const base = timeRun(sc, null)
      console.log(`\n== ${name} seed ${i + 1} (${sc.ticks} ticks, ${(base.total / 1000).toFixed(1)} s)`)
      console.log(`${'region'.padEnd(20)}${'share'.padStart(8)}  floor cap   ${'naive/normal'.padStart(12)}  ratio  hash`)
      let attributed = 0
      for (const r of REGIONS) {
        const normal = base.self.get(r) ?? 0
        attributed += normal
        const naive = timeRun(sc, r)
        const sameHash = naive.hashes.every((h, j) => h === base.hashes[j])
        const share = normal / base.total
        const ratio = normal === 0 ? Infinity : (naive.self.get(r) ?? 0) / normal
        const v = judge(share, ratio)
        verdicts.push(v, { floor: true, cap: true, ratio: sameHash })
        console.log(`${r.padEnd(20)}${(share * 100).toFixed(2).padStart(7)}%  ${mark(v.floor)} ${mark(v.cap)} ${(ratio.toFixed(2) + 'x').padStart(12)}  ${mark(v.ratio)}   ${sameHash ? 'same' : 'DIFFERENT'}`)
      }
      console.log(`${'unattributed'.padEnd(20)}${(((base.total - attributed) / base.total) * 100).toFixed(2).padStart(7)}%`)
    }
  }
  console.log(`\nfloor ${FLOOR * 100}%, cap ${CAP * 100}%, naive at least ${MIN_NAIVE_RATIO}x`)
  return exitCode(verdicts, reportOnly)
}

process.exit(main())
