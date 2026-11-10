# Game 3: `factory`, a large idle world and a small busy one

This document gives the design of the third game and the reasons for it. The game has two board scenarios, `works` (a large world, mostly idle) and `mill` (a small world, mostly busy). The first version had `yard` in the place of `mill`. It was the same regime as `works` at a smaller size, so it was replaced. `packages/spec/SPEC-factory.md` holds the exact rules. The code is in `packages/spec/src/factory/`.

## Problem

The RTS and survivors are combat games. In both, almost every entity acts on every tick. Many real ECS workloads look different: a colony, factory or city sim, a tile map, or a server with many idle players. There, most entities sit still, a small set is active, and the cost is in finding that set and in reacting to what changed.

A review of the first two games found five common workloads that neither one loads:

1. A large world that is mostly idle, with change detection at scale.
2. Dense iteration over wide numeric components.
3. Transform propagation down a hierarchy.
4. Bulk and deferred structural change.
5. Queries with `Or` and optional components.

`factory` loads these five and nothing else. `works` loads the first, the third and the fourth in an idle world. `mill` loads the second, the third and the fourth in a busy world, and adds the cost of a working set that is most of the world. It is the smallest of the three games: 3 entity kinds, 9 phases and no combat.

## The game

A grid of districts holds a fixed block of machines. Machines turn ore into plates, plates into gears, and sinks consume gears. Drones fly fixed routes between two machines and carry up to 3 crates. Each crate is a child entity of the drone or of the crate below it. A shift change retires and spawns drones in bulk, and power outages switch whole districts on and off.

At 150,000 machines (`works`), about 98% of the machines are idle after the first few hundred ticks. An extractor that no drone serves fills its output and stops. A smelter that no drone feeds never starts. The working set is the machines on drone routes and the extractors that are still filling.

At 1,600 machines (`mill`), every machine is on a production line and every line has drones, so about 75% of the machines are Working on a tick after the first 200 ticks.

## Why two regimes

The two board scenarios use the same rules and test opposite trade-offs.

- **Idle world (`works`).** The working set is a small part of a large world. A library wins by keeping that set small and ready to read (a query that does not scan), by finding only the machines that changed, and by changing the tag of a whole district at once cheaply. A library that must visit every machine loses.
- **Busy world (`mill`).** The working set is most of the world, so keeping it costs nothing and a scan of all machines is nearly as fast as the query. What counts is dense iteration over a large `Working` set, the cost of the `Working` tag when hundreds of machines gain or lose it in one tick (an archetype row move against a sparse set insert), and change detection under a high change rate, where the changed list is a large part of the world.

The first version had a second idle scenario, `yard` (20,000 machines, 1.5% at work). It tested the same thing as `works` at a smaller size, so the board did not show how a library behaves when the world is busy.

## Facets

Each facet with a region is a timed region in `baseline-js` with a naive variant. The load budget (`docs/method.md`) checks that it costs between 2% and 25% of a tick and that the naive variant is at least 1.5 times slower. A facet without a region is checked by a liveness counter only.

A facet has a `scenarios` list in `FACETS` (`packages/spec/src/factory/facets.ts`). The budget check and the liveness check use a facet only for the scenarios in its list. The Region column names that list when it is not both scenarios. A busy world makes the naive scan of `work.query` nearly as fast as the set, so `mill` does not claim it. The `power.toggle` region costs under the floor in `mill`, which has 4 districts, so `mill` does not claim it either.

