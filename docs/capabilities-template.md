# Capabilities: <library>

Library version: <version>

Each row names a need of the game. Say how your library meets it. Give a link in the form `[entities.ts L9](src/rts/entities.ts#L9)` for each row. Link the file that holds the code. Run `pnpm run check:caps` to check that every link points to an existing line.

The `Support` column has three values.

- **native**: the library API does the job as its docs teach.
- **emulated**: you build the job from other library features, or with a manual pass. Describe the emulation in the `Code` column.
- **absent**: the library has no way to do it. Say what the implementation does instead.

The reviewer judges each `Support` value. `pnpm verify` checks the result of the simulation. It cannot check which mechanism you used.

## RTS

| Game feature | Need | Support | Code |
|---|---|---|---|
| Units with position, stats, HP | Numeric data per entity, large queries | | |
| `gameId` | A stable identity that is not the native entity id | | |
| Projectiles, volleys, items, minions created and destroyed each tick | Entity create and destroy churn | | |
| Buffs: Stun, Burn, Haste | Add and remove a flag or a timed value | | |
| `Targets` | Exclusive link to one entity, cleared when the target dies | | |
| Squads, warbands and formation offsets | Link with data, hierarchy to depth 4 | | |
| Minions die with the summoner | Destroy the linked entities when the source is destroyed | | |
| `Equips` with quality | Link with data | | |
| Shrines | A few entities with a flag, a spatial search over them | | |
| Shrine score | One shared value that many systems read | | |
| Rout and flight | Add a flag to many entities in one tick, flag state machine | | |
| Rules on `Added` | React when an entity gains a flag | | |
| Stat recompute on a change of items, haste, kills or veteran | React to a change of membership or value | | |
| Item tags and buff tags, set bonuses | Many distinct tags per entity, tag membership reads | | |
| Overwhelmed (6 or more attackers) | Fan-in count over a link, flag add and remove each tick | | |
| Banner (armor below a living warlord) | Read through a chain of links, flag sync from a derived value | | |
| Garrison (units in a held shrine leave the move and target queries) | Exclude entities from some queries without destroying them | | |
| Commander orders by `gameId`, with dead keys | Lookup of an entity by a key that is not the native id, where a key can be dead | | |
| Render extraction (a flat int32 buffer of all units, folded into `renderChain`) | Read many traits of every entity in one pass | | |
| `Threat`, many to many with data | Link with data, eviction, decay | | |
| `lastHitBy` | Exclusive link, cleared when the unit is destroyed | | |
| Unit trail (path history) | Array data per entity | | |
| Queries that exclude or combine | Match entities that lack a flag, or have any of several | | |
| Metrics and tick | One shared value per world | | |
| Snapshot and restore (save each 100 ticks, load one save, replay) | Enumerate all entities, traits and relations, and rebuild them in the same world with relations relinked by `gameId` | | |
| Phases | One system function for each spec phase | | |

## Survivors

Name the storage model of your library (sparse set, archetype or hybrid) in one line. The `Facet` column names the ids of `survivors.FACETS` in `packages/spec/src/survivors/facets.ts`. Link into `src/survivors/`, for example `[survivors/tags.ts L37](src/survivors/tags.ts#L37)`.

| Facet | Need | Support | Code |
|---|---|---|---|
| `query`, `gate` (kind-gated systems, mobs that `BLOCKS_MOVE` skips) | Cached queries with a negated term. A query that no entity matches costs almost nothing | | |
| `status`, `statusAdd` (17 mob tags) | Add and remove a tag with an `until` value often, expire the tags each tick, merge `until` by max on a re-add | | |
| `interact` (shatter, mark) | Read a few tags of one entity for each hit | | |
| `traits` (12 projectile trait bits) | Many distinct tag sets on short-lived entities | | |
| `affix` (elite affixes and what a mob kind can do) | Many distinct tag sets on mobs, more than 100 combinations | | |
| `evolve`, `bossphase`, `enrage`, `charge` | Change the components or tags of a live entity | | |
| Owner, homing and chain target, summoner | Exclusive link to one entity, read as -1 after the target is destroyed | | |
| `cascade` (summoned mobs die with the summoner) | Destroy the linked entities when the source is destroyed | | |
| `churn` (projectiles, pickups, particles, mobs) | Entity create and destroy churn, one TTL query | | |
| `grid` | Report moved mobs to the kernel grid, with the library's change detection when it has one | | |
| `changed` (hp changed in `resolve.damage`) | React to a change of a value | | |
| `events` | Event lists that systems push and later systems read | | |
| `loadout`, held list | A few entities or one shared value that many systems read, rebuilt on a pick | | |
| `render` | Read the position and a few fields of every entity in the camera window in one pass | | |
| `save`, `load` | Enumerate all entities, components and links, and rebuild them in the same world with links relinked by `gameId` | | |

## Factory

Name the storage model of your library in one line. The `Facet` column names the ids of `factory.FACETS` in `packages/spec/src/factory/facets.ts`. Link into `src/factory/`.

| Facet | Need | Support | Code |
|---|---|---|---|
| `build` (150,000 machines at tick 0) | Create many entities with the same components in one tick | | |
| `query` (`Working` machines progress) | A cached query whose result is a small part of a large world | | |
| `or` (`Powered` or `Manual`) | A query or a test with `Or` over two tags | | |
| `optional` (`boost`) | Read a component that only some matched entities have | | |
| `changed` (`Working` re-checked on change) | Find the entities whose inputs, outputs or power changed this tick | | |
| `toggle`, `outage`, `restore` | Add or remove a tag on hundreds of entities of one group in one tick | | |
| `move` (8 drone fields) | Dense iteration over wide numeric components | | |
| `transform`, `depth` | A parent link to depth 3, read in parent-first order | | |
| `churn`, `destroy`, `retire`, `spawn` | Create and destroy crates, and destroy a drone with its crates | | |
| `save`, `load` | Copy the mutable state of a large world, and rebuild it with links relinked by `gameId` | | |

## Notes

List each place where the idiomatic rule forced a slower choice. List each library bug or limit that you worked around.
