import { PHASES, TIMED_PHASES, type BaseScenario, type Game, type Kernel, type PhaseName, type Scenario } from './contract.ts'
import * as kernel from './kernel.ts'
import { BOARD_SCENARIOS, SCENARIOS, SEEDS } from './scenarios.ts'
import * as sv from './survivors/index.ts'
import * as fa from './factory/index.ts'
import * as bricksShared from '../../../games/bricks/shared.ts'

export type SvKernel = typeof sv.kernel
export type FactoryKernel = typeof fa.kernel

export const RTS: Game<Scenario, Kernel, PhaseName> = {
  id: 'rts', slug: '', phases: PHASES, timedPhases: TIMED_PHASES, startHook: 'move', kernel,
  scenarios: SCENARIOS, board: BOARD_SCENARIOS, entry: 'src/rts/index.ts',
}

export const SURVIVORS: Game<sv.SurvivorsScenario, SvKernel, sv.SvPhase> = {
  id: 'survivors', slug: 'survivors', phases: sv.PHASES, timedPhases: sv.PHASES, startHook: undefined, kernel: sv.kernel,
  scenarios: sv.SCENARIOS, board: sv.BOARD, entry: 'src/survivors/index.ts',
}

export const FACTORY: Game<fa.FactoryScenario, FactoryKernel, fa.FPhase> = {
  id: 'factory', slug: 'factory', phases: fa.PHASES, timedPhases: fa.PHASES, startHook: undefined, kernel: fa.kernel,
  scenarios: fa.SCENARIOS, board: fa.BOARD, entry: 'src/factory/index.ts',
}

/** A tutorial game from its shared code. It adds the seed and the board list (each scenario that does not end in -smoke). */
const tutorialGame = <P extends string>(
  id: string,
  shared: { SYSTEMS: readonly P[]; SCENARIOS: Readonly<Record<string, { name: string; ticks: number }>> },
): Game<BaseScenario, typeof shared, P> => {
  const scenarios = Object.fromEntries(Object.entries(shared.SCENARIOS).map(([n, s]) => [n, { ...s, seed: SEEDS[0], loadEvery: Infinity }]))
  return {
    id, slug: id, phases: shared.SYSTEMS, timedPhases: shared.SYSTEMS, startHook: undefined, kernel: shared,
    scenarios, board: Object.keys(scenarios).filter((n) => !n.endsWith('-smoke')), entry: '', dir: `games/${id}`, vanilla: 'vanilla', tutorial: true,
  }
}

export const BRICKS = tutorialGame('bricks', bricksShared)

export const GAMES = [RTS, SURVIVORS, FACTORY, BRICKS] as const
export type AnyGame = (typeof GAMES)[number]

/** Throws when a scenario name is in two games. `goldens/` is one flat dir, so a name must select one game. */
export const assertUniqueScenarioNames = (games: readonly Pick<AnyGame, 'id' | 'scenarios'>[]): void => {
  const seen = new Map<string, string>()
  for (const g of games)
    for (const name of Object.keys(g.scenarios)) {
      const other = seen.get(name)
      if (other !== undefined) throw new Error(`scenario ${name} is in games ${other} and ${g.id}`)
      seen.set(name, g.id)
    }
}
assertUniqueScenarioNames(GAMES)

export const hasScenario = (name: string): boolean => GAMES.some((g) => Object.hasOwn(g.scenarios, name))

/** The one lookup every runner tool uses. Throws on an unknown name. */
export const findScenario = (name: string): { game: AnyGame; scenario: AnyGame['scenarios'][string] } => {
  for (const game of GAMES) if (Object.hasOwn(game.scenarios, name)) return { game, scenario: game.scenarios[name] }
  throw new Error(`unknown scenario ${name}`)
}
