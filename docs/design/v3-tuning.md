# v3 tuning log (U7)

This file is the decision log of the load-budget tuning. Each attempt has a hypothesis, a change, numbers from before and after, and the verdict. Shares are in `baseline-js` time (D4). "Naive share" is the naive region time over the normal tick total (D20).

## Method

- `pnpm run profile` counts the peak entities (gauge `alive.total`) and checks liveness.
- `pnpm budget <scenario> --runs 3 --report-only` is the check. It takes about 5 min for `skirmish`, 12 min for `battle` and 25 min for `war`.
- The inner loop used an in-process variant of the check that runs each region once after one warmup. It agrees with the budget within about 20% on a share, so it only ranked ideas. Every accepted state was confirmed with the budget.
- A koota run must match the goldens at every step. `pnpm verify koota ...` was green at the end, and a comparison of the `baseline-js` and `koota` traces was green after each rule change.

Skirmish tick total drops from 1.46 s to about 1.15 s and `war` from 18.3 s to about 10 s over the attempts below, with a higher load on every facet.

## Starting point

`skirmish` and `battle` had `targetPop` 170 and 1,600 (SPEC §11 said 800 and 3,200). Peak entities, seed 1: skirmish 1,093, battle 8,650, war 49,716.
First budget, skirmish seed 1, before any change (`--runs 3`):

| Fails | Values |
|---|---|
| Ratio | `move.step` 1.33, `churn` 1.41, `links` 1.11, `morale.rout` 1.01, `stats.render` 1.31 |
| Floor | `cleanup.cascade` 0.91%, `cleanup.credit` 0.03%, `garrison` 0.38%, `save` 1.77%, `load` 0.23% |

## Attempts

