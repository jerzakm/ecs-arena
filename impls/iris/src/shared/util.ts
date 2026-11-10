// Helpers that both games use: the fixed order of SPEC §5.6 and the entities of a query in that order.
import { collectEntities, getComponentValue, type EntityId, type QueryTerm, type World } from 'iris-ecs'
import { GameId } from './components.ts'

/** An entity with its gameId. */
export interface Row { id: number; e: EntityId }

/** The order of every list that a system builds or iterates in a fixed order (SPEC §5.6). */
export const byGameId = (a: { id: number }, b: { id: number }): number => a.id - b.id

/** The entities that have a `GameId` and every term, in gameId order. A query result has no order. */
export const sortedByGameId = (world: World, ...terms: QueryTerm[]): Row[] =>
  collectEntities(world, [GameId, ...terms]).map((e) => ({ id: getComponentValue(world, e, GameId, 'id'), e })).sort(byGameId)

/** Appends `value` to the list at `key` and creates the list when the key is new. */
export const pushTo = <K, V>(map: Map<K, V[]>, key: K, value: V): void => {
  const list = map.get(key)
  if (list) list.push(value)
  else map.set(key, [value])
}
