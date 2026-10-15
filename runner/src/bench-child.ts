import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { findPackageJSON } from 'node:module'
import v8, { GCProfiler } from 'node:v8'
import { pathToFileURL } from 'node:url'
import { SCENARIOS, hashState, kernel, PHASES, type CreateSim, type Sim } from '@ecs-arena/spec'
import { runScheduled } from './schedule.ts'
import type { RunResult } from './stats.ts'

const ROOT = resolve(import.meta.dirname, '../..')
const [impl, name, kind] = process.argv.slice(2)
const deep = kind === 'deep'
const scenario = SCENARIOS[name]
const createSim = (await import(pathToFileURL(resolve(ROOT, 'impls', impl, 'src/index.ts')).href)).default as CreateSim

const implEntry = pathToFileURL(resolve(ROOT, 'impls', impl, 'src/index.ts')).href
// Print which koota build the run uses, so a variant run is easy to confirm.
const usesKoota = 'koota' in (JSON.parse(readFileSync(resolve(ROOT, 'impls', impl, 'package.json'), 'utf8')).dependencies ?? {})
if (usesKoota) console.log(`koota -> ${process.env.ECS_ALIAS?.includes('"koota"') ? import.meta.resolve('koota') : findPackageJSON('koota', implEntry)}`)

// Warm the JIT with one full throwaway run of the same scenario, then time a fresh sim.
const runPhases = (sim: Sim) => { for (const p of PHASES) sim.phases[p]() }
const runTick = (sim: Sim) => (deep || !sim.tick ? runPhases(sim) : sim.tick())
const warm = createSim(scenario, kernel)
runScheduled(warm, scenario, { tick: () => runTick(warm) })
globalThis.gc?.()

const tickMs: number[] = []
// Save and load time counts in the total and in the ms of the tick it follows.
const clock = (extra: (kind: 'save' | 'load', ms: number) => void) => (kind: 'save' | 'load', run: () => void) => {
  const s = performance.now()
  run()
  const d = performance.now() - s
  tickMs[tickMs.length - 1] += d
  extra(kind, d)
}
const sim = createSim(scenario, kernel)
let deepData: RunResult['deep']
let totalMs: number
if (deep) {
  const phasesMs = Object.fromEntries([...PHASES, 'save', 'load'].map((p) => [p, 0])) as Record<string, number>
  const ticks: number[][] = []
  let peakHeap = 0
  let gcMs = 0
  let allocBytes = 0
  const gcp = new GCProfiler()
  const t0 = performance.now()
  runScheduled(sim, scenario, {
    timed: clock((kind, d) => { phasesMs[kind] += d }),
    tick: () => {
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
      const tick = performance.now() - ts
      const after = v8.getHeapStatistics().used_heap_size
      // GCs run on this thread inside the tick. Allocation = heap growth + bytes the GCs freed.
      let gc = 0
      let freed = 0
      for (const e of gcp.stop().statistics) {
        gc += e.cost / 1000
        freed += e.beforeGC.heapStatistics.usedHeapSize - e.afterGC.heapStatistics.usedHeapSize
      }
      const alloc = Math.max(0, after - before + freed)
      row.push(tick, gc, alloc, after)
      ticks.push(row)
      tickMs.push(tick)
      gcMs += gc
      allocBytes += alloc
      peakHeap = Math.max(peakHeap, after)
    },
  })
  totalMs = performance.now() - t0
  deepData = { phasesMs, peakHeap, gcMs, allocBytes, ticks }
} else {
  const t0 = performance.now()
  runScheduled(sim, scenario, {
    timed: clock(() => {}),
    tick: () => {
      const s = performance.now()
      runTick(sim)
      tickMs.push(performance.now() - s)
    },
  })
  totalMs = performance.now() - t0
}

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
process.send!({ totalMs, tickMs, deep: deepData } satisfies RunResult, () => process.exit(0))
