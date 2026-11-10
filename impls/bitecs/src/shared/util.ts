// Helpers that both games use: the fixed order of SPEC §5.6 and the entities of a query in that order.
import { query, type QueryTerm, type World } from 'bitecs'
import { GameId } from './components.ts'

/** The order of every list that a system builds or iterates in a fixed order (SPEC §5.6): ascending gameId of two entities. */
export const byGameId = (a: number, b: number): number => GameId.id[a] - GameId.id[b]

/** A copy of the entities of a query, in gameId order. A query result has no order, and the copy is safe to change the world under. */
export const sortedByGameId = (ctx: { world: World }, terms: QueryTerm[]): number[] => Array.from(query(ctx.world, terms)).sort(byGameId)
