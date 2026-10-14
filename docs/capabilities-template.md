# Capabilities: <library>

Library version: <version>

Each row names a need of the game. Say how your library meets it. Give a link in the form `[L9](src/index.ts#L9)` for each row. Run `pnpm run check:caps` to check that every link points to an existing line.

The `Support` column has three values.

- **native**: the library API does the job as its docs teach.
- **emulated**: you build the job from other library features, or with a manual pass. Describe the emulation in the `Code` column.
- **absent**: the library has no way to do it. Say what the implementation does instead.

The reviewer judges each `Support` value. `pnpm verify` checks the result of the simulation. It cannot check which mechanism you used.

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
| `Threat`, many to many with data | Link with data, eviction, decay | | |
| `lastHitBy` | Exclusive link, cleared when the unit is destroyed | | |
| Veteran chronicle | Array data per entity | | |
| Queries that exclude or combine | Match entities that lack a flag, or have any of several | | |
| Metrics and tick | One shared value per world | | |
| Phases | One system function for each spec phase | | |

## Notes

List each place where the idiomatic rule forced a slower choice. List each library bug or limit that you worked around.
