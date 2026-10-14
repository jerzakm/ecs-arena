# Capabilities: koota

Library version: koota 0.6.6 (npm release)

Each row shows where the implementation uses the library API for a required capability. All lines are in [`src/index.ts`](src/index.ts).

| Game feature | ECS capability | Code |
|---|---|---|
| Units with position, stats, HP | Numeric components, large queries | Traits: [L11-L37](src/index.ts#L11). Unit spawn: [L104](src/index.ts#L104). Large queries with `updateEach` and `readEach`: [L252](src/index.ts#L252), [L320](src/index.ts#L320), [L127](src/index.ts#L127) |
| `gameId` | Trait, not the native entity id | Trait: [L11](src/index.ts#L11). Counter: world trait `NextId`, [L76](src/index.ts#L76). The snapshot reads the trait: [L494](src/index.ts#L494) |
| Projectiles spawned and expired each tick | Entity create and destroy churn | Spawn: [L340](src/index.ts#L340). Destroy: [L431](src/index.ts#L431). Items and units also churn: [L114](src/index.ts#L114), [L423](src/index.ts#L423) |
| Buffs: Stun, Burn, Haste | Tag add and remove (timed traits) | Add or reset: [L140](src/index.ts#L140). Expire: [L379](src/index.ts#L379). `Dead` and `Spent` tags: [L357](src/index.ts#L357), [L308](src/index.ts#L308) |
| `Targets` | Exclusive relation, cleanup when the target dies | Definition: [L46](src/index.ts#L46). Retarget: [L234](src/index.ts#L234). The projectile target: [L343](src/index.ts#L343). Cleanup is koota's: destroy at [L423](src/index.ts#L423) clears the pair, and [L431](src/index.ts#L431) reads the result |
| Squads and formation offsets | Relation with data | Definition: [L48](src/index.ts#L48). Spawn: [L159](src/index.ts#L159). Read in `move`: [L265](src/index.ts#L265). Promotion: [L412](src/index.ts#L412) |
| Minions die with the summoner | Relation fan-out on destroy | `ChildOf` with `autoDestroy: 'orphan'`: [L47](src/index.ts#L47). Cascade at [L423](src/index.ts#L423). Minion spawn: [L188](src/index.ts#L188) |
| `Equips` with quality | Relation with data | Definition: [L49](src/index.ts#L49). Equip at spawn: [L117](src/index.ts#L117). Drop: [L405](src/index.ts#L405). Pickup: [L453](src/index.ts#L453) |
| Stat recompute on a change of items or buffs | Change detection (`Added`, `Removed`, `Changed`) | Trackers: [L63-L72](src/index.ts#L63). Use in `stats`: [L468](src/index.ts#L468) |
| Queries that exclude or combine | `Not`, `Or` | `Not(Stun)`: [L199](src/index.ts#L199), [L252](src/index.ts#L252), [L265](src/index.ts#L265), [L320](src/index.ts#L320). `Or(Stun, Burn, Haste)`: [L370](src/index.ts#L370) |
| Metrics and tick | World traits | `Clock`, `NextId`, `Metrics`: [L40-L42](src/index.ts#L40). World creation: [L61](src/index.ts#L61). Writes: [L165](src/index.ts#L165), [L364](src/index.ts#L364), [L463](src/index.ts#L463), [L477](src/index.ts#L477) |
| Phases | One system function for each spec phase | `spawn` [L164](src/index.ts#L164), `ai/target` [L195](src/index.ts#L195), `move` [L241](src/index.ts#L241), `combat` [L282](src/index.ts#L282), `effects` [L369](src/index.ts#L369), `cleanup` [L387](src/index.ts#L387), `stats` [L468](src/index.ts#L468) |

## Notes

- **Spatial index.** A plain array grid, rebuilt in each phase that needs it ([L127](src/index.ts#L127)). The spec makes this implementation-owned.
- **Start-of-phase positions.** koota has no double-buffered stores. The `Start` trait copies `Position` at the top of `move` ([L242](src/index.ts#L242)). This costs one extra pass.
- **Intents.** Damage, heal and buff intents are an `Incoming` trait that `combat` adds and removes in the same phase ([L294](src/index.ts#L294)). This is archetype churn that a plain accumulator array would avoid.
- **Stat recompute.** The five trackers are separate queries. In 0.6.6, `Or(Added(...), Removed(...))` in one query did not report a trait that was added after spawn. The README documents the `Or` form, so this looks like a koota bug. A tracker on a relation works for the first pair only, so a pickup also calls `set` on the new pair to raise `Changed(Equips)` ([L453](src/index.ts#L453)).
- **Relation pair in a query with a stored relation.** `world.query(MemberOf('*'), Position, ...)` puts the `MemberOf` store first in the `updateEach` tuple at runtime. The type says it does not. The query uses `.select(...)` to get a fixed tuple ([L265](src/index.ts#L265)).
- **Only `Haste` affects derived stats.** `Stun` and `Burn` are not tracked for the recompute.
- **Collected entity lists.** Structural changes (add, remove, destroy) never run inside a query loop. The code copies the result with `[...world.query(...)]` or collects first.
