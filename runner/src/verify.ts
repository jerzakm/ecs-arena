import { parseArgs } from 'node:util'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isMain } from './cli.ts'
import { runScheduled } from './schedule.ts'
import { SEEDS, findScenario, goldenFile, hashState, runPhases, withSeed, type BaseScenario, type AnyCreateSim } from '@ecs-arena/spec'
import { loadSim } from './games.ts'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

/** Hash of the snapshot after each tick, replayed ticks included (SPEC §9 and §10 verify mode). */
export const runTrace = (createSim: AnyCreateSim, scenario: BaseScenario, ticks = scenario.ticks): string[] => {
  const { game } = findScenario(scenario.name)
  const sim = createSim(scenario, game.kernel)
  const trace: string[] = []
  runScheduled(sim, { ...scenario, ticks }, {
    tick: () => runPhases(game, sim),
    after: () => void trace.push(hashState(sim.snapshot())),
  })
  sim.dispose?.()
  return trace
}

/** Index of the first tick where the traces differ, or -1. A length mismatch diverges at the shorter length. */
export const firstDivergence = (actual: string[], golden: string[]): number => {
  const n = Math.min(actual.length, golden.length)
  for (let i = 0; i < n; i++) if (actual[i] !== golden[i]) return i
  return actual.length === golden.length ? -1 : n
}

const main = async (): Promise<number> => {
  const { positionals: [impl, ...names], values: { write } } = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    options: { write: { type: 'boolean', default: false } },
  })
  if (!impl || names.length === 0) {
    console.error('usage: pnpm verify <impl> <scenario...> [--write]')
    return 2
  }
  let failed = false
  for (const name of names) {
    const { game, scenario } = findScenario(name)
    const createSim = await loadSim(impl, game)
    for (let i = 0; i < SEEDS.length; i++) {
      const trace = runTrace(createSim, withSeed(scenario, i))
      const label = `${impl} ${name} seed ${i + 1}`
      const file = resolve(ROOT, 'goldens', goldenFile(name, i))
      if (write) {
        mkdirSync(dirname(file), { recursive: true })
        writeFileSync(file, JSON.stringify(trace))
        console.log(`wrote ${file} (${trace.length} ticks)`)
        continue
      }
      if (!existsSync(file)) {
        console.error(`FAIL ${label}: no golden at ${file}`)
        failed = true
        continue
      }
      const golden = JSON.parse(readFileSync(file, 'utf8')) as string[]
      const d = firstDivergence(trace, golden)
      if (d < 0) console.log(`ok   ${label} (${trace.length} ticks)`)
      else {
        console.error(`FAIL ${label}: first divergent tick ${d} (got ${trace[d]}, golden ${golden[d]})`)
        failed = true
      }
    }
  }
  return failed ? 1 : 0
}

if (isMain(import.meta)) process.exit(await main())
