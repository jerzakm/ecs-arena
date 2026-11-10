import v8, { GCProfiler } from 'node:v8'
import { findScenario, hashState, runPhases, timedSteps, type AnyCreateSim, type Sim } from '@ecs-arena/spec'
import { runScheduled } from './schedule.ts'
import type { RunResult } from './stats.ts'

/** The warmup runs this share of the scenario's ticks, at least WARMUP_MIN_TICKS. 20% of a 1000-tick scenario still covers a save and a load (loadEvery 200). */
export const WARMUP_FRACTION = 0.2
export const WARMUP_MIN_TICKS = 50

/** The fixed integer loop of the clock probe: 20M steps, about 21 ms on a 3 GHz core. Its result goes to a sink so the loop is not removed. */
const PROBE_STEPS = 20_000_000
let probeSink = 0
const spin = (steps: number) => {
  let x = probeSink
  for (let i = 0; i < steps; i++) x = (Math.imul(x, 1664525) + 1013904223 + i) | 0
  probeSink = x
}

/**
 * Steps per ms of the fixed loop. A drop between two probes means the CPU clock changed during the run (thermal throttle, power state, a noisy neighbour).
 * Idea from the clock probes of pmndrs/labs (ISC), src/compare.ts `warnClockDrift`.
 */
export const probeClock = (): number => {
  spin(100_000) // tier the loop up first, or the first probe reads the interpreter
  const s = performance.now()
  spin(PROBE_STEPS)
  return PROBE_STEPS / (performance.now() - s)
}

export interface ChildArgs {
  createSim: AnyCreateSim
  impl: string
  scenario: string
  kind: 'headline' | 'deep'
  /** Expected final state hash, or undefined to skip the check. */
  golden: string | undefined
}

/** Times one run in this process and sends the RunResult to the parent. Exits 3 on a hash mismatch. */
export const runChild = ({ createSim, impl, scenario: name, kind, golden }: ChildArgs) => {
  const deep = kind === 'deep'
  const { game, scenario } = findScenario(name)

  const clockBefore = probeClock()

  // Warm the JIT with a short throwaway run (the first WARMUP_FRACTION of the ticks, same schedule), then time a fresh sim.
  // Goldens are checked on the timed sim only.
  const runTick = (sim: Sim) => (deep || !sim.tick ? runPhases(game, sim) : sim.tick())
  const warm = createSim(scenario, game.kernel)
  runScheduled(warm, { ...scenario, ticks: Math.min(scenario.ticks, Math.max(WARMUP_MIN_TICKS, Math.round(scenario.ticks * WARMUP_FRACTION))) }, { tick: () => runTick(warm) })
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
  const sim = createSim(scenario, game.kernel)
  let deepData: RunResult['deep']
  let totalMs: number
  if (deep) {
    const phasesMs = Object.fromEntries([...game.timedPhases, 'save', 'load'].map((p) => [p, 0])) as Record<string, number>
    const ticks: number[][] = []
    // Not runPhases: each phase needs its own clock around it, so this loop keeps the order of timedSteps and times every step.
    const steps = timedSteps(game, sim)
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
        for (const { key, run } of steps) {
          const s = performance.now()
          run()
          const d = performance.now() - s
          phasesMs[key] += d
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

  const clockProbe = { before: clockBefore, after: probeClock() }

  const hash = hashState(sim.snapshot())
  if (golden !== undefined && golden !== hash) {
    console.error(`HASH MISMATCH ${impl} ${name}: final ${hash}, golden ${golden}`)
    process.exit(3)
  }
  process.send!({ totalMs, clock: clockProbe, tickMs, deep: deepData } satisfies RunResult, () => process.exit(0))
}
