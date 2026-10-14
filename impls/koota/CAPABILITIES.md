# Capabilities: koota

Library version: koota 0.6.6 (npm release)

Each row shows where the implementation uses the library API for a required capability. All lines are in [`src/index.ts`](src/index.ts).

| Game feature | ECS capability | Code |
|---|---|---|
| Units with position, stats, HP | Numeric components, large queries | Traits: [L9-L19](src/index.ts#L9). Unit spawn: [L129](src/index.ts#L129). Large queries with `readEach` and `updateEach`: [L261](src/index.ts#L261), [L395](src/index.ts#L395) |
| `gameId` | Trait, not the native entity id | Trait: [L9](src/index.ts#L9). Counter: world trait `NextId`, [L41](src/index.ts#L41). The snapshot reads the trait: [L683](src/index.ts#L683) |
| Projectiles, volleys, items, minions created and destroyed each tick | Entity create and destroy churn | Projectile spawn: [L421](src/index.ts#L421). Destroy: [L611](src/index.ts#L611). Item spawn: [L142](src/index.ts#L142). Minion destroy: [L605](src/index.ts#L605) |
| Buffs: Stun, Burn, Haste | Tag and trait add and remove (timed traits) | Traits: [L36-L38](src/index.ts#L36). Add or reset: [L165](src/index.ts#L165), [L438](src/index.ts#L438). Expire: [L484](src/index.ts#L484), [L495](src/index.ts#L495). `Dead` and `Spent` tags: [L437](src/index.ts#L437), [L392](src/index.ts#L392) |
| `Targets` | Exclusive relation, cleanup when the target dies | Definition: [L45](src/index.ts#L45). Retarget: [L303](src/index.ts#L303). The projectile target: [L427](src/index.ts#L427). Cleanup is koota's: the destroy at [L600](src/index.ts#L600) clears the pair, and [L609](src/index.ts#L609) reads the result |
| Squads, warbands and formation offsets | Relation with data, hierarchy to depth 4 | `MemberOf` definition: [L47](src/index.ts#L47). Spawn: [L183](src/index.ts#L183). Depth and move order: [L313](src/index.ts#L313), [L327](src/index.ts#L327). Promotion: [L550](src/index.ts#L550) |
| Minions die with the summoner | Relation fan-out on destroy | `ChildOf` with `autoDestroy: 'orphan'`: [L46](src/index.ts#L46). Cascade at the destroy [L600](src/index.ts#L600). Minion spawn: [L234](src/index.ts#L234) |
| `Equips` with quality | Relation with data | Definition: [L48](src/index.ts#L48), with `autoDestroy: 'target'`. Equip at spawn: [L143](src/index.ts#L143). Drop: [L594](src/index.ts#L594). Pickup: [L629](src/index.ts#L629) |
| Shrines | Sparse trait, a few entities, a spatial search from a sparse set | `Shrine` trait: [L21](src/index.ts#L21). Spawn: [L212](src/index.ts#L212). Capture: [L641](src/index.ts#L641) |
| Shrine score | World trait read by many systems | `Score` trait: [L43](src/index.ts#L43). Write: [L658](src/index.ts#L658). Read by the surge: [L220](src/index.ts#L220). Read by the snapshot: [L684](src/index.ts#L684) |
| Rout and flight | Bulk tag add, tag state machine | `Routed`, `Fleeing`, `Veteran` tags: [L32-L34](src/index.ts#L32). Rout: [L531](src/index.ts#L531). Flee: [L540](src/index.ts#L540) |
| Rules on `Added` | Change tracking | `Added(Routed)`: [L69](src/index.ts#L69), read at [L533](src/index.ts#L533). `Added(Fleeing)`: [L70](src/index.ts#L70), read at [L543](src/index.ts#L543). `Added(Veteran)`: [L71](src/index.ts#L71), read at [L665](src/index.ts#L665). `Changed(KillCount)`: [L72](src/index.ts#L72), read at [L663](src/index.ts#L663) |
| Stat recompute on a change of items, haste, kills or veteran | Observers (`onAdd`, `onRemove`, `onChange`) | Observers: [L85-L90](src/index.ts#L85). Use in `stats`: [L667](src/index.ts#L667) |
| `Threat`, many to many with data | Relation with data, eviction, decay | Definition: [L49](src/index.ts#L49). Write and evict: [L460](src/index.ts#L460), [L471](src/index.ts#L471). Decay: [L501](src/index.ts#L501). Drop on flee: [L545](src/index.ts#L545). Retaliation read: [L253](src/index.ts#L253) |
| `lastHitBy` | Exclusive relation, cleared when the unit is destroyed | Definition: [L50](src/index.ts#L50). Write: [L456](src/index.ts#L456). Kill credit: [L581](src/index.ts#L581) |
| Veteran chronicle | Array trait data | `Chronicle` trait with an array: [L20](src/index.ts#L20). Create: [L665](src/index.ts#L665). Append and trim: [L585](src/index.ts#L585) |
| Queries that exclude or combine | `Not`, relation wildcards | `Not(Stun)`, `Not(Fleeing)`: [L75](src/index.ts#L75), [L78](src/index.ts#L78). `Not(Morale)` with `MemberOf('*')`: [L537](src/index.ts#L537). `Not(Dead)`: [L572](src/index.ts#L572) |
| Metrics and tick | World traits | `Clock`, `NextId`, `Metrics`, `Score`: [L40-L43](src/index.ts#L40). World creation: [L64](src/index.ts#L64) |
| Phases | One system function for each spec phase | `spawn` [L206](src/index.ts#L206), `ai/target` [L239](src/index.ts#L239), `move` [L308](src/index.ts#L308), `combat` [L357](src/index.ts#L357), `effects` [L481](src/index.ts#L481), `morale` [L513](src/index.ts#L513), `cleanup` [L568](src/index.ts#L568), `objectives` [L641](src/index.ts#L641), `stats` [L661](src/index.ts#L661) |

## Notes

- **Spatial index.** A plain array grid, rebuilt in each phase that needs it ([L152](src/index.ts#L152)). The spec makes this implementation-owned.
- **Start-of-phase positions.** koota has no double-buffered stores. The `Start` trait copies `Position` at the top of `move` ([L309](src/index.ts#L309)). This costs one extra pass.
- **Hierarchy order.** `move` computes the depth of each unit by walking `MemberOf` and `ChildOf` ([L313](src/index.ts#L313)), memoizes it for the phase, buckets the units by depth with one `readEach`, and moves them with `get` and `set` on each entity ([L327](src/index.ts#L327)). A query cannot filter by depth, so this pass does not use `updateEach`.
- **Intents.** Damage, heal and buff intents are plain per-phase accumulators in `combat`, resolved in the same phase. Nothing is added to or removed from entities to carry them.
- **Per-unit relation queries.** `promote` runs `world.query(MemberOf(unit))` for each dead or leaving unit ([L551](src/index.ts#L551)). The minion count in `spawn` does the same with `ChildOf` ([L232](src/index.ts#L232)). koota 0.6.6 answers a query for one relation with an entity target from the relation index and caches no query, so this is cheap. The flee step scans `MemberOf('*')` once ([L537](src/index.ts#L537)) because it needs the members of all routed leaders.
- **Trackers need `Unit`.** In 0.6.6 a query that holds only a tracker modifier reports every new entity as added, so each tracker query also holds `Unit` ([L68](src/index.ts#L68)).
- **`Or` over trackers.** `Or(Added(T), Removed(T))` together with another trait did not report a trait that was added after spawn. The dirty-stats set uses observers instead ([L85](src/index.ts#L85)).
- **`Added` on a relation.** It fires for the first pair of an entity only. A second `Equips` pair raises no `Added(Equips)`, which is why stats use `onAdd(Equips, ...)`. Observers fire for every pair.
- **`set` with an updater on a relation pair.** `entity.set(Threat(a), (t) => ...)` is ignored in 0.6.6. The code reads the amount first and passes an object ([L460](src/index.ts#L460)).
- **Collected entity lists.** Structural changes (add, remove, destroy) never run inside a `readEach` or `updateEach` loop. The code collects entities first and changes them after the loop. Where a loop makes no structural change, it iterates the query result directly.
- **Observers on destroyed units.** `onRemove` fires for a destroyed unit, so the stats phase skips a dirty entity that is no longer alive ([L667](src/index.ts#L667)).
