import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { SCENARIOS, hashState, kernel, PHASES, type CreateSim, type Scenario } from '@ecs-arena/spec'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

/** Hash of the snapshot after each tick (SPEC §9 verify mode). */
export const runTrace = (createSim: CreateSim, scenario: Scenario, ticks = scenario.ticks): string[] => {
  const sim = createSim(scenario, kernel)
  const trace: string[] = []
  for (let t = 0; t < ticks; t++) {
    for (const p of PHASES) sim.phases[p]()
    trace.push(hashState(sim.snapshot()))
  }
  return trace
}

/** Index of the first tick where the traces differ, or -1. A length mismatch diverges at the shorter length. */
export const firstDivergence = (actual: string[], golden: string[]): number => {
  const n = Math.min(actual.length, golden.length)
  for (let i = 0; i < n; i++) if (actual[i] !== golden[i]) return i
  return actual.length === golden.length ? -1 : n
}

const main = async (): Promise<number> => {
  const args = process.argv.slice(2)
  const write = args.includes('--write')
  const [impl, ...names] = args.filter((a) => a !== '--write')
  if (!impl || names.length === 0) {
    console.error('usage: pnpm verify <impl> <scenario...> [--write]')
    return 2
  }
  const createSim = (await import(pathToFileURL(resolve(ROOT, 'impls', impl, 'src/index.ts')).href)).default as CreateSim
  let failed = false
  for (const name of names) {
    const scenario = SCENARIOS[name]
    if (!scenario) {
      console.error(`unknown scenario ${name}`)
      return 2
    }
    const trace = runTrace(createSim, scenario)
    const file = resolve(ROOT, 'goldens', `${name}.json`)
    if (write) {
      mkdirSync(dirname(file), { recursive: true })
      writeFileSync(file, JSON.stringify(trace))
      console.log(`wrote ${file} (${trace.length} ticks)`)
      continue
    }
    if (!existsSync(file)) {
      console.error(`FAIL ${impl} ${name}: no golden at ${file}`)
      failed = true
      continue
    }
    const golden = JSON.parse(readFileSync(file, 'utf8')) as string[]
    const d = firstDivergence(trace, golden)
    if (d < 0) console.log(`ok   ${impl} ${name} (${trace.length} ticks)`)
    else {
      console.error(`FAIL ${impl} ${name}: first divergent tick ${d} (got ${trace[d]}, golden ${golden[d]})`)
      failed = true
    }
  }
  return failed ? 1 : 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(await main())