| # | Hypothesis | Change | Before | After | Verdict |
|---|---|---|---|---|---|
| 1 | The peak targets need the SPEC §11 sizes | `skirmish` `targetPop` 800, `maxSquadsPerWave` 70, `surgeBase` 14, `surgeCap` 1,200. `battle` 3,200, 200, 40, 4,800 | peak 1,093 and 8,650 | peak 5,218 and 20,509 | kept |
| 2 | `stats.render` ratio fails because the `foldRender` hash, which is the kernel's, sits in the region | End the region before the fold | ratio 1.31 | 2.37 | kept |
| 3 | `churn` rebuilds the unit array in every tick, also when nothing was destroyed | Normal code skips the filter when no unit was destroyed. Projectiles are compacted in place | ratio 1.41 | 1.8 | kept |
| 4 | `links` normal code is a full index build, twice a tick, so naive is not slower | Normal code keeps `members` (the inverse of `MemberOf`) in step at spawn, `promote`, flee and destroy. The scan for dead units moved out of the region | ratio 1.11, share 8.2% | ratio 7.7 to 14, share 0.3 to 0.6% | kept |
| 5 | `morale.rout` normal code polls all units for a squad that must rout | Normal code reads only the units whose `lost` changed. The naive code keeps the poll and scans for `MemberOf`. The naive way in the table changes (see Table changes) | ratio 1.01 | 13 to 25 | kept |
| 6 | `garrison` has only a few events, so the naive scan is rare | The naive code finds the members of each garrison by a scan for `GarrisonOf` (normal code reads the shrine list). Table changes | naive share 0.38%, ratio 1.46 | 4 to 5.9%, ratio 10 to 18 | kept |
| 7 | More deaths per tick would lift every scan-per-death naive code. Try more lethal units | Maximum hp x0.3, attack x3, speed x2, faster waves (period 50, a quarter of the squads) | departures 1.0/tick, overwhelmed hits 29k | departures at most 1.7/tick, overwhelmed hits 1.2k to 10k, veterans 21 | reverted. A death rate that high kills the rules that need a crowd |
| 8 | A rule that appends once each tick gives `cleanup.credit` a naive cost that no kill rate reaches (a kill appends 0.2 times a tick, and 2% of the tick needs about 100 appends) | Rule change: each Veteran appends its hp to its chronicle once each tick. `VETERAN_KILLS` 3 to 1, `CHRONICLE_MAX` 4 to 384. SPEC §6.7 step 5a, `baseline-js`, `koota` | naive share 0.03%, ratio 1.0 | 17 to 30% (skirmish), 18.5% (battle), 3.75% (war), ratio 6.7 to 11 | kept. The only rule change |
| 9 | The shared target search is the largest cost (39% of skirmish, 76% of war), so every share is small | `THINK_INTERVAL` 4 to 16 and sight x0.75 (warrior, healer, summoner, minion 6, archer 8, mage and warlord 7.5) | tick total war 18.3 s, skirmish 1.13 s | war 9.4 s, skirmish 0.85 s. The war floors that failed at 1.3 to 1.9% went to 2.3 to 5% | kept. Thinking 16 ticks apart keeps the fights |
| 10 | `grid.update` naive sends all units once after `move` and the normal code sends the movers, so a ratio near 1 | The naive code sends every unit before each search: `ai/target`, `combat`, `objectives` and pickup (the table already said "before each search") | ratio 1.15 | 4.8 to 8 | kept |
| 11 | `threat` ratio 1.22 to 1.5. The region time of the normal code was mostly timer calls and allocation | `addThreat` and `evictThreat` without closures. One timed block for all victims. Purge only on a tick that destroyed a unit. The naive code scans all units for the edges of each destroyed attacker | ratio 1.2 (war) | 3.4 to 8 | kept |
| 12 | `move.step` ratio 1.43 to 1.51: the normal code also does map lookups (parent, target) | `Unit.tref` and `Unit.pref` hold direct references to the target and the parent. The naive code resolves every access through the `gameId` map, four times | 1.51 | 1.73 to 2.3 | kept |
| 13 | `stats.banner` ratio fell to 1.5 in `war` after attempt 12, and `stats.render` to 1.47 | The normal banner pass reads `pref`. The naive banner walks the chain through the map. The naive render copies each unit with `{ ...u }` | 1.47 and 1.47 | 4.1 to 5.4 | kept |
| 14 | `save` naive share 1.77% (skirmish) and 0.98% (war) | `SAVE_INTERVAL` 100 to 25, `loadTick` 1,562, 1,562, 762 (S is a multiple of 25, 12 ticks replayed) | 1.8% and 1% | 9 to 12% and 4.3% | kept |
| 15 | `cleanup.cascade` naive share 1.40% in the budget (skirmish), 2.4% in the inner loop (a fresh process is faster than a warm loop) | The naive code also scans for each expired minion (an old minion is destroyed without a cascade, so the scan finds nothing, but a library without the index cannot know) | 1.4% | 1.6 to 1.9%, not enough (attempt 17) | kept |
| 16 | `war` peaks 44.9k and 44.4k with seeds 2 and 3 (limit 42.5k) | `war` `targetPop` 8,000 to 9,200 | 49.7k, 44.9k, 44.4k | 54.1k, 48.6k, 46.6k | kept |
| 17 | Attempt 15 gave only 1.6 to 1.9% in the budget (fresh process), because a skirmish has 1.8 departures and expiries a tick. More destroyed units a tick lift every scan-per-destroy naive code | `SUMMON_PERIOD` 120 to 30, `MINION_LIFETIME` 300 to 90 (SPEC §4, §6.6). Destroyed minions 0.7 to 3.1 a tick | cascade naive share 1.4 to 1.9%, churn ratio 1.48 to 1.8 | cascade 4.5 to 5.5%, churn ratio 2.25 to 2.47 | kept |

## Table changes

`v3-game.md` has the new naive way of each row. The reasons:

- `links`, `morale.rout`, `garrison`, `stats.render`, `grid.update`, `threat`, `move.step`, `stats.banner`, `churn` and `cleanup.credit`. The old naive code shared most of its cost with the normal code (an index build, a full poll, a fold of the buffer, one map lookup in a loop of map lookups), so it measured nothing.
- `morale.rout`: the old naive way ("scan all units for `MemberOf` each routed leader") has about 0.4 events a tick, so it never reaches 2% of a tick. A library without change tracking polls every unit each tick, and the new naive way says so.
- The normal code of `links`, `morale.rout`, `churn`, `threat`, `move.step` and `stats.banner` got faster. None of it got slower.

