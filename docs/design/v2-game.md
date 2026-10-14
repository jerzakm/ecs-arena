# Game v2: Shrines and Rout

This file records the v2 design and the reasons for it. `SPEC.md` holds the exact rules.

Two candidate designs went into it. Design A started from the game. Design B started from ECS patterns. This design takes the game frame of A and the ECS rules of B.

## The game

Two armies fight for 7 shrines in the middle of the arena. A team that holds more shrines gets larger reinforcement waves. A squad that loses too many members routs. Its members flee to their home edge and leave the battle. Warlords lead several squads. Units that get kills become veterans and remember their last kills. A unit that takes damage holds a grudge against the attackers and fights back against the worst one.

The game has a strategic layer (shrines), swings in momentum (surges, routs) and readable moments for a visualizer (a routing squad, a veteran, a shrine that changes owner).

## Mechanics and the facets they load

| Mechanic | ECS facet | From |
|---|---|---|
| Shrines: 7 entities with a `Shrine` trait, owner and capture progress | Sparse trait, query over few entities, spatial query from a sparse set | A |
| `Score` world trait: shrines held, surge state | Singleton read by many systems | A |
| Surge: a team with more shrines gets a larger wave cap | Bulk spawn, population swing | A |
| Rout: the squad gets `Routed`, every member gets `Fleeing` in one tick | Bulk tag add, archetype churn, tag state machine | A, B |
| Fleeing units leave at their home edge | Bulk destroy, population swing | A |
| `Added(Fleeing)` drops the target and all `Threat` relations | Observer pattern, written as a rule on `Added` | B |
| Warlord: a new unit kind that leads up to 4 squads | Hierarchy depth 4: warlord, leader, member, minion | A |
| `Threat` relation: victim to attacker, with an `amount`, at most 4 for each victim | Many-to-many relation with data, eviction, decay | B |
| Retaliation: a unit targets its top `Threat` attacker in sight | Relation read in a hot loop | B |
| Veteran: 3 kills give a `Veteran` tag and a `chronicle` of the last 4 victim kinds | Sparse tag, array data (AoS), `Changed` drives stat recompute | B |
| Volley: an archer shot spawns 3 projectiles | Create and destroy churn | A |

## Rejected

| Idea | Reason |
|---|---|
| Fog of war, terrain | Plain arrays. No ECS work. |
| Economy and buildings | `Score` covers the singleton. A tower is a unit with speed 0. |
| Meteor storms | A second bulk-spawn source. Surge and rout already give the swing, with less cost for a new library. |
| Volatile minion chain explosions | Cleanup in rounds is a high cost for each library. The facet is close to the existing death cascade. |
| Army and company entities without a body | Deeper hierarchy, but no game meaning. The warlord gives depth 4 with a unit that fights. |
| `lastHitBy` as a native entity reference | The spec cannot require native handles. Each library can store the reference as it wants. |
| A rule that requires observers or command buffers | The spec states behaviour, not a mechanism. Rules on `Added` and rout timing create the same pressure. |

## Cost for a new library

About 6 new traits or relations and 2 new phases (`morale`, `objectives`). The hardest parts are the `Threat` relation with data and eviction, and the depth-4 move order.

## Open points for tuning

- Peak entity counts must reach about 1k, 10k and 50k. `pnpm profile` measures them.
- Rout thresholds must not let one side rout forever. A test checks that both teams hold a shrine at some point in `battle`.

## v3 backlog

Facets that v2 does not load yet.

Higher value:

- **Render extraction phase.** A phase that copies the state a renderer needs into a flat buffer. It tests how well a library reads many components in one pass.
- **Archetype fragmentation.** Item and buff tags that give each unit a different set of tags. Archetype-based libraries then split the units into many small tables.
- **Lookup by external key.** Scripted commander orders name a unit by `gameId`. A library must find an entity from an external key. The key may name a dead target, and the rule must define the result.
- **Rollback save and load.** An optional capability. The implementation saves the world, runs on, then loads the save. The hash trace must continue as if nothing happened.

Lower value:

- World reset.
- Disabled entities that stay in the world but leave queries.
- Sorted queries.
- Prefabs.
- Events as entities.
- Workers.

