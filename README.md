# ecs-arena

A whole-game benchmark for JavaScript and TypeScript ECS libraries.

Most ECS benchmarks time one operation, such as adding a component or iterating a query. A real game mixes many operations, and the library that wins one of them can lose the game. ecs-arena writes the same three small games with each library and times the whole game. Every run hashes the game state on every tick and must match a committed trace, so a fast run that plays a different game fails.

The aim is a fair, reproducible comparison that library authors trust enough to submit their own entries, and that shows where each storage design wins and where it pays.

**[Results and live demos](https://jerzakm.github.io/ecs-arena/)** · [Method](docs/method.md) · [Spec](packages/spec/SPEC.md) · [Add a library](CONTRIBUTING.md)

## The games

**RTS** ([spec](packages/spec/SPEC.md)). Two armies fight over 7 shrines. Squads spawn in waves, warlords lead warbands, squads rout and flee, units carry items and buffs and keep a threat list, and garrisons hold shrines. Board scenarios are `skirmish` (about 5k peak entities) and `war` (about 50k), 1000 ticks each. It measures throughput on a large world with deep relations.

**Survivors** ([spec](packages/spec/SPEC-survivors.md)). One player against waves of mobs, with weapons, projectiles, particles, pickups, status effects and level-ups. Board scenarios are `grove` (about 1.1k live entities) and `swarm` (about 3k). It measures the fixed cost of 36 small systems, heavy churn and short-lived tags on a small world.

**Factory** ([spec](packages/spec/SPEC-factory.md)). A grid of districts full of machines that turn ore into plates and gears. Drones fly production-line routes with stacks of crates, shift changes swap drones in bulk, and power outages switch whole districts off. Board scenarios are `mill` (1.6k machines, about 75% at work on a tick) and `works` (150k machines, about 1.5% at work). `works` measures queries and change detection on a large, mostly idle world. `mill` measures dense iteration over a large working set and heavy `Working` tag churn. Both measure transform propagation.

Each game gets its own score: the geometric mean, over its board scenarios, of the library time divided by the time of `baseline-js`, a plain JavaScript version with no library. Lower is faster.

## What the games test

Each feature below is a timed region in `baseline-js` with a naive variant, and the [load budget](docs/method.md#load-budget) checks that it costs between 2% and 25% of a tick. The last column is the storage design the feature is expected to reward.

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

The full lists, with the naive variant of each region, are in [docs/design/v3-game.md](docs/design/v3-game.md#facets), [docs/design/factory.md](docs/design/factory.md#facets) and the `FACETS` of [survivors](packages/spec/src/survivors/facets.ts) and [factory](packages/spec/src/factory/facets.ts). The [known biases](docs/method.md#known-biases) list what the games do not price fairly.

## Run it

Use Node 24.2 or later and pnpm.

```sh
pnpm install
pnpm verify koota skirmish-smoke grove-smoke mill-smoke   # check hash traces against the goldens
pnpm bench baseline-js koota skirmish war      # time the RTS board for koota
pnpm --filter @ecs-arena/viewer dev            # watch a game in the browser
```

[docs/method.md](docs/method.md#commands) lists every command.

## Libraries

| Entry | Library | Version | Capabilities |
|---|---|---|---|
| [`baseline-js`](impls/baseline-js) | none, plain arrays (reference) | | |
| [`bitecs`](impls/bitecs) | [bitECS](https://github.com/NateTheGreatt/bitECS) | [`bitecs@0.4.0`](https://www.npmjs.com/package/bitecs) | [CAPABILITIES.md](impls/bitecs/CAPABILITIES.md) |
| [`koota`](impls/koota) | [koota](https://github.com/pmndrs/koota) | [`koota@0.6.6`](https://www.npmjs.com/package/koota) | [CAPABILITIES.md](impls/koota/CAPABILITIES.md) |
| [`iris`](impls/iris) | [iris](https://github.com/r04423/iris) | [`iris-ecs@0.0.14`](https://www.npmjs.com/package/iris-ecs) | [CAPABILITIES.md](impls/iris/CAPABILITIES.md) |

Each `CAPABILITIES.md` maps every feature the games need to the lines of code that use the library for it, and says whether the library does it natively, emulates it, or lacks it.

## Add a library

Library authors write the best entries. To add yours, implement the games from the spec, pass `pnpm verify` on every seed, fill in `CAPABILITIES.md`, and open a pull request. [CONTRIBUTING.md](CONTRIBUTING.md) has the steps, the rules and the traps.

Found a spec bug, or think a rule favors one design unfairly? Open an issue. The spec and the goldens change only through review, never to make one entry pass.

## Repository layout

- `packages/spec/` holds the rules (`SPEC.md`, `SPEC-survivors.md`, `SPEC-factory.md`) and the shared kernel: randomness, fixed-point math, rule tables, the hash and the spatial grid.
- `impls/<lib>/` holds one entry for each library, with `src/rts/`, `src/survivors/` and `src/factory/`.
- `runner/` holds verify, bench, budget, profile and diff.
- `goldens/` holds the hash traces that `baseline-js` writes, one for each scenario and seed.
- `apps/viewer/` is the browser viewer. `site/` is the project page.
- `docs/` holds the method, the contributor docs and the design notes.

ecs-arena started as a regression harness for koota. The rules are library-neutral, and no entry gets rules of its own.
