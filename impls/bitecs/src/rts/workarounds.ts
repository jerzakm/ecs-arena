// Every workaround for the behavior of bitECS lives here, so a bitECS upgrade can try to remove them together. Each one names the version
// that it applies to (bitecs 0.4.0, the npm release in package.json). The code that depends on a workaround imports it from this file.
import { entityExists, hasComponent, query, type World } from 'bitecs'
import type { Ctx } from './context.ts'
import { Q } from './queries.ts'
import { FiredBy, LastHitBy, Targets, Threat } from './relations.ts'

const CLEARED_LINKS = [Targets, LastHitBy, FiredBy]

/**
 * bitecs 0.4.0: an id is recycled at once, and a plain component store keeps the data of its last owner. A link that names a removed unit
 * would then name the next owner of the id. `destroyEntity` records each removed unit, and this sweep clears every link and threat that
 * names one. It runs once for all units removed in a phase, before the next spawn can reuse an id.
 */
export const sweepDestroyed = (ctx: Ctx) => {
  const { destroyed } = ctx
  if (destroyed.size === 0) return
  for (const e of query(ctx.world, Q.identified)) {
    for (const l of CLEARED_LINKS) if (l.to[e] !== -1 && destroyed.has(l.to[e])) l.to[e] = -1
    const attackers = Threat.attackers[e]
    if (attackers?.length) {
      const values = Threat.amount[e]
      for (let i = attackers.length - 1; i >= 0; i--) if (destroyed.has(attackers[i])) { attackers.splice(i, 1); values.splice(i, 1) }
    }
  }
  destroyed.clear()
}

/**
 * bitecs 0.4.0: an observer list can hold an entity that was destroyed before the phase read the list, and its id may name a new entity.
 * The entities of the list that still exist and still have the tag.
 */
export const stillTagged = (world: World, list: readonly number[], tag: object): number[] =>
  list.filter((e) => entityExists(world, e) && hasComponent(world, e, tag))

// bitecs 0.4.0: `resetWorld` drops the queries and the observers of the world, so `load` in both games registers the observers again
// (`observeWorld` in context.ts and survivors/context.ts).
//
// bitecs 0.4.0: `removeEntity` takes effect for the cached query results at the next `query`, and an id is recycled at once. A survivors
// system that removes entities collects them in `ctx.doomed` and removes them when it ends (`destroy` and `flush` in
// survivors/entities.ts).
