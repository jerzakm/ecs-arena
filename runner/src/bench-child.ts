import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { findPackageJSON } from 'node:module'
import v8, { GCProfiler } from 'node:v8'
import { pathToFileURL } from 'node:url'
import { SCENARIOS, hashState, kernel, PHASES, type CreateSim } from '@ecs-arena/spec'
import type { RunResult } from './stats.ts'

const ROOT = resolve(import.meta.dirname, '../..')
const [impl, name, warmupArg] = process.argv.slice(2)
const warmup = Number(warmupArg ?? 200)
const scenario = SCENARIOS[name]
const createSim = (await import(pathToFileURL(resolve(ROOT, 'impls', impl, 'src/index.ts')).href)).default as CreateSim

const implEntry = pathToFileURL(resolve(ROOT, 'impls', impl, 'src/index.ts')).href
// Print which koota build the run uses, so a variant run is easy to confirm.
const usesKoota = 'koota' in (JSON.parse(readFileSync(resolve(ROOT, 'impls', impl, 'package.json'), 'utf8')).dependencies ?? {})
if (usesKoota) console.log(`koota -> ${process.env.ECS_ALIAS?.includes('"koota"') ? import.meta.resolve('koota') : findPackageJSON('koota', implEntry)}`)

// Warm the JIT on a throwaway sim, then time a fresh one.
const warm = createSim(scenario, kernel)
for (let t = 0; t < warmup; t++) for (const p of PHASES) warm.phases[p]()
globalThis.gc?.()

const phasesMs = Object.fromEntries(PHASES.map((p) => [p, 0])) as Record<string, number>
// One row per tick: each phase ms, then tick ms, GC ms, allocated bytes.
const ticks: number[][] = []
let peakHeap = 0
let gcMs = 0
let allocBytes = 0
const sim = createSim(scenario, kernel)
const gcp = new GCProfiler()
const t0 = performance.now()
for (let t = 0; t < scenario.ticks; t++) {
  gcp.start()
  const before = v8.getHeapStatistics().used_heap_size
  const row: number[] = []
  const ts = performance.now()
  for (const p of PHASES) {
    const s = performance.now()
    sim.phases[p]()
    const d = performance.now() - s
    phasesMs[p] += d
    row.push(d)
  }
  const tickMs = performance.now() - ts
  const after = v8.getHeapStatistics().used_heap_size
  // GCs run on this thread inside the tick. Allocation = heap growth + bytes the GCs freed.
  let gc = 0
  let freed = 0
  for (const e of gcp.stop().statistics) {
    gc += e.cost / 1000
    freed += e.beforeGC.heapStatistics.usedHeapSize - e.afterGC.heapStatistics.usedHeapSize
  }
  const alloc = Math.max(0, after - before + freed)
  row.push(tickMs, gc, alloc)
  ticks.push(row)
  gcMs += gc
  allocBytes += alloc
  peakHeap = Math.max(peakHeap, after)
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
process.send!({ totalMs, phasesMs, peakHeap, gcMs, allocBytes, ticks } satisfies RunResult, () => process.exit(0))
