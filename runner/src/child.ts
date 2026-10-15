import v8, { GCProfiler } from 'node:v8'
import { SCENARIOS, hashState, kernel, runPhases, TIMED_PHASES, type CreateSim, type Sim } from '@ecs-arena/spec'
import { runScheduled } from './schedule.ts'
import type { RunResult } from './stats.ts'

export interface ChildArgs {
  createSim: CreateSim
  impl: string
  scenario: string
  kind: 'headline' | 'deep'
  /** Expected final state hash, or undefined to skip the check. */
  golden: string | undefined
}

/** Times one run in this process and sends the RunResult to the parent. Exits 3 on a hash mismatch. */
export const runChild = ({ createSim, impl, scenario: name, kind, golden }: ChildArgs) => {
  const deep = kind === 'deep'
  const scenario = SCENARIOS[name]

  // Warm the JIT with one full throwaway run of the same scenario, then time a fresh sim.
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
    const phasesMs = Object.fromEntries([...TIMED_PHASES, 'save', 'load'].map((p) => [p, 0])) as Record<string, number>
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
        for (const p of TIMED_PHASES) {
          const s = performance.now()
          if (p === 'move.start') sim.moveStart?.()
          else sim.phases[p]()
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
  if (golden !== undefined && golden !== hash) {
    console.error(`HASH MISMATCH ${impl} ${name}: final ${hash}, golden ${golden}`)
    process.exit(3)
  }
  process.send!({ totalMs, tickMs, deep: deepData } satisfies RunResult, () => process.exit(0))
}
