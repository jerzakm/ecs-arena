# ecs-arena

A deterministic autobattler that plays itself. It is a benchmark for JS/TS ECS libraries.

Two armies fight for 7 shrines on a 256 x 256 tile arena. A team that holds more shrines gets larger reinforcement waves. Squads of warriors, archers, mages, healers and summoners spawn in waves. Warlords lead several warbands. A squad that loses too many members routs. Its members flee to their home edge and leave the battle. A unit that takes damage builds a `Threat` list and fights back against the worst attacker. A unit with 3 kills becomes a veteran and remembers its last kills.

The game loads the ECS features that real games depend on: entity churn, tags, relations with data, change detection, hierarchies and large numeric queries. Synthetic micro-benchmarks do not cover this mix. [docs/design/v2-game.md](docs/design/v2-game.md) gives the design and the reasons.

Each tick runs 9 phases in this order: `spawn`, `ai/target`, `move`, `combat`, `effects`, `morale`, `cleanup`, `objectives`, `stats`.

The primary goal is a regression harness for [koota](https://github.com/pmndrs/koota). The secondary goal is a comparison of ECS libraries.

## Commands

Use Node 24.2 or later (`.nvmrc`). The runner and the koota build need it.

```sh
pnpm install
pnpm test                                   # unit and behaviour tests
pnpm verify koota skirmish-smoke            # compare the per-tick hash trace with the golden
pnpm verify:all                             # every implementation, every smoke scenario
pnpm run diff koota skirmish 120 7 9        # find the first differing record against baseline-js
pnpm run profile skirmish battle war        # count ECS operations per tick (baseline-js); fails when a rule never activates (all seeds)
pnpm run check:caps                         # check the links in every CAPABILITIES.md
pnpm bench koota battle --runs 5            # timed runs, one child process for each run
pnpm compare koota@main koota@fresh-perf battle
pnpm bench koota battle --record            # also save the data in bench-data/ and rebuild docs/results.md
pnpm bench koota battle --protocol          # benchbox native protocol: JSON lines on stdout, samples = tick ns
pnpm bench koota battle --runs 10 --out a.json   # result file with the machine info and the raw value of each run
pnpm compare a.json b.json                  # compare two result files, for example from two machines or commits
BENCH_WRAP="taskset -c 3" pnpm bench ...    # start each child with a prefix command (core pinning, priority)
pnpm results                                # rebuild docs/results.md from bench-data/
```

## Results

[docs/results.md](docs/results.md) shows the latest recorded run for each target and scenario. It gives the totals, the mean for each tick, and charts for each tick: tick time, GC time, allocation and each phase. `bench-data/summary.csv` keeps one row for each commit, target and scenario, so the git history is the trend.

## How it works

- `packages/spec/SPEC.md` is the rules. It is authoritative.
- `packages/spec/src` is the shared kernel. It holds only pure functions: randomness, fixed-point math, formulas, rule tables and the hash. It knows nothing about entities.
- `impls/<name>` is one implementation for each library. An implementation writes only the ECS parts: components, relations, queries, systems and data layout.
- `runner/` calls the phases in spec order, takes snapshots and hashes them.
- `goldens/` holds the hash traces that `baseline-js` writes.

An implementation is correct when its hash trace matches the golden for every tick.

## Why fixed point

All state is int32. Positions use 1/1024 of a tile. Float addition is not associative, so two libraries that visit entities in different orders give different float sums. The hashes then differ, and verify fails for a reason that is not a bug. Integers make the result independent of iteration order.

## Idiomatic and tuned

Each library has up to two implementations:

- `impls/<lib>` is **idiomatic**. It uses only the APIs that the library docs teach. This is the headline number.
- `impls/<lib>-tuned` is optional. It can use any public API for maximum speed. The results label it separately.

The gap between the two numbers shows the cost of the idiomatic style.

`impls/baseline-js` uses plain arrays. It is the reference for correctness and the "speed of light" number. It is not in the ranking.

## Add a library

Read [docs/adding-a-library.md](docs/adding-a-library.md).