| Facet | Game rule | Phase | Naive way | Region | Favors |
|---|---|---|---|---|---|
| Query over a small active set in a large world | Only `Working` machines progress | `work` | Scan every machine and test `Working` | `work.query` (`works`) | archetype or sparse set: both keep the set |
| Dense iteration over a large working set | `work` runs the cycle of each `Working` machine, most of the world in `mill` | `work` | Look the machine up by `gameId` in a `Map` for every field access | `work.step` (`mill`) | archetype and SoA: dense columns |
| Tag churn on a large set | `state` gives and takes `Working`. Hundreds of machines flip in one tick when a district loses power | `state` | Make a new array of the set for each tag change | `work.tag` (`mill`) | sparse set: a tag change is a set insert, not a row move |
| Change detection at scale | `Working` is re-checked only for machines whose inputs, outputs or power changed | `state` | Re-check every machine every tick | `state.changed` (both) | the design of the change tracker |
| Bulk tag change on a large set | An outage removes `Powered` from about 700 machines of a district at once | `power` | Scan every machine for each district that changed | `power.toggle` (`works`) | sparse set: a tag change is a set insert, not a row move |
| One-to-many lookup | A district lists its machines | `power` | (inside `power.toggle`) | `power.toggle` | neutral |
| Dense iteration over wide components | Each drone integrates 8 fields: `x, y, vx, vy, ax, ay, c, s` | `move` | Find each drone by `gameId` in a `Map` for every field access | `drone.move` (both) | archetype and SoA: dense columns |
| Transform propagation | Each crate's world transform comes from its parent, up to depth 3 | `transform` | Walk the chain from the drone for each crate | `transform` | neutral: cost is in the parent read |
| Bulk and deferred structural change | Docked drones create and destroy crates, and a shift retires and spawns hundreds of drones and their crates in one tick | `dock`, `shift` | Rebuild the entity arrays after each create or destroy | `churn` | archetype: one batch, one move |
| Bulk create | Tick 0 builds every machine (150,000 in `works`) | `build` | none | none | archetype: a create writes one row |
| `Or` query | A machine works with `Powered` or `Manual`. `Manual` is every extractor and 1 in 8 of the other machines, so no kind test can replace it | `state` | none | none | neutral |
| Optional component | `boost` adds speed when present | `work` | none | none | neutral |
| Save and load of a large world | Save every 25 ticks, load every 200 | between ticks | `JSON.stringify` and `JSON.parse` | `save`, `load` | archetype: whole columns copy |

## Choices

- **Routes are fixed, on production lines.** A drone never searches for work. Each district has a number of lines (`lines` of the scenario: 12 in `works`, 100 in `mill`) of 4 machines (extractor, smelter, assembler, sink), and each drone serves one leg of one line. The kind pattern and the line count are fields of the scenario, so a world can be fully on lines (`mill`) or mostly off them (`works`). A first draft drew sources at random, and a review showed that gears would then almost never reach a sink. A search over 150,000 machines would need a spatial index, and the kernel grid of the other games makes ratios tend toward 1. A fixed route keeps the game about storage and change, not search. The kernel gives each route from a draw, so no implementation needs a lookup table of machine kinds.
- **The snapshot holds only changed machines.** A full dump of 150,000 machines on every tick would make `pnpm verify` slow, and it would not test anything that the changed list does not. A machine that diverges shows up in the first tick that it changes. The changed list is also the change-detection facet: an implementation that loses a change has a different hash.
- **Rotation is a unit vector, not an angle.** `(c, s)` composes with integer multiplies and needs no angle table or `atan2`. Transform propagation is then the same multiply-add that a 2D scene graph does.
- **Outages come from draws, not from a power model.** The facet is the bulk tag change. A model of generators and wires would add rules without adding a facet.
- **No render buffer.** The RTS and survivors already load render extraction.

## Out of scope

- **Spatial search.** See the fixed routes above.
- **Pathfinding.** Drones fly straight lines. Pathfinding is not an ECS workload.
- **Belts and item entities on belts.** They would add a second churn rule with the same shape as crates.

## Open questions _(tune)_

- The `drone.move` naive way repeats the RTS `move.step` naive way (a `Map` lookup per access). It tests direct access, not the column layout. If the region fails the 1.5x check, the naive way becomes a scan of all entities that tests for a drone.
- `power.toggle` and `transform` may fall under the 2% floor at the first numbers. The levers are `powerEvery`, `outagePermille` and the drone count.
- Save time grows with the world, and `works` saves 150,000 machines 40 times per run. If the `save` region is over the 25% cap, `works` gets more ticks or fewer machines.

## Tuning log

### First version (`yard` and `works`)

Shares are in `baseline-js` time. The first runs used `pnpm budget <scenario> --runs 3`. The final table is `pnpm budget yard works --seeds --runs 5`. The machine ran at a load average above 40, so single runs were noisy (a region ratio spread of 1x to 30x). A run is judged by the median and by an in-process minimum over 4 to 6 repeats.

