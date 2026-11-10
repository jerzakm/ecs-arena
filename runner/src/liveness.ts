import type { AnyGame } from '@ecs-arena/spec'
import { HARNESS } from './games.ts'

/** The rules of the game whose counter total is 0 in `counts`. With `smoke`, the late rules are left out. With `scenario`, only the rules that it checks count. */
export const deadRules = (game: AnyGame, counts: Record<string, { total: number }>, smoke = false, scenario?: string): string[] =>
  (scenario === undefined ? HARNESS[game.id].liveness : HARNESS[game.id].livenessFor(scenario)).filter(([, counter, late]) => !(smoke && late) && !(counts[counter]?.total > 0)).map(([rule]) => rule)