## Rule change

SPEC §6.7 step 5a (the veteran log). Each tick, each Veteran that is still alive appends its hp to its chronicle, at most 384 entries (`CHRONICLE_MAX`). Why constants could not do it: the kill rate of the game is 0.2 to 3 a tick, and the naive copy of an array of up to 384 numbers costs less than a hundredth of a tick, so a rate of kills never gave 2%. `baseline-js` keeps the set `veterans`. `koota` queries `Veteran, Chronicle, Health`. Both traces agree on all seeds.

## Open failure: the `load` floor

The naive load runs once in a run (D5: one load). Its time is about 4 to 6 ticks of work, and a floor of 2% of a 2,000 tick run is 40 ticks of work. All other 21 regions pass in all 3 scenarios and all 3 seeds.

| Scenario | Naive load share, seeds 1, 2, 3 (budget) | Normal load share | Needed |
|---|---|---|---|
| `skirmish` | 0.61%, 0.52%, 0.66% | 0.14% to 0.16% | 2% |
| `battle` | 0.50%, 0.44%, 0.43% | 0.13% to 0.16% | 2% |
| `war` | 0.56%, 1.05%, 0.73% | 0.17% to 0.20% | 2% |

What was tried and why it stops here:

- The state grows with the chronicle (attempt 8), and that already counts in the numbers above.
- A shorter run raises the share in inverse proportion to the ticks, so 2% needs a run of about 300 ticks, which is shorter than the smoke run and has no real fight.
- A chronicle of 1,500 entries would reach about 2% in `skirmish`, but the veterans of a 1,000 tick run never fill it, and the hash input would grow four times.
- The load cost is about the cost of one save, and a save is cheap per tick. A run has 80 saves and 1 load.

Proposed decision change (the smallest one): D5 says "loads one save". Change it to "loads the newest save after every 200th tick" (a `loadEvery` of 200 instead of `loadTick`, with the replay of the ticks since the last save). That gives `skirmish` and `battle` 10 loads and `war` 5. The naive load share becomes about 6% (skirmish), 4.5% (battle) and 2.8 to 5% (war), and the normal share about 1.5%. The run gets about 6% longer, because each load replays 12 ticks. The change is in `runner/src/schedule.ts`, SPEC §10 and §11 and the goldens. No implementation code changes, because `Sim.load` already replaces the live state.

## Final state

Commits: `eba6fcf` (tuning, naive variants, veteran log, `SAVE_INTERVAL` 25) and `058f947` (minion life and summon period). The goldens are regenerated for all scenarios and seeds in both.

Peak entities, `pnpm run profile`, seeds 1, 2, 3:

| Scenario | Target | Peak, seed 1 | seed 2 | seed 3 |
|---|---|---:|---:|---:|
| `skirmish` | 5k, 4,250 to 5,750 | 4,987 | 4,929 | 4,838 |
| `battle` | 20k, 17,000 to 23,000 | 19,493 | 19,434 | 19,826 |
| `war` | 50k, 42,500 to 57,500 | 50,831 | 49,998 | 49,452 |

`pnpm run profile skirmish battle war` says "liveness ok: no zero counter" for all 3 seeds.

Load budget, `pnpm budget <scenario> --seeds --report-only`, all 3 seeds. `skirmish` has 3 runs for each variant, `battle` 2 runs and `war` 1 run (about 25 min for `war` with 3 seeds and 1 run). Each cell is the worst of the 3 seeds: the highest normal share (cap 25), the lowest naive share (floor 2) and the lowest naive/normal ratio (1.5). Every hash is the same as the normal run.

