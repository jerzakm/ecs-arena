// Work-count profile of baseline-js. Counts ECS operations per tick, never time. Usage: pnpm run profile <scenario...>
import { isMain } from './cli.ts'
import { parseArgs } from 'node:util'
import { SEEDS, findScenario, runPhases, withSeed, type BaseScenario } from '@ecs-arena/spec'
import { runScheduled } from './schedule.ts'
import { harnessOf, loadBaseline, type BaselineSim } from './games.ts'
import type { Counters } from '../../impls/baseline-js/src/shared/instrumentation.ts'

export interface Stat { total: number; mean: number; max: number }
export interface Profile { ticks: number; counts: Record<string, Stat>; gauges: Record<string, Stat> }

export const profile = (createSim: BaselineSim, scenario: BaseScenario): Profile => {
  const { game } = findScenario(scenario.name)
  const cum = new Map<string, number>()
  const gauge = new Map<string, number>() // max within the current tick
  const counters: Counters = {
    add: (n, v = 1) => void cum.set(n, (cum.get(n) ?? 0) + v),
    set: (n, v) => void gauge.set(n, Math.max(gauge.get(n) ?? -Infinity, v)),
  }
  const sim = createSim(scenario, game.kernel, counters)
  const counts = new Map<string, Stat>()
  const gauges = new Map<string, Stat>()
  const prev = new Map<string, number>()
  runScheduled(sim, scenario, {
    tick: () => { gauge.clear(); runPhases(game, sim) },
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

const main = async () => {
  const { positionals, values: { json } } = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    options: { json: { type: 'boolean', default: false } },
  })
  if (positionals.length === 0) { console.error('usage: pnpm run profile <scenario...> [--json]'); return 2 }
  const scenarios = positionals.filter((n) => harnessOf(findScenario(n).game) || void console.log(`skip ${n}: no harness`))
  const out: Record<string, Profile> = {}
  const sims = new Map<string, BaselineSim>()
  for (const n of scenarios) {
    const { game, scenario } = findScenario(n)
    if (!sims.has(game.id)) sims.set(game.id, await loadBaseline(game))
    out[n] = profile(sims.get(game.id)!, scenario)
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
  let lowMean = 0
  for (const n of scenarios) {
    const { game, scenario } = findScenario(n)
    const perSeed = SEEDS.map((_, i) => (i === 0 ? out[n] : profile(sims.get(game.id)!, withSeed(scenario, i))).counts)
    for (const [rule, counter, , minMean] of harnessOf(game)!.livenessFor(n)) {
      const totals = perSeed.map((c) => c[counter]?.total ?? 0)
      const low = minMean !== undefined && totals.some((t) => t / scenario.ticks < minMean)
      if (totals.includes(0)) dead++
      else if (low) lowMean++
      console.log(`${n.padEnd(9)} ${rule.padEnd(24)} ${counter.padEnd(20)} ${totals.map((t) => String(t).padStart(8)).join(' ')}${totals.includes(0) ? '  DEAD' : low ? `  LOW (mean per tick below ${minMean})` : ''}`)
    }
  }
  if (dead > 0 || lowMean > 0) { console.error(`liveness FAILED: ${dead} rule rows have a zero counter and ${lowMean} have a mean per tick below the floor`); return 1 }
  console.log('liveness ok: no zero counter and no mean below its floor')
  return 0
}

if (isMain(import.meta)) process.exit(await main())
