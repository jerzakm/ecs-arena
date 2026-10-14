# Capabilities: koota

Library version: koota 0.6.6 (npm release)

Each row shows where the implementation uses the library API for a required capability. All lines are in [`src/index.ts`](src/index.ts).

| Game feature | ECS capability | Code |
|---|---|---|
| Units with position, stats, HP | Numeric components, large queries | Traits: [L9-L19](src/index.ts#L9). Unit spawn: [L124](src/index.ts#L124). Large queries with `readEach` and `updateEach`: [L256](src/index.ts#L256), [L388](src/index.ts#L388) |
| `gameId` | Trait, not the native entity id | Trait: [L9](src/index.ts#L9). Counter: world trait `NextId`, [L41](src/index.ts#L41). The snapshot reads the trait: [L681](src/index.ts#L681) |
| Projectiles, volleys, items, minions created and destroyed each tick | Entity create and destroy churn | Projectile spawn: [L414](src/index.ts#L414). Destroy: [L605](src/index.ts#L605). Item spawn: [L137](src/index.ts#L137). Minion destroy: [L599](src/index.ts#L599) |
| Buffs: Stun, Burn, Haste | Tag and trait add and remove (timed traits) | Traits: [L36-L38](src/index.ts#L36). Add or reset: [L160](src/index.ts#L160), [L431](src/index.ts#L431). Expire: [L477](src/index.ts#L477), [L488](src/index.ts#L488). `Dead` and `Spent` tags: [L430](src/index.ts#L430), [L385](src/index.ts#L385) |
| `Targets` | Exclusive relation, cleanup when the target dies | Definition: [L45](src/index.ts#L45). Retarget: [L296](src/index.ts#L296). The projectile target: [L420](src/index.ts#L420). Cleanup is koota's: the destroy at [L594](src/index.ts#L594) clears the pair, and [L603](src/index.ts#L603) reads the result |
| Squads, warbands and formation offsets | Relation with data, hierarchy to depth 4 | `MemberOf` definition: [L47](src/index.ts#L47). Spawn: [L178](src/index.ts#L178). Depth and move order: [L306](src/index.ts#L306), [L320](src/index.ts#L320). Promotion: [L543](src/index.ts#L543) |
| Minions die with the summoner | Relation fan-out on destroy | `ChildOf` with `autoDestroy: 'orphan'`: [L46](src/index.ts#L46). Cascade at the destroy [L594](src/index.ts#L594). Minion spawn: [L229](src/index.ts#L229) |
| `Equips` with quality | Relation with data | Definition: [L48](src/index.ts#L48), with `autoDestroy: 'target'`. Equip at spawn: [L138](src/index.ts#L138). Drop: [L588](src/index.ts#L588). Pickup: [L625](src/index.ts#L625) |
| Shrines | Sparse trait, a few entities, a spatial search from a sparse set | `Shrine` trait: [L21](src/index.ts#L21). Spawn: [L207](src/index.ts#L207). Capture: [L637](src/index.ts#L637) |
| Shrine score | World trait read by many systems | `Score` trait: [L43](src/index.ts#L43). Write: [L656](src/index.ts#L656). Read by the surge: [L215](src/index.ts#L215). Read by the snapshot: [L682](src/index.ts#L682) |
| Rout and flight | Bulk tag add, tag state machine | `Routed`, `Fleeing`, `Veteran` tags: [L32-L34](src/index.ts#L32). Rout: [L524](src/index.ts#L524). Flee: [L533](src/index.ts#L533) |
| Rules on `Added` | Change tracking | `Added(Routed)`: [L69](src/index.ts#L69), read at [L526](src/index.ts#L526). `Added(Fleeing)`: [L70](src/index.ts#L70), read at [L536](src/index.ts#L536). `Added(Veteran)`: [L71](src/index.ts#L71), read at [L663](src/index.ts#L663). `Changed(KillCount)`: [L72](src/index.ts#L72), read at [L661](src/index.ts#L661) |
| Stat recompute on a change of items, haste, kills or veteran | Observers (`onAdd`, `onRemove`, `onChange`) | Observers: [L85-L90](src/index.ts#L85). Use in `stats`: [L665](src/index.ts#L665) |
| `Threat`, many to many with data | Relation with data, eviction, decay | Definition: [L49](src/index.ts#L49). Write and evict: [L453](src/index.ts#L453), [L464](src/index.ts#L464). Decay: [L494](src/index.ts#L494). Drop on flee: [L538](src/index.ts#L538). Retaliation read: [L248](src/index.ts#L248) |
| `lastHitBy` | Exclusive relation, cleared when the unit is destroyed | Definition: [L50](src/index.ts#L50). Write: [L449](src/index.ts#L449). Kill credit: [L575](src/index.ts#L575) |
| Veteran chronicle | Array trait data | `Chronicle` trait with an array: [L20](src/index.ts#L20). Create: [L663](src/index.ts#L663). Append and trim: [L579](src/index.ts#L579) |
| Queries that exclude or combine | `Not`, relation wildcards | `Not(Stun)`, `Not(Fleeing)`: [L75](src/index.ts#L75), [L78](src/index.ts#L78). `Not(Morale)` with `MemberOf('*')`: [L530](src/index.ts#L530). `Not(Dead)`: [L566](src/index.ts#L566) |
| Metrics and tick | World traits | `Clock`, `NextId`, `Metrics`, `Score`: [L40-L43](src/index.ts#L40). World creation: [L64](src/index.ts#L64) |
| Phases | One system function for each spec phase | `spawn` [L201](src/index.ts#L201), `ai/target` [L234](src/index.ts#L234), `move` [L301](src/index.ts#L301), `combat` [L350](src/index.ts#L350), `effects` [L474](src/index.ts#L474), `morale` [L506](src/index.ts#L506), `cleanup` [L561](src/index.ts#L561), `objectives` [L637](src/index.ts#L637), `stats` [L659](src/index.ts#L659) |

## Notes

- **Spatial index.** A plain array grid, rebuilt in each phase that needs it ([L147](src/index.ts#L147)). The spec makes this implementation-owned.
- **Start-of-phase positions.** koota has no double-buffered stores. The `Start` trait copies `Position` at the top of `move` ([L302](src/index.ts#L302)). This costs one extra pass.
- **Hierarchy order.** `move` computes the depth of each unit by walking `MemberOf` and `ChildOf` ([L306](src/index.ts#L306)), memoizes it for the phase, buckets the units by depth with one `readEach`, and moves them with `get` and `set` on each entity ([L320](src/index.ts#L320)). A query cannot filter by depth, so this pass does not use `updateEach`.
- **Intents.** Damage, heal and buff intents are plain per-phase accumulators in `combat`, resolved in the same phase. Nothing is added to or removed from entities to carry them.
- **Per-unit relation queries.** `promote` runs `world.query(MemberOf(unit))` for each dead or leaving unit ([L544](src/index.ts#L544)). The minion count in `spawn` does the same with `ChildOf` ([L227](src/index.ts#L227)). koota 0.6.6 answers a query for one relation with an entity target from the relation index and caches no query, so this is cheap. The flee step scans `MemberOf('*')` once ([L530](src/index.ts#L530)) because it needs the members of all routed leaders.
- **Trackers need `Unit`.** In 0.6.6 a query that holds only a tracker modifier reports every new entity as added, so each tracker query also holds `Unit` ([L68](src/index.ts#L68)).
- **`Or` over trackers.** `Or(Added(T), Removed(T))` together with another trait did not report a trait that was added after spawn. The dirty-stats set uses observers instead ([L85](src/index.ts#L85)).
- **`Added` on a relation.** It fires for the first pair of an entity only. A second `Equips` pair raises no `Added(Equips)`, which is why stats use `onAdd(Equips, ...)`. Observers fire for every pair.
- **`set` with an updater on a relation pair.** `entity.set(Threat(a), (t) => ...)` is ignored in 0.6.6. The code reads the amount first and passes an object ([L453](src/index.ts#L453)).
- **Collected entity lists.** Structural changes (add, remove, destroy) never run inside a `readEach` or `updateEach` loop. The code collects entities first and changes them after the loop. Where a loop makes no structural change, it iterates the query result directly.
- **Observers on destroyed units.** `onRemove` fires for a destroyed unit, so the stats phase skips a dirty entity that is no longer alive ([L665](src/index.ts#L665)).
