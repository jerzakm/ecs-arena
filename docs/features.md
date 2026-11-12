# Features and layout

This page lists the ECS features that the three large games test, and the folders of the repository.

## What the large games test

Each feature below is a **region**, a part of a tick that `baseline-js` times on its own. Each region also has a naive variant, a slow version of the same code. The [load budget](method.md#load-budget) checks that it costs between 2% and 25% of a tick. The last column is the storage design the feature is expected to reward.

| ECS feature | RTS | Survivors | Factory | Expected to favor |
|---|---|---|---|---|
| Large numeric queries | units move, 50k entities | | drones move, 8 fields | dense columns |
| Create and destroy churn | projectiles, minions, items | projectiles, particles, pickups | crates, shift changes | archetype |
| Add and remove tags | buffs, rout, flee | up to 17 status tags per mob | outages, 700 machines at once | sparse set |
| Many distinct component sets | item and buff tags, set bonuses | mob affixes, projectile traits | | sparse set |
| Query with `Not` or `Or` | garrisoned units | movement gates | `Powered` or `Manual` | archetype |
| Small result in a large world | | | about 1.5% of 150k machines work | |
| Fixed cost of a query and a system | | 36 systems, many empty queries | | archetype |
| Relations with data | `Equips`, `MemberOf`, `Threat` | | | |
| Hierarchy and transforms | warbands, leader moves first, banner | | crate stacks to depth 3 | |
| Cascade destroy | minions die with the summoner | summoned children | crates die with the drone | |
| Change detection | stats recompute on change, rules on `Added` | `hp` changed | machine state on change, at scale | |
| Lookup by key | commander orders by `gameId` | | | |
| Render extraction | int32 buffer of all units | entities in the camera | | archetype |
| Save and load | every 25 and 200 ticks | every 25 and 50 ticks | 150k machines, every 25 and 200 ticks | archetype |

The full lists, with the naive variant of each region, are in [docs/design/v3-game.md](design/v3-game.md#facets), [docs/design/factory.md](design/factory.md#facets) and the `FACETS` of [survivors](../packages/spec/src/survivors/facets.ts) and [factory](../packages/spec/src/factory/facets.ts). The [known biases](method.md#known-biases) list what the games do not price fairly.

## Repository layout

- `games/bricks/` holds the bricks game: its game rules, its shared code, the vanilla entry and one file for each library in `entries/`.
- `packages/spec/` holds the rules of the large games (`SPEC.md`, `SPEC-survivors.md`, `SPEC-factory.md`) and the shared code (named "kernel" in the code): randomness, fixed-point math, rule tables, the hash and the spatial grid.
- `impls/<lib>/` holds one entry for each library, with `src/rts/`, `src/survivors/` and `src/factory/`.
- `runner/` holds verify, bench, budget, profile and diff.
- `goldens/` holds the goldens, one for each scenario and seed. `baseline-js` writes the goldens of the large games, and the bricks vanilla entry writes the bricks goldens.
- `apps/viewer/` is the browser viewer. `site/` is the project page.
- `docs/` holds the method, the contributor docs and the design notes.
