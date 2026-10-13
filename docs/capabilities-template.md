# Capabilities: <library>

Library version: <version>

Each row shows where the implementation uses the library API for a required capability. Give a `file:line` link for each row. A reviewer checks every row.

| Game feature | ECS capability | Code |
|---|---|---|
| Units with position, velocity, HP, stats | Numeric components, large queries | |
| Projectiles spawned and expired each tick | Entity create and destroy churn | |
| Buffs: Stun, Burn, Haste | Tag add and remove | |
| `Targets` | Exclusive relation, cleanup when the target dies | |
| Squads and formation offsets | Parent and child relation with data | |
| Minions die with the summoner | Relation fan-out on destroy | |
| `Equips` with quality | Relation with data | |
| Stat recompute on a change of items or buffs | Change detection (`Added`, `Removed`, `Changed`) | |
| Queries that exclude or combine | `Not`, `Or` | |
| Metrics and tick | World resource or singleton | |

## Notes

List each place where the idiomatic rule forced a slower choice.