| # | Hypothesis | Change | Before | After | Verdict |
|---|---|---|---|---|---|
| 1 | The first 320 ticks decide the numbers: every extractor (43% of the machines) is Working until its output is full, so the scan is only 1.2x slower than the Working set | Extractors start with `output = CAP` (SPEC §5.1, `startOutput`), so the world is idle from tick 0 | `works` `work.query` 42% share, ratio 1.17x. `yard` `work.query` 26% and `state.changed` 27%, both over the cap | Working set 1.4% of the machines (`works`). `work.query` 4 to 7%, ratio 19 to 27x. `state.changed` 6 to 9% | kept. A longer run could not help: the transient was 80% of the machine time |
| 2 | The changed list (SPEC §8) belongs to change detection, so a naive tracker diffs every machine too | The diff pass of `state` is inside the `state.changed` region. The normal code diffs the Working set and the dirty list | `state.changed` 1.3%, naive 115% (`yard`) | 6 to 9%, naive 210 to 670% | kept |
| 3 | `transform` was noisy and slow (0.8x to 2x) because array destructuring into object members runs the iterator protocol | `compose` results are read by index in `baseline-js`. No spec change | `works` normal 228 ms for 3.1M crates, naive 165 ms | normal 67 ms, naive 163 ms, ratio 2.4 | kept |
| 4 | `power.toggle` naive share was 2.0 to 2.8% in `yard` (16 districts), too close to the 2% floor | `powerEvery` 100 to 50 in both scenarios. Smoke runs now see outages and restores on every seed | `yard` naive 2.0 to 2.8% | 4.3 to 7.2% (`yard`), 110 to 190% (`works`) | kept |
| 5 | `save` normal share could pass the cap in `works` (150,000 machines, 40 saves) | The save copies the 4 mutable machine columns into typed arrays. Static fields come from the kernel | not measured with the object tree | 7 to 10%, naive 6.9 to 9x slower (JSON text) | kept |
| 6 | The `drone.move` naive way (a `Map` lookup per field) may be under 1.5x | none needed | n/a | ratio 5.5 to 7.9x, share 11 to 14% | kept as designed |

Not changed: the drone counts, `shiftEvery`, `shiftPermille`, `outagePermille`, ticks and `machinesPerDistrict`.

Final result: every region passes on both scenarios and all 3 seeds. Normal shares are `work.query` 3.5 to 6.9%, `state.changed` 6.5 to 9.2%, `power.toggle` 0.8 to 1.0%, `drone.move` 10.8 to 14.1%, `transform` 5.0 to 7.4%, `churn` 3.8 to 5.7%, `save` 7.4 to 10.2%, `load` 1.2 to 1.8%. The unattributed part is 47 to 59% (`steer`, `dock`, `shift`, `build`).

Open question 1 is closed: the `Map` lookup per field is enough. Question 2 is closed: `transform` and `power.toggle` pass at the numbers above. Question 3 is closed: `save` is under the cap.

Liveness: every counter is above 0 on `yard` and `works` for all 3 seeds, and also on the smoke scenarios. Working set (`work.machine`) mean: 325 a tick in `yard` (1.6% of its machines), 2,150 in `works` (1.4%). `yard` was removed in the second round below.

### Second round (`mill` replaces `yard`)

The goal was a small scenario where most machines work, so that the two board scenarios test opposite regimes (see "Why two regimes"). The target was a mean Working share of at least 70% after the first 20% of the ticks, on all 3 seeds. Shares come from `pnpm budget mill works --seeds` (5 runs, and 7 runs for `mill` alone). The machine ran at a load average of 50 to 60, so a single run of `mill` (0.5 to 1 s) could be off by a factor of 3, and a region is judged by the median and by whether it passes in the other runs of the same seed.

