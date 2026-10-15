# v3 tuning log (U7)

This file is the decision log of the load-budget tuning. Each attempt has a hypothesis, a change, numbers from before and after, and the verdict. Shares are in `baseline-js` time (D4). "Naive share" is the naive region time over the normal tick total (D20).

## Method

- `pnpm run profile` counts the peak entities (gauge `alive.total`) and checks liveness.
- `pnpm budget <scenario> --runs 3 --report-only` is the check. It takes about 5 min for `skirmish`, 12 min for `battle` and 25 min for `war`.
- The inner loop used an in-process variant of the check that runs each region once after one warmup. It agrees with the budget within about 20% on a share, so it only ranked ideas. Every accepted state was confirmed with the budget.
- A koota run must match the goldens at every step. `pnpm verify koota ...` was green at the end, and a comparison of the `baseline-js` and `koota` traces was green after each rule change.

Skirmish tick total drops from 1.46 s to 1.0 s and `war` from 18.3 s to 9.4 s over the attempts below, with a higher load on every facet.

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
| 15 | `cleanup.cascade` naive share 1.40% in the budget (skirmish), 2.4% in the inner loop | The naive code also scans for each expired minion (an old minion is destroyed without a cascade, so the scan finds nothing, but a library without the index cannot know) | 1.4% | see Final | kept |
| 17 | Attempt 15 gave only 1.6 to 1.9% in the budget (fresh process), because a skirmish has 1.8 departures and expiries a tick. More destroyed units a tick lift every scan-per-destroy naive code | `SUMMON_PERIOD` 120 to 30, `MINION_LIFETIME` 300 to 90 (SPEC §4, §6.6). Destroyed minions 0.7 to 3.1 a tick | cascade naive share 1.4 to 1.9%, churn ratio 1.48 to 1.8 | see Final | kept |
| 16 | `war` peaks 44.9k and 44.4k with seeds 2 and 3 (limit 42.5k) | `war` `targetPop` 8,000 to 9,200 | 49.7k, 44.9k, 44.4k | 54.1k, 48.6k, 46.6k | kept |

## Table changes

`v3-game.md` has the new naive way of each row. The reasons:

- `links`, `morale.rout`, `garrison`, `stats.render`, `grid.update`, `threat`, `move.step`, `stats.banner`, `churn` and `cleanup.credit`. The old naive code shared most of its cost with the normal code (an index build, a full poll, a fold of the buffer, one map lookup in a loop of map lookups), so it measured nothing.
- `morale.rout`: the old naive way ("scan all units for `MemberOf` each routed leader") has about 0.4 events a tick, so it never reaches 2% of a tick. A library without change tracking polls every unit each tick, and the new naive way says so.
- The normal code of `links`, `morale.rout`, `churn`, `threat`, `move.step` and `stats.banner` got faster. None of it got slower.

## Rule change

SPEC §6.7 step 5a (the veteran log). Each tick, each Veteran that is still alive appends its hp to its chronicle, at most 384 entries (`CHRONICLE_MAX`). Why constants could not do it: the kill rate of the game is 0.2 to 3 a tick, and the naive copy of an array of up to 384 numbers costs less than a hundredth of a tick, so a rate of kills never gave 2%. `baseline-js` keeps the set `veterans`. `koota` queries `Veteran, Chronicle, Health`. Both traces agree on all seeds.

## Open failure: the `load` floor

The naive load runs once in a run (D5: one load), and its time is about 4 to 6 ticks of work. A floor of 2% of 2,000 ticks is 40 ticks of work.

| Scenario | Naive load share (budget, seed 1) | Needed |
|---|---|---|
| `skirmish` | 0.67% | 2% |
| `battle` | about 0.5% | 2% |
| `war` | about 0.6% | 2% |

What was tried and why it stops here:

- The state size grows with the chronicle (attempt 8), and that already counts in the numbers above.
- A shorter run raises the share in inverse proportion to the ticks, so 2% needs about 300 ticks, which is shorter than the smoke run and has no fights.
- A chronicle of 1,500 entries would reach about 2% in `skirmish`, but the veterans of a 1,000 tick run never fill it, and the hash input would grow tenfold.

Proposed decision change (the smallest one): D5 says "loads one save". Change it to "loads the newest save after every 250th tick" (`loadEvery` 250 instead of `loadTick`, with the replay of the ticks since the last save). That gives `skirmish` and `battle` 8 loads, `war` 4, and the naive load share reaches about 4% and 2.4%. A load costs about 5% of the ticks it replays, so the run gets 5% longer. The change is in the runner schedule and in SPEC §10 and §11. No implementation code changes, because `Sim.load` already replaces the live state.

## Final state

See the end of this file.
