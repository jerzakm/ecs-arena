// Every workaround for a koota bug lives here, so a koota upgrade can try to remove them together. Each one names the version
// that it applies to (koota 0.6.6, the npm release in package.json). The code that depends on a workaround imports it from this file.
import { createQuery, type Entity, type QueryParameter, type Relation, type Trait, type World } from 'koota'

/**
 * koota 0.6.6: a query that holds only a tracker modifier (`Added`, `Changed`) reports every new entity as changed.
 * Each tracker query holds an `anchor` trait that every tracked entity has, which restores the filter.
 */
export const trackerQuery = (anchor: Trait, ...tracker: QueryParameter[]) => createQuery(anchor, ...tracker)

/**
 * koota 0.6.6: `Added(relation)` reports only the first pair of an entity, so a second pair raises nothing.
 * Observers fire for every pair, so a system that reacts to each pair of a relation observes it.
 */
export const observePairs = (world: World, relation: Relation, callback: (e: Entity) => void): void => {
  world.onAdd(relation, callback)
  world.onRemove(relation, callback)
}

/**
 * koota 0.6.6: a write in `updateEach` does not flag `Changed` under the default `'auto'` change detection, so a `Changed` tracker
 * reads nothing. Pass this option to the `updateEach` that feeds a tracker.
 */
export const FLAG_CHANGED = { changeDetection: 'always' } as const

/**
 * koota 0.6.6: `world.reset()` drops the observers and the tracker masks, and the next query that holds `Added` or `Changed` throws.
 * Emptying a world destroys each entity of the query instead, which keeps both.
 */
export const destroyAll = (world: World, ...params: QueryParameter[]): void => {
  const live: Entity[] = []
  world.query(...params).readEach((_, e) => void live.push(e))
  for (const e of live) if (e.isAlive()) e.destroy()
}

// koota 0.6.6: `entity.set(pair, updater)` is ignored on a relation pair. Code that raises a pair value reads the value first and
// passes an object: `raiseThreat` in systems/combat.ts.
//
// koota 0.6.6: the first read of a tracker query can report an entity that lacks the other traits of the query. A system that reads a
// tracker checks the trait it needs: `grid.update` in survivors/systems/move.ts checks `Mob`.