| Region | skirmish max share % | skirmish min naive share % | skirmish min ratio | battle max share % | battle min naive share % | battle min ratio | war max share % | war min naive share % | war min ratio |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| move.step | 13.77 | 26.73 | 1.97 | 12.99 | 26.49 | 2.06 | 10.89 | 20.63 | 1.97 |
| churn | 5.83 | 11.99 | 2.25 | 5.38 | 25.58 | 4.76 | 3.97 | 29.35 | 8.09 |
| effects.buffs | 0.55 | 5.15 | 9.31 | 0.50 | 3.91 | 8.30 | 0.60 | 6.08 | 10.62 |
| cleanup.unlink | 1.28 | 3.43 | 2.70 | 0.78 | 3.19 | 4.22 | 0.57 | 2.96 | 5.52 |
| move.depthOrder | 0.01 | 14.38 | 984.29 | 0.01 | 15.49 | 2598.04 | 0.00 | 13.80 | 4726.65 |
| cleanup.cascade | 0.08 | 4.49 | 53.81 | 0.08 | 9.15 | 119.38 | 0.04 | 13.52 | 304.76 |
| links | 0.71 | 4.14 | 6.61 | 0.56 | 13.55 | 27.74 | 0.27 | 21.16 | 77.86 |
| objectives.capture | 0.69 | 12.97 | 16.98 | 0.56 | 10.73 | 19.19 | 0.40 | 11.13 | 27.59 |
| morale.rout | 0.23 | 3.43 | 15.40 | 0.10 | 4.66 | 47.89 | 0.05 | 7.40 | 155.15 |
| morale.onFlee | 0.06 | 4.76 | 89.30 | 0.05 | 4.85 | 104.64 | 0.05 | 4.99 | 101.79 |
| stats.recompute | 0.39 | 34.24 | 92.01 | 0.33 | 31.24 | 101.03 | 0.20 | 18.63 | 92.68 |
| stats.setBonus | 0.11 | 3.76 | 33.76 | 0.07 | 5.56 | 81.22 | 0.04 | 5.34 | 138.85 |
| stats.banner | 3.28 | 13.87 | 4.19 | 3.34 | 13.70 | 4.25 | 3.67 | 11.83 | 3.41 |
| combat.fanIn | 1.22 | 5.19 | 4.40 | 1.36 | 4.20 | 3.07 | 1.07 | 4.68 | 4.40 |
| threat | 3.05 | 11.79 | 3.70 | 3.08 | 26.42 | 8.73 | 2.63 | 51.38 | 19.86 |
| cleanup.credit | 3.24 | 27.75 | 10.08 | 2.82 | 16.64 | 6.15 | 0.62 | 4.52 | 8.13 |
| grid.update | 2.36 | 11.15 | 4.95 | 2.22 | 10.74 | 5.09 | 3.60 | 14.28 | 4.35 |
| garrison | 0.54 | 5.15 | 9.59 | 0.29 | 4.43 | 15.98 | 0.32 | 4.30 | 15.39 |
| orders.lookup | 0.46 | 7.28 | 16.59 | 0.39 | 22.06 | 60.35 | 0.38 | 40.34 | 134.77 |
| stats.render | 3.42 | 31.70 | 9.49 | 3.50 | 23.89 | 6.82 | 3.40 | 17.17 | 5.20 |
| save | 2.87 | 10.23 | 3.36 | 2.70 | 7.98 | 3.10 | 1.40 | 3.79 | 3.12 |
| load | 0.16 | 0.52 | 3.30 | 0.16 | 0.43 | 2.74 | 0.20 | 0.56 | 3.23 |

Every cell passes except the naive share of `load` (0.43% to 0.56% against 2%). `war` has one run for each variant, so its cells have more noise than the others. The thinnest margins are the naive share of `cleanup.unlink` in `war` (2.96%), `stats.banner` in `war` (ratio 3.4), and `churn` in `skirmish` (ratio 2.25).

Koota headline (`pnpm bench baseline-js koota skirmish battle war --runs 5`): 7.087, 95% interval 6.903 to 7.382. Totals: `skirmish` 7.4 s, `battle` 33.7 s, `war` 42.0 s.

## How to repeat

1. `pnpm run profile skirmish battle war` for the peaks and the liveness.
2. `pnpm budget skirmish --seeds --runs 3 --report-only` (add `battle` and `war`, with fewer runs).
3. `pnpm verify koota skirmish battle war` and `pnpm verify:all` after any change to a constant or a rule. Regenerate the goldens first with `pnpm verify baseline-js <scenarios> --write`.