| # | Hypothesis | Change | Before | After | Verdict |
|---|---|---|---|---|---|
| 7 | The scenario knobs alone can reach 70%. | Layout moved from kernel constants to scenario fields (`kindPattern`, `lines`). `mill` has the pattern `[0, 1, 2, 3]`, so every machine is on a line. 2 × 2 districts, 400 machines, 100 lines | `yard`: 1.6% at work | with 900 drones per district (3 per leg): 66.0%. 1,500 drones per district: 70.4%. 1,500 drones and no outages: 75.6% (seed 1) | not enough. 70% needs about 3.75 drones per machine, and then the drones dominate the tick. `works` keeps its layout and its goldens in this step |
| 8 | The cycle times cap a fully fed line at 62%: with 40, 60, 80 and 20 ticks, a line runs at its 80 tick assembler, so the extractor is busy 50%, the smelter 75%, the sink 25% | All four kinds have the cycle 40 (a rule change, SPEC-factory §3.1). The layout and the drone count are unchanged | 66.0% at 900 drones per district | 74.6%, 76.8% and 79.1% on the 3 seeds. 60 for all four gave the same within 1 point | kept. The smallest change that moves the ceiling: 3 numbers of the table. The `works` goldens are regenerated |
| 9 | Random legs leave some legs unserved, so the number of drones sets how many lines run | A trial route with the line and leg from the drone id (`id mod 3 * lines`) covers every leg at tick 0, and a shift breaks it, because a new drone gets a random district | 61% at 300 drones per district (3.4 percentage points under the random route at 900, with a third of the drones) | not kept. The routes stay as they were | rejected. A new route rule would also change `works`, and the cycle change of row 8 already clears the target |
| 10 | A busy world makes the naive scan of `work.query` as fast as the set, so `mill` cannot claim it | `work` is split into `work.query` (find the set) and `work.step` (run the cycle of each machine). Naive `work.step` is a `Map` lookup for every field access. `mill` claims `work.step`. `work.query` is claimed by `works` only | `mill` `work.query` ratio near 1x by design | `work.step` 3.5 to 5.6% of the tick, naive 15 to 23%, ratio 3.1 to 5.5x | kept. `works` `work.query` normal share is now 0.01 to 0.02% (finding the set costs nothing), naive 140 to 150%, so its claim still passes |
| 11 | `Working` tag churn needs its own region. | `state` collects the machines whose tag must flip and applies the flips in `work.tag`. The naive way first used a linear search and a splice | naive share 0.9% (under the 2% floor), 7.8x | with a new array for each tag change: 15 to 26% naive share, ratio 100 to 230x | kept. The flip count is 10 a tick on average and 480 in the tick after an outage (`work.flip`). The naive way is the same style as the naive `churn` region |
| 12 | `power.toggle` may fall under the floor in `mill` (4 districts, 3 to 9 outages per run). | none: `power.toggle` is claimed by `works` only | naive share 0.09%, ratio 1.5x | `works` 0.6 to 1.2% normal share, 72 to 285x | `mill` does not claim it. `outage` and `restore` stay in the liveness list for both |

Not changed: `shiftEvery`, `shiftPermille`, `powerEvery`, `outagePermille`, ticks and the `works` layout.

Final result. `mill` has 1,600 machines, 3,600 drones and a peak of about 6,300 entities. Its mean Working share after tick 200 is 74.6%, 76.8% and 79.1% on the 3 seeds. Normal shares in `mill`: `work.step` 3.5 to 5.6%, `work.tag` 0.1 to 0.2%, `state.changed` 5.6 to 6.6%, `drone.move` 15 to 17%, `transform` 2.4 to 3.6%, `churn` 3.2 to 4.3%, `save` 2.2 to 3.3%, `load` 0.4 to 0.7%. The unattributed part is 61 to 67%. In `works` the normal shares are `work.query` 0.01 to 0.02%, `state.changed` 8.8 to 9.0%, `power.toggle` 0.8 to 1.0%, `drone.move` 12 to 14%, `transform` 6.8 to 7.4%, `churn` 3.7 to 5.3%, `save` 8.8 to 9.7%, `load` 1.5 to 1.7%. Every claimed region passes the floor, the cap, the ratio and the same-hash check on all 3 seeds in the last `mill` run (7 runs) and in the `works` run (5 runs). Of 3 runs of `mill`, 2 had a failing cell: `transform` ratio 1.10x on seed 2, and on seed 1 a stalled run (tick total 1.8 s against 0.5 to 0.8 s) that failed 4 ratios. `mill` is short, so the ratio of `transform` (1.6 to 2.6x) and `state.changed` (1.8 to 3.1x) is the closest to the 1.5x line. The whole run of `mill` is under 1 s, so only a quiet machine gives a clean table.

Liveness: every counter that a scenario checks is above 0 for all 3 seeds on `mill` and `works`, and on the smoke scenarios. `work.flip` has a floor of 5 a tick (`mill` 9.6 to 10.9). Working set mean: 1,110 to 1,180 a tick in `mill` (70 to 74% of the machines over the whole run, 75 to 79% after tick 200), 2,100 to 2,150 in `works` (1.4%).
