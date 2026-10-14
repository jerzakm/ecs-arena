# Capabilities: koota

Library version: koota 0.6.6 (npm release)

Each row shows where the implementation uses the library API for a required capability. All lines are in [`src/index.ts`](src/index.ts).

| Game feature | ECS capability | Code |
|---|---|---|
| Units with position, stats, HP | Numeric components, large queries | Traits: [L9-L19](src/index.ts#L9). Unit spawn: [L117](src/index.ts#L117). Large queries with `readEach` and `updateEach`: [L249](src/index.ts#L249), [L375](src/index.ts#L375) |
| `gameId` | Trait, not the native entity id | Trait: [L9](src/index.ts#L9). Counter: world trait `NextId`, [L41](src/index.ts#L41). The snapshot reads the trait: [L668](src/index.ts#L668) |
| Projectiles, volleys, items, minions created and destroyed each tick | Entity create and destroy churn | Projectile spawn: [L401](src/index.ts#L401). Destroy: [L592](src/index.ts#L592). Item spawn: [L130](src/index.ts#L130). Minion destroy: [L586](src/index.ts#L586) |
| Buffs: Stun, Burn, Haste | Tag and trait add and remove (timed traits) | Traits: [L36-L38](src/index.ts#L36). Add or reset: [L153](src/index.ts#L153), [L418](src/index.ts#L418). Expire: [L464](src/index.ts#L464), [L475](src/index.ts#L475). `Dead` and `Spent` tags: [L417](src/index.ts#L417), [L372](src/index.ts#L372) |
| `Targets` | Exclusive relation, cleanup when the target dies | Definition: [L45](src/index.ts#L45). Retarget: [L289](src/index.ts#L289). The projectile target: [L407](src/index.ts#L407). Cleanup is koota's: the destroy at [L581](src/index.ts#L581) clears the pair, and [L590](src/index.ts#L590) reads the result |
| Squads, warbands and formation offsets | Relation with data, hierarchy to depth 4 | `MemberOf` definition: [L47](src/index.ts#L47). Spawn: [L171](src/index.ts#L171). Depth and move order: [L297](src/index.ts#L297), [L306](src/index.ts#L306). Promotion: [L530](src/index.ts#L530) |
| Minions die with the summoner | Relation fan-out on destroy | `ChildOf` with `autoDestroy: 'orphan'`: [L46](src/index.ts#L46). Cascade at the destroy [L581](src/index.ts#L581). Minion spawn: [L222](src/index.ts#L222) |
| `Equips` with quality | Relation with data | Definition: [L48](src/index.ts#L48), with `autoDestroy: 'target'`. Equip at spawn: [L131](src/index.ts#L131). Drop: [L575](src/index.ts#L575). Pickup: [L612](src/index.ts#L612) |
| Shrines | Sparse trait, a few entities, a spatial search from a sparse set | `Shrine` trait: [L21](src/index.ts#L21). Spawn: [L200](src/index.ts#L200). Capture: [L624](src/index.ts#L624) |
| Shrine score | World trait read by many systems | `Score` trait: [L43](src/index.ts#L43). Write: [L643](src/index.ts#L643). Read by the surge: [L208](src/index.ts#L208). Read by the snapshot: [L669](src/index.ts#L669) |
| Rout and flight | Bulk tag add, tag state machine | `Routed`, `Fleeing`, `Veteran` tags: [L32-L34](src/index.ts#L32). Rout: [L511](src/index.ts#L511). Flee: [L520](src/index.ts#L520) |
| Rules on `Added` | Change tracking | `Added(Routed)`: [L69](src/index.ts#L69), read at [L513](src/index.ts#L513). `Added(Fleeing)`: [L70](src/index.ts#L70), read at [L523](src/index.ts#L523). `Added(Veteran)`: [L71](src/index.ts#L71), read at [L650](src/index.ts#L650). `Changed(KillCount)`: [L72](src/index.ts#L72), read at [L648](src/index.ts#L648) |
| Stat recompute on a change of items, haste, kills or veteran | Observers (`onAdd`, `onRemove`, `onChange`) | Observers: [L78-L83](src/index.ts#L78). Use in `stats`: [L652](src/index.ts#L652) |
| `Threat`, many to many with data | Relation with data, eviction, decay | Definition: [L49](src/index.ts#L49). Write and evict: [L440](src/index.ts#L440), [L451](src/index.ts#L451). Decay: [L481](src/index.ts#L481). Drop on flee: [L525](src/index.ts#L525). Retaliation read: [L241](src/index.ts#L241) |
| `lastHitBy` | Exclusive relation, cleared when the unit is destroyed | Definition: [L50](src/index.ts#L50). Write: [L436](src/index.ts#L436). Kill credit: [L562](src/index.ts#L562) |
| Veteran chronicle | Array trait data | `Chronicle` trait with an array: [L20](src/index.ts#L20). Create: [L650](src/index.ts#L650). Append and trim: [L566](src/index.ts#L566) |
| Queries that exclude or combine | `Not`, relation wildcards | `Not(Stun)`, `Not(Fleeing)`: [L249](src/index.ts#L249), [L375](src/index.ts#L375). `Not(Morale)` with `MemberOf('*')`: [L517](src/index.ts#L517). `Not(Dead)`: [L553](src/index.ts#L553) |
| Metrics and tick | World traits | `Clock`, `NextId`, `Metrics`, `Score`: [L40-L43](src/index.ts#L40). World creation: [L64](src/index.ts#L64) |
| Phases | One system function for each spec phase | `spawn` [L194](src/index.ts#L194), `ai/target` [L227](src/index.ts#L227), `move` [L294](src/index.ts#L294), `combat` [L337](src/index.ts#L337), `effects` [L461](src/index.ts#L461), `morale` [L493](src/index.ts#L493), `cleanup` [L548](src/index.ts#L548), `objectives` [L624](src/index.ts#L624), `stats` [L646](src/index.ts#L646) |

## Notes

- **Spatial index.** A plain array grid, rebuilt in each phase that needs it ([L140](src/index.ts#L140)). The spec makes this implementation-owned.
- **Start-of-phase positions.** koota has no double-buffered stores. The `Start` trait copies `Position` at the top of `move` ([L295](src/index.ts#L295)). This costs one extra pass.
- **Hierarchy order.** `move` computes the depth of each unit by walking `MemberOf` and `ChildOf` ([L297](src/index.ts#L297)), buckets the units by depth, and moves them with `get` and `set` on each entity ([L306](src/index.ts#L306)). A query cannot filter by depth, so this pass does not use `updateEach`.
- **Intents.** Damage, heal and buff intents are plain per-phase accumulators in `combat`, resolved in the same phase. Nothing is added to or removed from entities to carry them.
- **Per-unit relation queries.** `promote` runs `world.query(MemberOf(unit))` for each dead or leaving unit ([L531](src/index.ts#L531)). The minion count in `spawn` does the same with `ChildOf` ([L220](src/index.ts#L220)). The flee step instead scans `MemberOf('*')` once ([L517](src/index.ts#L517)), to avoid one cached query for each routed leader.
- **Trackers need `Unit`.** In 0.6.6 a query that holds only a tracker modifier reports every new entity as added, so each tracker query also holds `Unit` ([L68](src/index.ts#L68)).
- **`Or` over trackers.** `Or(Added(T), Removed(T))` together with another trait did not report a trait that was added after spawn. The dirty-stats set uses observers instead ([L78](src/index.ts#L78)).
- **`Added` on a relation.** It fires for the first pair of an entity only. A second `Equips` pair raises no `Added(Equips)`, which is why stats use `onAdd(Equips, ...)`. Observers fire for every pair.
- **`set` with an updater on a relation pair.** `entity.set(Threat(a), (t) => ...)` is ignored in 0.6.6. The code reads the amount first and passes an object ([L440](src/index.ts#L440)).
- **Collected entity lists.** Structural changes (add, remove, destroy) never run inside a `readEach` or `updateEach` loop. The code collects entities first and changes them after the loop. Where a loop makes no structural change, it iterates the query result directly.
- **Observers on destroyed units.** `onRemove` fires for a destroyed unit, so the stats phase skips a dirty entity that is no longer alive ([L652](src/index.ts#L652)).
