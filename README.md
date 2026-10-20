# ecs-arena

A deterministic autobattler that plays itself. It is a benchmark for JS/TS ECS libraries.

Two armies fight for 7 shrines on a 256 x 256 tile arena. Squads of warriors, archers, mages, healers and summoners spawn in waves. Warlords lead warbands. Squads rout and flee. Units carry items and buffs, keep a `Threat` list, take orders from a commander, garrison shrines and become veterans. The game saves its state at a fixed interval and loads one save during the run.

The game loads the ECS features that real games depend on: entity churn, tags, relations with data, change detection, hierarchies, large numeric queries, lookup by key, render extraction, and snapshot and restore. [docs/design/v3-game.md](docs/design/v3-game.md) gives the design and the reasons. [docs/design/v2-game.md](docs/design/v2-game.md) gives the game that v3 builds on.

Each tick runs 9 phases in this order: `spawn`, `ai/target`, `move`, `combat`, `effects`, `morale`, `cleanup`, `objectives`, `stats`.

The primary goal is a regression harness for [koota](https://github.com/pmndrs/koota). The secondary goal is a comparison of ECS libraries.

## The claim

Each library gets one headline number.

- The number is the geometric mean, over `skirmish` and `war`, of the library time divided by the `baseline-js` time. Lower is better.
- `skirmish` has about 5k peak entities and `war` about 50k. Both run 1000 ticks. `battle` (about 20k) is for local use and is not on the board.
- The time is the total run time of a headline run. The report also shows p99, the max tick and the ticks over 16.6 ms.
- Runs are adaptive. A headline has 3 to 10 runs and stops when the 95% interval of the median is under 2% of the median. An entry that has used 10 min of wall time stops its headline runs after the 3-run minimum. The default board run has no deep runs, and a full koota entry takes about 10 min. Deep runs only come on request (`--deep`, `--record`, or `benchbox submit --profile deep`). Two libraries whose intervals overlap share a rank.

One number is fair only when the game loads each facet by a known amount. The load budget sets that amount.

## How coverage is checked

### Load budget

Each facet that the game claims to test is a named, timed region in `baseline-js`. A flag switches one region to naive code. The naive code does the same work without the feature, for example a scan of all units in place of an index.

A facet passes when all of these are true:

- **Floor.** The naive region time is at least 2% of the normal tick total. A library without the feature must lose at least 2% of the tick.
- **Cap.** The normal region time is at most 25% of the normal tick total. No facet takes over the number.
- **Naive is slower.** The naive region is at least 1.5 times slower than the normal region. Otherwise the game does not reward the feature.
- **Same result.** The naive run gives the same hashes as the normal run.

The check must pass in every scenario and with every seed. `pnpm budget` runs it. It measures `baseline-js` only. The thresholds live in `runner/src/budget-check.ts`.

### Liveness guard

A rule that never activates never changes the hash, so an implementation could skip it. `pnpm run profile` counts the activations of each rule in `baseline-js` for each seed. It fails when a rule counter stays at 0. The rules are in `runner/src/liveness.ts`.

### Correctness

An implementation is correct when its hash trace matches the golden for every tick. `pnpm verify` checks 3 seeds for each scenario. Timing uses the first seed only.

## How a run works

- **Headline runs** time whole ticks only. When an implementation has a `tick()` function, the runner calls it. Otherwise the runner calls the phases in spec order.
- **Deep-dive runs** call the phases one by one. They record the phase times, GC time, allocation and heap for each tick. `--deep` and `--record` add 2 of them. `--runs N` alone gives N headline runs and no deep runs. The report shows the overhead of the extra timers.
- **Warmup.** Each run is a fresh child process. It first runs the first 20% of the scenario's ticks (at least 50) as a throwaway warmup, then times a fresh sim. The hash check and the goldens apply to the timed run only.
- **Snapshot and restore.** The runner asks for a save after each 25th tick. After every 200th tick it loads the newest save and replays the 24 ticks after it. The hash trace must match a run without the loads. Every run kind uses this schedule (`runner/src/schedule.ts`), and the time of each save and load is in the total.

## Commands

Use Node 24.2 or later (`.nvmrc`). The runner and the koota build need it.

```sh
pnpm install
pnpm test                                   # unit and behaviour tests
pnpm test:heavy                             # *.heavy.test.ts: full fights, minutes. The pre-push hook runs it
pnpm verify koota skirmish-smoke            # compare the hash trace of each seed with the golden
pnpm verify:all                             # every implementation, every smoke scenario
pnpm run diff koota skirmish 120 7 9        # find the first differing record against baseline-js
pnpm run profile skirmish battle war        # count ECS operations per tick in baseline-js, run the liveness guard
pnpm budget                                 # load budget check on baseline-js, first seed
pnpm budget battle --seeds --runs 10        # every seed, 10 runs for each variant
pnpm budget --report-only                   # print the table, do not fail
pnpm run check:caps                         # check the links in every CAPABILITIES.md
pnpm bench baseline-js koota skirmish --runs 5   # 5 timed runs, one child process for each run
pnpm bench koota skirmish --deep            # add 2 deep-dive runs after the headline runs
pnpm bench baseline-js koota skirmish war --record   # adaptive runs, 2 deep runs, save in bench-data/, rebuild docs/results.md
pnpm compare koota@main koota@fresh-perf battle
pnpm bench koota skirmish --protocol        # benchbox native protocol: JSON lines on stdout, samples = tick ns (`headline-tick`: every timed tick of every headline run, unordered, for benchbox verdicts)
pnpm bench koota skirmish --runs 10 --out a.json   # result file with the machine info and the raw value of each run
pnpm compare a.json b.json                  # compare two result files, for example from two machines or commits
BENCH_WRAP="taskset -c 3" pnpm bench ...    # start each child with a prefix command (core pinning, priority)
pnpm results                                # rebuild docs/results.md from bench-data/
```

The headline score needs `baseline-js` in the same bench, because it divides by the `baseline-js` time of matched runs.

## Baselines

A push to `main` runs the workflow `.github/workflows/bench.yml`. It builds `koota` and `baseline-js` and submits a full board to benchbox. It does not wait for the results. The log shows the job ids.

A CI token on a clean tree makes a baseline run. Any other run stays local. A baseline run is not yet a Baseline. Bless it:

1. Wait for the job to finish.
2. For each Project, run `benchbox bless <jobId>`. Do it for `koota` and for `baseline-js`.

Set up the workflow one time:

1. In the benchbox repo, run `pnpm run token mint client ci --ci --remote --env staging`. Copy the token. It shows one time.
2. Run `gh secret set BENCHBOX_TOKEN`. Paste the token.
3. `jerzakm/benchbox` is private. Make a fine-grained personal access token with read-only Contents access to that one repo. Run `gh secret set BENCHBOX_REPO_TOKEN`. Paste the token. The workflow uses it to check out benchbox at `canary`.
4. Optional: run `gh variable set BENCHBOX_URL --body <url>`. The default is `https://bench-staging.benchbox.app`.

Without either secret, the workflow skips the submit and prints a notice.

Besides the `total` bench, every scenario submits a `headline-tick` bench: the tick time of every timed tick of every headline run, about 1100 samples for each run (a load replays some ticks). benchbox gives a Verdict only from 14 samples on each side, which `total` (3 to 10 samples) never reaches. The bench is not ordered, because the runs are pooled and tick t of one run does not pair with tick t of another. At most 10 runs of about 2250 timed ticks (battle) make about 22500 samples, under the 50000 cap of benchbox, so nothing is subsampled. `pnpm import:benchbox` ignores it.

## Results

[docs/results.md](docs/results.md) shows the headline score and the latest recorded run for each target and scenario. `bench-data/summary.csv` keeps one row for each commit, target and scenario, so the commit history is the trend. The page appears after the first import of the new series.

One command fetches both Projects of a commit, updates the data and the page, and prints the headline score with one ratio row for each phase:

```
pnpm import:benchbox                    # results of HEAD, every impl
pnpm import:benchbox --commit 938bef3   # a named commit
pnpm import:benchbox results.json       # offline, from a saved `benchbox results` file
```

It runs `benchbox results --project impls/<impl>` for each impl. The Project name is the path of the impl directory. A commit needs a finished `baseline-js` job, because the headline divides by it.

The data of the old protocol (`battle`, 2000 ticks, 10 headline and 10 deep runs) is in `bench-data/old-protocol/` and `docs/old-protocol/results.md`. It does not compare with the new series.

Results before the short-warmup commit (a full-length warmup, 2 deep runs on every board run) are a different protocol too. Their timings are not comparable with later results.

## How it works

- `packages/spec/SPEC.md` is the rules. It is authoritative.
- `packages/spec/src` is the shared kernel. It holds randomness, fixed-point math, formulas, rule tables, the hash and the shared spatial grid. The grid is the only part that holds state about entities. Each implementation tells the grid which units it added, moved or removed. Every spatial search uses it.
- `impls/<name>` is one implementation for each library. An implementation writes only the ECS parts: components, relations, queries, systems, data layout, save and load.
- `runner/` runs the save and load schedule, takes snapshots and hashes them.
- `goldens/` holds the hash traces that `baseline-js` writes, one for each scenario and seed.

## Why fixed point

All state is int32. Positions use 1/1024 of a tile. Float addition is not associative, so two libraries that visit entities in different orders give different float sums. The hashes then differ, and verify fails for a reason that is not a bug. Integers make the result independent of iteration order.

## Idiomatic and tuned

Each library has up to two implementations:

- `impls/<lib>` is **idiomatic**. It uses only the APIs that the library docs teach. This is the headline number.
- `impls/<lib>-tuned` is optional. It can use any public API for maximum speed. The results label it separately.

The gap between the two numbers shows the cost of the idiomatic style.

`impls/baseline-js` uses plain arrays. It is the reference for correctness and for the headline ratio. It is not in the ranking.

## Out of scope

- **Subscribed reads**, such as React bindings or network clients. They measure the binding more than the ECS.
- **Many worlds and world reset.** The game runs one world. Load replaces its state in place.
- **Editor reflection.** No game rule reads component schemas at run time.
- **Worker threads.** Most JS ECS libraries do not support them, and the rules assume one thread.
- **Symmetric relations.** No game rule needs one that a plain relation cannot express.
- **Prefabs.** Spawn code sets each field. A prefab would only move that code.

## Known biases

- **`baseline-js` under-prices structural change.** Plain arrays add and remove tags almost for free. The load budget measures shares in `baseline-js` time, so structural facets look cheaper than they are in an archetype library.
- **Start-of-phase copy.** A library without double-buffered stores copies the positions before `move`, in the optional `Sim.moveStart` step. Each such library pays this cost. `baseline-js` does not. The deep-dive report shows the cost as its own `move.start` line, and `move` does not include it.
- **The shared grid pulls ratios toward 1.** Every library uses the same kernel grid for spatial searches. That time is equal for all libraries, so it makes the ratios smaller.

## Add a library

Read [docs/adding-a-library.md](docs/adding-a-library.md).
