import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { findPackageJSON } from 'node:module'
import { pathToFileURL } from 'node:url'
import { SCENARIOS, hashState, kernel, PHASES, type CreateSim } from '@ecs-arena/spec'
import type { RunResult } from './stats.ts'

const ROOT = resolve(import.meta.dirname, '../..')
const [impl, name, warmupArg] = process.argv.slice(2)
const warmup = Number(warmupArg ?? 200)
const scenario = SCENARIOS[name]
const createSim = (await import(pathToFileURL(resolve(ROOT, 'impls', impl, 'src/index.ts')).href)).default as CreateSim

const implEntry = pathToFileURL(resolve(ROOT, 'impls', impl, 'src/index.ts')).href
console.log(`koota -> ${process.env.ECS_ALIAS?.includes('"koota"') ? import.meta.resolve('koota') : findPackageJSON('koota', implEntry)}`)

// Warm the JIT on a throwaway sim, then time a fresh one.
const warm = createSim(scenario, kernel)
for (let t = 0; t < warmup; t++) for (const p of PHASES) warm.phases[p]()
globalThis.gc?.()

const mu = process.memoryUsage as typeof process.memoryUsage & { heapUsed?: () => number }
const heap = () => mu.heapUsed?.() ?? process.memoryUsage().heapUsed
const phasesMs = Object.fromEntries(PHASES.map((p) => [p, 0])) as Record<string, number>
let peakHeap = 0
const sim = createSim(scenario, kernel)
const t0 = performance.now()
for (let t = 0; t < scenario.ticks; t++) {
  for (const p of PHASES) {
    const s = performance.now()
    sim.phases[p]()
    phasesMs[p] += performance.now() - s
  }
  peakHeap = Math.max(peakHeap, heap()) // once per tick, outside the phase timers (still inside totalMs; compare sum(phases) to see it)
}
const totalMs = performance.now() - t0

const hash = hashState(sim.snapshot())
const golden = resolve(ROOT, 'goldens', `${name}.json`)
let golden_ok: boolean | null = null
if (existsSync(golden)) {
  const g = JSON.parse(readFileSync(golden, 'utf8')) as string[]
  golden_ok = g[g.length - 1] === hash
  if (!golden_ok) {
    console.error(`HASH MISMATCH ${impl} ${name}: final ${hash}, golden ${g[g.length - 1]}`)
    process.exit(3)
  }
}
process.send!({ totalMs, phasesMs, peakHeap } satisfies RunResult, () => process.exit(0))
