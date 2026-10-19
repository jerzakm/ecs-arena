import { BOARD_SCENARIOS, type CreateSim } from '@ecs-arena/spec'
import { writeProtocol } from './bench.ts'
import { runChild } from './child.ts'
import { parseTarget } from './variants.ts'

/**
 * Entry point of a bundled bench file. With `--child` the file runs one timed run and reports over IPC.
 * Otherwise it forks itself for every run and writes benchbox protocol lines on stdout.
 * `goldens` maps a scenario to its expected final hash. `defaults` replaces the scenario list and run count when argv names none.
 */
export const main = async (target: string, createSim: CreateSim, goldens: Record<string, string>, defaults: { scenarios?: string[]; runs?: number } = {}) => {
  const argv = process.argv.slice(2)
  if (argv[0] === '--child') {
    const [, , scenario, kind] = argv
    runChild({ createSim, impl: parseTarget(target).impl, scenario, kind: kind as 'headline' | 'deep', golden: goldens[scenario] })
    return
  }
  const i = argv.indexOf('--runs')
  const runs = i < 0 ? (defaults.runs ?? 10) : Number(argv[i + 1])
  if (!(runs >= 1)) throw new Error('--runs needs a number of 1 or more')
  // Scenario names on argv replace the default list, for local checks.
  const named = argv.filter((a, k) => !a.startsWith('--') && k !== i + 1)
  await writeProtocol(target, named.length ? named : (defaults.scenarios ?? BOARD_SCENARIOS), runs, { script: process.argv[1], args: ['--child'], execArgv: [] })
  process.exit(0)
}
