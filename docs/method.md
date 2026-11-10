# Method

This page explains how ecs-arena turns three games into one score for each library, and how it checks that the games test what they claim. The exact rules of the games are in [SPEC.md](../packages/spec/SPEC.md), [SPEC-survivors.md](../packages/spec/SPEC-survivors.md) and [SPEC-factory.md](../packages/spec/SPEC-factory.md).

## The score

Each library gets one score for each game. No number mixes the games.

- The score is the geometric mean, over the board scenarios of the game, of the library time divided by the `baseline-js` time. Lower is better. `baseline-js` is 1.
- The board scenarios are `skirmish` (about 5k peak entities) and `war` (about 50k) for the RTS, `grove` (about 1.1k) and `swarm` (about 3k) for survivors, and `mill` (about 6k) and `works` (about 160k) for factory. `battle` and `thicket` are for local use.
- The time is the total run time of a headline run. The report also shows p99, the max tick and the ticks over 16.6 ms.
- `baseline-js` uses plain arrays and no library. It is the reference for correctness and for the ratio. It is not ranked.

## How a run works

- **Headline runs** time whole ticks only. When an implementation has a `tick()` function, the runner calls it. Otherwise the runner calls the phases in spec order.
- **Warmup.** Each run is a fresh child process. It first runs the first 20% of the scenario's ticks (at least 50) as a throwaway warmup, then times a fresh sim.
- **Adaptive run count.** A headline has 3 to 10 runs. It stops when the 95% interval of the median is under 2% of the median. An entry that has used 10 min of wall time stops after the 3-run minimum. Two libraries whose intervals overlap share a rank.
- **Clock check.** A fixed integer loop runs before the warmup and after the timed run. If the two times differ by more than 5%, the CPU clock moved and the run counts as unstable. Each entry reports its relative spread (1.4826 * MAD / median), the smallest change its run count can detect, and its unstable runs. Read a gap smaller than the min detectable change as noise.
- **Deep-dive runs** (`--deep`) call the phases one by one and record phase times, GC time, allocation and heap for each tick. The report shows the overhead of the extra timers.
- **Save and load.** The runner asks for a save after each 25th tick. It loads the newest save every `loadEvery` ticks (200 in the RTS and factory, 50 in survivors) and replays the ticks after it. The hash trace must match a run without the loads. The time of each save and load is in the total. See `runner/src/schedule.ts`.

