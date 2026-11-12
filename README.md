# ecs-arena

ecs-arena is a whole-game benchmark for JavaScript and TypeScript ECS libraries. Each library plays the same games, and the runner times the whole game, not one operation. A library that wins one operation can lose the game, so ecs-arena times the mix.

The aim is a fair comparison that library authors trust enough to send their own entries. It shows where each storage design wins and where it loses time.

**[Results and live demos](https://jerzakm.github.io/ecs-arena/)** · [Glossary](GLOSSARY.md) · [Method](docs/method.md) · [Features and layout](docs/features.md)

## How the check works

A game runs in **ticks**, one step of game time each. Each tick runs the **systems** of the game in a fixed order. The **shared code** of a game holds its constants, start data and random draws. A **scenario** is a named setup with a tick count, and a **seed** sets its random draws.

An **entry** is one library that plays one game, and each entity of the game has a **gameId** that the shared code gives it. After each tick, the entry returns a **snapshot**: the fields of each entity. The runner sorts the snapshot by gameId, makes a hash of it and compares the hash with a committed file of hashes, the **golden**. The runner does this with 3 seeds for each scenario. Thus every entry that passes has the identical world on every tick, and a fast entry that plays a different game fails.

## Start here: bricks

Bricks is the small game. Balls fly in a box and break blocks, and each hit gives 1 point. A broken block respawns at a random cell, so the game never ends. It has 4 systems and no relations, and an entry is one file.

```sh
pnpm install
pnpm verify vanilla bricks-smoke bricks      # check the vanilla entry against the goldens
pnpm verify koota bricks-smoke bricks       # check the koota entry
pnpm bench vanilla koota bricks             # time koota against the vanilla entry
```

A **smoke** scenario is a short scenario for a fast check. Use Node 24.2 or later and pnpm. [games/bricks/README.md](games/bricks/README.md) gives the rules and the verification.

Bricks results have the label "tutorial". They are not part of the score of the large games (see below). Bricks has entries for `koota`, `bitecs` and `iris`. The library authors did not review the `bitecs` and `iris` entries of bricks.

## Add a library

Start with bricks. Add one file, `games/bricks/entries/<lib>.ts`, and pass `pnpm verify <lib> bricks-smoke bricks`. [games/bricks/README.md](games/bricks/README.md) shows the contract.

The large games are the next step. [CONTRIBUTING.md](CONTRIBUTING.md) has their steps, rules and traps. Library authors write the best entries, so open a pull request when your entry passes on every seed.

Found a spec bug, or think a rule favors one design unfairly? Open an issue. The spec and the goldens change only through review, never to make one entry pass.

## The large games (advanced)

The three large games are the headline benchmark. Their docs and code still use the old words: "phase" means system and "kernel" means shared code. `baseline-js` is the vanilla entry of the large games. See [GLOSSARY.md](GLOSSARY.md).

A **board scenario** is a scenario that counts in the score. The **spec** of a game is the document that gives its rules.

**RTS** ([spec](packages/spec/SPEC.md)). Two armies fight over 7 shrines. Squads spawn in waves, warlords lead warbands, squads rout and flee, units carry items and buffs and keep a threat list, and garrisons hold shrines. Board scenarios are `skirmish` (about 5k peak entities) and `war` (about 50k), 1000 ticks each. It measures throughput on a large world with deep relations.

**Survivors** ([spec](packages/spec/SPEC-survivors.md)). One player fights waves of mobs, with weapons, projectiles, particles, pickups, status effects and level-ups. Board scenarios are `grove` (about 1.1k live entities) and `swarm` (about 3k). It measures the fixed cost of 36 small systems, heavy [churn](GLOSSARY.md) and short-lived [tags](GLOSSARY.md) on a small world.

**Factory** ([spec](packages/spec/SPEC-factory.md)). A grid of districts holds machines that turn ore into plates and gears. Drones fly production-line routes with stacks of crates, shift changes swap drones in bulk, and power outages switch whole districts off. Board scenarios are `mill` (1.6k machines, about 75% at work on a tick) and `works` (150k machines, about 1.5% at work). `works` measures queries and change detection on a large, mostly idle world. `mill` measures dense iteration over a large working set and heavy `Working` tag churn. Both measure transform propagation.

Each large game gets its own score: the geometric mean, over its board scenarios, of the library time divided by the time of `baseline-js`. `baseline-js` is a plain JavaScript entry with no library. Lower is faster. [docs/features.md](docs/features.md) lists the ECS features that each game tests.

```sh
pnpm verify koota skirmish-smoke grove-smoke mill-smoke   # check the hashes against the goldens
pnpm bench baseline-js koota skirmish war      # time the RTS board for koota
pnpm --filter @ecs-arena/viewer dev            # watch a game in the browser
```

[docs/method.md](docs/method.md#commands) lists every command.

## Results

The [results page](https://jerzakm.github.io/ecs-arena/) shows the scores and the live demos. [docs/method.md](docs/method.md) explains how the runner gets them.

## Libraries

| Entry | Library | Version | Capabilities |
|---|---|---|---|
| [`baseline-js`](impls/baseline-js) | none, plain arrays (vanilla) | | |
| [`bitecs`](impls/bitecs) | [bitECS](https://github.com/NateTheGreatt/bitECS) | [`bitecs@0.4.0`](https://www.npmjs.com/package/bitecs) | [CAPABILITIES.md](impls/bitecs/CAPABILITIES.md) |
| [`koota`](impls/koota) | [koota](https://github.com/pmndrs/koota) | [`koota@0.6.6`](https://www.npmjs.com/package/koota) | [CAPABILITIES.md](impls/koota/CAPABILITIES.md) |
| [`iris`](impls/iris) | [iris](https://github.com/r04423/iris) | [`iris-ecs@0.0.14`](https://www.npmjs.com/package/iris-ecs) | [CAPABILITIES.md](impls/iris/CAPABILITIES.md) |

Each `CAPABILITIES.md` maps every feature the large games need to the lines of code that use the library for it. It also says whether the library does it natively, emulates it, or lacks it. Bricks entries have no `CAPABILITIES.md`.

ecs-arena started as a regression harness for koota. The rules are library-neutral, and no entry gets rules of its own.
