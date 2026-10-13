import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { SCENARIOS, hashState, kernel, PHASES, type CreateSim } from '@ecs-arena/spec'
import type { RunResult } from './stats.ts'

const ROOT = resolve(import.meta.dirname, '../..')
const [impl, name] = process.argv.slice(2)
const scenario = SCENARIOS[name]
const createSim = (await import(pathToFileURL(resolve(ROOT, 'impls', impl, 'src/index.ts')).href)).default as CreateSim

const phasesMs = Object.fromEntries(PHASES.map((p) => [p, 0])) as Record<string, number>
let peakHeap = 0
const sim = createSim(scenario, kernel)
const t0 = performance.now()
for (let t = 0; t < scenario.ticks; t++) {
  for (const p of PHASES) {
    const s = performance.now()
    sim.phases[p]()
    phasesMs[p] += performance.now() - s
    peakHeap = Math.max(peakHeap, process.memoryUsage().heapUsed)
  }
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