The statistics follow [pmndrs/labs](https://github.com/pmndrs/labs) (ISC).

## Correctness

An implementation is correct when its hash trace matches the golden for every tick. `pnpm verify` checks 3 seeds for each scenario. Timing uses the first seed only. `baseline-js` writes the goldens in `goldens/`.

All state is int32, and positions use 1/1024 of a tile. Float addition is not associative, so two libraries that visit entities in different orders would get different sums and different hashes. Integer state makes the result independent of iteration order. Every random number is a pure function of seed, tick, entity and purpose, so the call order does not matter either.

## Load budget

One score is fair only when the game loads each ECS feature by a known amount. Each feature that a game claims to test is a named, timed region in `baseline-js`. A flag switches one region to naive code that does the same work without the feature, for example a scan of all units in place of an index.

A region passes when all of these are true, in every scenario that claims it and with every seed. A claim is for all scenarios of a game unless the facet names its scenarios. Factory does: `mill` and `works` are two regimes, so a region that only one of them loads is claimed by that one (`scenarios` of a facet in `packages/spec/src/factory/facets.ts`):

- **Floor.** The naive region time is at least 2% of the normal tick total. A library without the feature loses at least 2% of the tick.
- **Cap.** The normal region time is at most 25% of the normal tick total. No feature takes over the score.
- **Naive is slower.** The naive region is at least 1.5 times slower than the normal region.
- **Same result.** The naive run gives the same hashes as the normal run.

`pnpm budget` runs the check on `baseline-js`. The thresholds live in `runner/src/budget-check.ts`. The design and the tuning log of each game are in [docs/design/](design/).

## Liveness

A rule that never fires never changes the hash, so an implementation could skip it. `pnpm run profile` counts the activations of each rule in `baseline-js` for each seed. It fails when a counter stays at 0. A factory rule is checked only for the scenarios that its facet names. The RTS rules are in `HARNESS` in `runner/src/games.ts`. The survivors rules come from `FACETS` and `SYSTEMS` in `packages/spec/src/survivors/facets.ts`, and the factory rules from `FACETS` in `packages/spec/src/factory/facets.ts`.

## Idiomatic and tuned entries

- `impls/<lib>` is **idiomatic**. It uses only the APIs that the library docs teach. This is the ranked entry.
- `impls/<lib>-tuned` is optional. It can use any public API for maximum speed. The results label it apart.

The gap between the two shows the cost of the idiomatic style.

## Known biases

- **`baseline-js` under-prices structural change.** Plain arrays add and remove tags almost for free. The load budget measures shares in `baseline-js` time, so structural features look cheaper than they are in an archetype library.
- **Sorting by gameId is a determinism cost.** The rules visit entities in `gameId` order wherever order changes the result. A library whose queries return entities in another order pays for a sort that a real game would skip.
- **Start-of-phase copy.** A library without double-buffered stores copies the positions before `move`, in the optional `moveStart` step. `baseline-js` does not. The deep-dive report shows the cost as its own `move.start` line.
- **The shared grid pulls ratios toward 1.** Every library uses the same kernel grid for spatial searches. That time is equal for all libraries, so it makes the ratios smaller.
- **Load knobs.** Some rules exist to put a known load on a feature. Commander orders probe random `gameId` keys to load lookup by key, and survivors scales tag durations (`tagScale`) and particle bursts (`particleScale`) to set the churn rate. The knobs are in the scenario files and the reasons are in the design docs.
- **Saves are frequent.** A save every 25 ticks and a load every 50 to 200 ticks is closer to rollback netcode than to autosave.

## Out of scope

- **Subscribed reads**, such as React bindings or network clients. They measure the binding more than the ECS.
- **Many worlds and world reset.** Each game runs one world. Load replaces its state in place.
- **Editor reflection.** No rule reads component schemas at run time.
- **Worker threads.** Most JS ECS libraries do not support them, and the rules assume one thread.
- **Symmetric relations.** No rule needs one that a plain relation cannot express.
- **Prefabs.** Spawn code sets each field. A prefab would only move that code.

## Commands

Use Node 24.2 or later (`.nvmrc`).

```sh
pnpm test                                   # unit and behaviour tests
pnpm test:heavy                             # full fights, minutes. The pre-push hook runs it
pnpm verify koota skirmish-smoke            # compare the hash trace of each seed with the golden
pnpm verify:all                             # every implementation, every smoke scenario
pnpm run diff koota skirmish 120 7 9        # first differing RTS snapshot record against baseline-js
pnpm run profile skirmish grove             # count operations in baseline-js, run the liveness check
pnpm budget                                 # load budget on baseline-js, first seed
pnpm budget battle --seeds --runs 10        # every seed, 10 runs for each variant
pnpm run check:caps                         # check the links in every CAPABILITIES.md
pnpm bench baseline-js koota skirmish war   # adaptive headline runs, one child process per run
pnpm bench koota skirmish --deep            # add 2 deep-dive runs
pnpm bench koota skirmish --runs 10 --out a.json   # result file with machine info and raw samples
pnpm compare a.json b.json                  # compare two result files
pnpm compare koota iris grove --base main   # each impl at a git ref against this tree, runs interleaved
BENCH_WRAP="taskset -c 3" pnpm bench ...    # prefix each child (core pinning, priority)
pnpm bench:site                             # the board run that the project page reads (site/results.json)
pnpm site                                   # build the project page and the viewer into _site
```

The score needs `baseline-js` in the same bench, because it divides by the `baseline-js` time of matched runs. `--record` saves a run into `bench-data/` and writes a Markdown results page under `docs/`, so the commit history keeps the trend.
