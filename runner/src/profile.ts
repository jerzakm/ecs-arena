// Work-count profile of baseline-js. Counts ECS operations per tick, never time. Usage: pnpm run profile <scenario...>
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SCENARIOS, SEEDS, PHASES, kernel, withSeed, type Scenario } from '@ecs-arena/spec'
import { runScheduled } from './schedule.ts'
import { LIVENESS } from './liveness.ts'
import createSim, { type Counters } from '../../impls/baseline-js/src/index.ts'

export interface Stat { total: number; mean: number; max: number }
export interface Profile { ticks: number; counts: Record<string, Stat>; gauges: Record<string, Stat> }

export const profile = (scenario: Scenario): Profile => {
  const cum = new Map<string, number>()
  const gauge = new Map<string, number>() // max within the current tick
  const counters: Counters = {
    add: (n, v = 1) => void cum.set(n, (cum.get(n) ?? 0) + v),
    set: (n, v) => void gauge.set(n, Math.max(gauge.get(n) ?? -Infinity, v)),
  }
  const sim = createSim(scenario, kernel, counters)
  const counts = new Map<string, Stat>()
  const gauges = new Map<string, Stat>()
  const prev = new Map<string, number>()
  runScheduled(sim, scenario, {
    tick: () => { gauge.clear(); for (const p of PHASES) sim.phases[p]() },
    after: () => {
      for (const [n, v] of cum) {
        const d = v - (prev.get(n) ?? 0)
        prev.set(n, v)
        const s = counts.get(n) ?? { total: 0, mean: 0, max: 0 }
        s.total += d; s.max = Math.max(s.max, d)
        counts.set(n, s)
      }
      for (const [n, v] of gauge) {
        const s = gauges.get(n) ?? { total: 0, mean: 0, max: 0 }
        s.total += v; s.max = Math.max(s.max, v)
        gauges.set(n, s)
      }
    },
  })
  for (const m of [counts, gauges]) for (const s of m.values()) s.mean = s.total / scenario.ticks
  const obj = (m: Map<string, Stat>) => Object.fromEntries([...m].sort(([a], [b]) => a.localeCompare(b)))
  return { ticks: scenario.ticks, counts: obj(counts), gauges: obj(gauges) }
}

const main = () => {
  const names = process.argv.slice(2)
  if (names.length === 0) { console.error('usage: pnpm run profile <scenario...> [--json]'); return 2 }
  const json = names.includes('--json')
  const out: Record<string, Profile> = {}
  const scenarios = names.filter((a) => a !== '--json')
  for (const n of scenarios) {
    if (!SCENARIOS[n]) { console.error(`unknown scenario ${n}`); return 2 }
    out[n] = profile(SCENARIOS[n])
  }
  if (json) console.log(JSON.stringify(out))
  else for (const [n, p] of Object.entries(out)) {
    console.log(`== ${n} (${p.ticks} ticks)`)
    const row = (k: string, s: Stat) => console.log(`${k.padEnd(32)} total ${s.total.toFixed(0).padStart(10)}  mean ${s.mean.toFixed(1).padStart(9)}  max ${s.max.toFixed(0).padStart(8)}`)
    for (const [k, s] of Object.entries(p.gauges)) row(k, s)
    for (const [k, s] of Object.entries(p.counts)) row(k, s)
  }
  if (json) return 0
  // The liveness check runs every seed: a rule that one seed never reaches fails too.
  console.log(`\nliveness: total of each rule counter, one column for each seed (${SEEDS.length})`)
  let dead = 0
  for (const n of scenarios) {
    const perSeed = SEEDS.map((_, i) => (i === 0 ? out[n] : profile(withSeed(SCENARIOS[n], i))).counts)
    for (const [rule, counter] of LIVENESS) {
      const totals = perSeed.map((c) => c[counter]?.total ?? 0)
      if (totals.includes(0)) dead++
      console.log(`${n.padEnd(9)} ${rule.padEnd(24)} ${counter.padEnd(20)} ${totals.map((t) => String(t).padStart(8)).join(' ')}${totals.includes(0) ? '  DEAD' : ''}`)
    }
  }
  if (dead > 0) { console.error(`liveness FAILED: ${dead} rule rows have a zero counter`); return 1 }
  console.log('liveness ok: no zero counter')
  return 0
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(dirname(fileURLToPath(import.meta.url)), 'profile.ts')) process.exit(main())
