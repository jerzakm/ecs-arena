# Load profile

This page counts ECS-relevant operations in `impls/baseline-js` per tick for the v2 game. It counts work, not time.
Run `pnpm run profile skirmish battle war` to reproduce. (`pnpm profile` is a built-in pnpm command, so the script needs `run`.)
The hooks are in `impls/baseline-js/src/`, in the systems and in `profiling.ts`, behind an optional `counters` argument that `index.ts` passes to the context. They do not change any hash.

## How to read the tables

- Every number is an operation count for one tick of the real simulation, summed or averaged over the whole scenario.
- "total" is the sum over all ticks. "mean/tick" is total divided by ticks. "max/tick" is the busiest single tick.
- Population rows are gauges. The value for a tick is the highest count seen inside that tick. "mean" and "peak" are over ticks.
- Entities include units, warlords, minions, projectiles, ground items, equipped items and shrines. Items are counted as entities because the spec gives them a `gameId`.
- Spatial queries are the baseline's `forNear` grid lookups. "Scanned" is the number of candidate units the grid returned before the range test.
- "Stats needed" is the number of live units whose items, buffs, kill count or Veteran tag changed, plus new units. The baseline used to recompute every unit each tick ("stats full"). It now recomputes only the needed ones, and the full recompute is the naive variant of `stats.recompute`.
- Creates are bursty. Waves spawn every 200 ticks and surges every 120, so max/tick for creates is a spawn tick, and the mean hides it.
- Smoke runs (400 ticks) cover the first contact, the first shrine capture and the first surge, but not the first rout.

## Population

### Entities alive

| kind | skirmish mean | skirmish peak | battle mean | battle peak | war mean | war peak |
|---|---:|---:|---:|---:|---:|---:|
| units (no warlord, no minion) | 293 | 347 | 2,723 | 3,564 | 13,401 | 17,846 |
| warlords | 12.6 | 16.0 | 85.9 | 121 | 397 | 633 |
| minions | 63.7 | 97.0 | 298 | 511 | 1,337 | 2,538 |
| projectiles | 29.7 | 117 | 514 | 1,022 | 1,943 | 4,196 |
| ground items | 2.45 | 8 | 2.69 | 11.0 | 0.19 | 2 |
| equipped items | 476 | 555 | 4,481 | 5,704 | 21,127 | 28,008 |
| shrines | 7 | 7 | 7 | 7 | 7 | 7 |
| total | 884 | 1,133 | 8,112 | 10,698 | 38,211 | 51,768 |

## Churn

### Entity creates and destroys by kind

| metric | skirmish total | skirmish mean/tick | skirmish max/tick | battle total | battle mean/tick | battle max/tick | war total | war mean/tick | war max/tick |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| create unit | 476 | 0.24 | 183 | 6,401 | 3.20 | 1,251 | 21,341 | 21.3 | 5,256 |
| create warlord | 24.0 | 0.01 | 8 | 262 | 0.13 | 50.0 | 855 | 0.85 | 210 |
| create minion | 490 | 0.24 | 27.0 | 2,986 | 1.49 | 162 | 7,135 | 7.13 | 747 |
| create projectile | 3,944 | 1.97 | 24.0 | 72,993 | 36.5 | 120 | 171,278 | 171 | 465 |
| create equipped item | 745 | 0.37 | 281 | 10,046 | 5.02 | 1,981 | 33,341 | 33.3 | 8,238 |
| destroy unit | 203 | 0.10 | 4 | 3,891 | 1.95 | 13.0 | 5,397 | 5.40 | 28.0 |
| destroy warlord | 12.0 | 0.01 | 1 | 182 | 0.09 | 2 | 560 | 0.56 | 6 |
| destroy minion | 423 | 0.21 | 24.0 | 2,696 | 1.35 | 86.0 | 5,440 | 5.44 | 399 |
| destroy projectile | 3,936 | 1.97 | 39.0 | 72,547 | 36.3 | 288 | 168,510 | 169 | 732 |
| destroy equipped item | 286 | 0.14 | 7 | 5,662 | 2.83 | 25.0 | 7,734 | 7.73 | 60.0 |
| destroy ground item | 11.0 | 0.01 | 1 | 3 | 0.00 | 1 | 0 | 0 | 0 |
| unit leaves at home edge | 117 | 0.06 | 3 | 2,380 | 1.19 | 10.0 | 3,089 | 3.09 | 23.0 |
| surge: units created | 57.0 | 0.03 | 21.0 | 2,458 | 1.23 | 546 | 8,047 | 8.05 | 3,235 |

Shrines are created once, on tick 0 (7 entities), and never destroyed. A leaving unit is counted in `destroy unit` and in `unit leaves at home edge`.
Ground items are not created. A death turns the first equipped item into a ground item (`item.drop`), and a pickup turns it back (`item.pickup`).

### Item transitions and promotions

| metric | skirmish total | skirmish mean/tick | skirmish max/tick | battle total | battle mean/tick | battle max/tick | war total | war mean/tick | war max/tick |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| drop (Equips removed) | 81.0 | 0.04 | 2 | 1,508 | 0.75 | 5 | 2,578 | 2.58 | 12.0 |
| pickup (Equips added) | 70.0 | 0.04 | 2 | 1,496 | 0.75 | 5 | 2,578 | 2.58 | 13.0 |
| promotions (a head takes over a squad or warband) | 70.0 | 0.04 | 2 | 1,675 | 0.84 | 7 | 3,248 | 3.25 | 15.0 |

### Tag and buff changes (archetype changes)

| metric | skirmish total | skirmish mean/tick | skirmish max/tick | battle total | battle mean/tick | battle max/tick | war total | war mean/tick | war max/tick |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| add stun | 65.0 | 0.03 | 3 | 1,365 | 0.68 | 6 | 2,561 | 2.56 | 12.0 |
| add burn | 114 | 0.06 | 5 | 3,211 | 1.61 | 33.0 | 9,562 | 9.56 | 93.0 |
| add haste | 178 | 0.09 | 2 | 3,185 | 1.59 | 9 | 5,185 | 5.18 | 19.0 |
| remove stun | 48.0 | 0.02 | 1 | 810 | 0.41 | 5 | 1,280 | 1.28 | 7 |
| remove burn | 54.0 | 0.03 | 4 | 1,652 | 0.83 | 32.0 | 4,390 | 4.39 | 68.0 |
| remove haste | 152 | 0.08 | 2 | 2,602 | 1.30 | 8 | 3,972 | 3.97 | 17.0 |
| refresh stun | 5 | 0.00 | 1 | 144 | 0.07 | 2 | 552 | 0.55 | 4 |
| refresh burn | 127 | 0.06 | 4 | 4,047 | 2.02 | 35.0 | 15,704 | 15.7 | 101 |
| refresh haste | 18.0 | 0.01 | 1 | 1,677 | 0.84 | 6 | 4,909 | 4.91 | 21.0 |
| add Routed | 33.0 | 0.02 | 3 | 667 | 0.33 | 6 | 1,664 | 1.66 | 13.0 |
| add Fleeing | 130 | 0.07 | 16.0 | 2,796 | 1.40 | 28.0 | 8,262 | 8.26 | 63.0 |
| add Veteran | 18.0 | 0.01 | 1 | 225 | 0.11 | 3 | 315 | 0.32 | 4 |
| shrine captured or lost | 6 | 0.00 | 1 | 14.0 | 0.01 | 1 | 8 | 0.01 | 2 |

A refresh resets the timer on a buff that is already present. It is a value write, not an archetype change. Routed and Fleeing are added in bulk: one rout tags a whole squad in one tick.

## Relations

### Relation changes

| metric | skirmish total | skirmish mean/tick | skirmish max/tick | battle total | battle mean/tick | battle max/tick | war total | war mean/tick | war max/tick |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Targets add | 2,278 | 1.14 | 23.0 | 86,561 | 43.3 | 138 | 285,512 | 286 | 909 |
| Targets remove | 2,047 | 1.02 | 43.0 | 82,304 | 41.2 | 354 | 272,595 | 273 | 1,287 |
| Targets retarget | 280 | 0.14 | 4 | 6,522 | 3.26 | 61.0 | 14,861 | 14.9 | 122 |
| Targets destroyDrop | 189 | 0.09 | 8 | 3,356 | 1.68 | 61.0 | 6,625 | 6.62 | 284 |
| MemberOf add | 476 | 0.24 | 183 | 6,401 | 3.20 | 1,251 | 21,341 | 21.3 | 5,256 |
| MemberOf remove | 92.0 | 0.05 | 3 | 2,069 | 1.03 | 8 | 4,227 | 4.23 | 22.0 |
| MemberOf retarget | 167 | 0.08 | 5 | 4,075 | 2.04 | 21.0 | 10,451 | 10.5 | 60.0 |
| MemberOf destroyDrop | 136 | 0.07 | 3 | 2,446 | 1.22 | 10.0 | 3,235 | 3.23 | 20.0 |
| ChildOf add | 490 | 0.24 | 27.0 | 2,986 | 1.49 | 162 | 7,135 | 7.13 | 747 |
| ChildOf destroyDrop | 423 | 0.21 | 24.0 | 2,696 | 1.35 | 86.0 | 5,440 | 5.44 | 399 |
| Equips add | 815 | 0.41 | 281 | 11,542 | 5.77 | 1,981 | 35,919 | 35.9 | 8,238 |
| Equips remove | 81.0 | 0.04 | 2 | 1,508 | 0.75 | 5 | 2,578 | 2.58 | 12.0 |
| Equips destroyDrop | 286 | 0.14 | 7 | 5,662 | 2.83 | 25.0 | 7,734 | 7.73 | 60.0 |
| Threat add (new edge) | 2,087 | 1.04 | 9 | 52,638 | 26.3 | 85.0 | 134,756 | 135 | 384 |
| Threat accumulate (existing edge) | 2,422 | 1.21 | 10.0 | 21,468 | 10.7 | 33.0 | 18,983 | 19.0 | 55.0 |
| Threat evict (over 4 edges) | 1,072 | 0.54 | 8 | 34,760 | 17.4 | 51.0 | 100,779 | 101 | 285 |
| Threat decay (edge writes) | 3,105 | 1.55 | 88.0 | 38,044 | 19.0 | 716 | 64,230 | 64.2 | 2,886 |
| Threat decayRemove | 342 | 0.17 | 13.0 | 3,958 | 1.98 | 81.0 | 6,236 | 6.24 | 288 |
| Threat dropOnFlee | 77.0 | 0.04 | 7 | 2,416 | 1.21 | 30.0 | 5,278 | 5.28 | 43.0 |
| Threat remove (attacker destroyed) | 166 | 0.08 | 5 | 2,667 | 1.33 | 43.0 | 3,700 | 3.70 | 53.0 |
| Threat destroyDrop (victim destroyed) | 415 | 0.21 | 8 | 8,522 | 4.26 | 28.0 | 17,226 | 17.2 | 97.0 |

`destroyDrop` is a relation that the entity owned and lost when it was destroyed. A relation that points at a destroyed entity counts as `remove`, for example a Targets relation cleared by cleanup.

## Change detection and hierarchy

### Stats recompute

| metric | skirmish total | skirmish mean/tick | skirmish max/tick | battle total | battle mean/tick | battle max/tick | war total | war mean/tick | war max/tick |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| needed (items, buffs, kills, Veteran changed, or new) | 1,787 | 0.89 | 191 | 25,932 | 13.0 | 1,301 | 62,094 | 62.1 | 5,466 |
| done by baseline (all units) | 737,033 | 369 | 452 | 6,206,867 | 3,103 | 4,121 | 15,123,043 | 15,123 | 20,829 |

### Hierarchy

| kind | skirmish mean | skirmish peak | battle mean | battle peak | war mean | war peak |
|---|---:|---:|---:|---:|---:|---:|
| max depth (MemberOf or ChildOf chain) | 2.94 | 3 | 2.94 | 3 | 2.88 | 3 |
| max children of one parent | 7.57 | 9 | 8.61 | 10.0 | 8.66 | 10.0 |

## Queries

### Spatial queries

| metric | skirmish total | skirmish mean/tick | skirmish max/tick | battle total | battle mean/tick | battle max/tick | war total | war mean/tick | war max/tick |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| grid builds | 7,389 | 3.69 | 4 | 7,476 | 3.74 | 4 | 3,648 | 3.65 | 4 |
| target searches (think ticks only) | 118,512 | 59.3 | 91.0 | 708,286 | 354 | 642 | 1,920,185 | 1,920 | 3,297 |
| target candidates scanned | 4,607,078 | 2,304 | 4,732 | 110,589,732 | 55,295 | 110,329 | 1,103,283,054 | 1,103,283 | 2,172,686 |
| heal searches | 11,833 | 5.92 | 12.0 | 71,997 | 36.0 | 61.0 | 169,361 | 169 | 307 |
| heal candidates scanned | 414,572 | 207 | 776 | 9,003,056 | 4,502 | 10,191 | 72,670,421 | 72,670 | 137,411 |
| splash queries | 154 | 0.08 | 3 | 2,729 | 1.36 | 7 | 4,523 | 4.52 | 19.0 |
| splash candidates scanned | 5,126 | 2.56 | 115 | 356,765 | 178 | 1,681 | 2,717,902 | 2,718 | 15,549 |
| pickup queries | 4,940 | 2.47 | 9 | 6,776 | 3.39 | 13.0 | 2,752 | 2.75 | 13.0 |
| pickup candidates scanned | 52,282 | 26.1 | 264 | 522,574 | 261 | 1,335 | 1,571,419 | 1,571 | 9,067 |
| shrine queries (7 for each tick) | 14,000 | 7 | 7 | 14,000 | 7 | 7 | 7,000 | 7 | 7 |
| shrine candidates scanned | 97,622 | 48.8 | 192 | 1,596,116 | 798 | 2,139 | 5,383,455 | 5,383 | 11,193 |

### Per-phase query result sizes (rows visited)

| metric | skirmish total | skirmish mean/tick | skirmish max/tick | battle total | battle mean/tick | battle max/tick | war total | war mean/tick | war max/tick |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| spawn: summoners | 62,063 | 31.0 | 38.0 | 395,314 | 198 | 251 | 953,984 | 954 | 1,325 |
| ai/target: units evaluated | 736,631 | 368 | 452 | 6,195,032 | 3,098 | 4,113 | 15,099,555 | 15,100 | 20,779 |
| ai/target: kept current target | 101,987 | 51.0 | 128 | 1,965,264 | 983 | 1,699 | 4,351,710 | 4,352 | 9,400 |
| ai/target: retaliation chosen | 9,042 | 4.52 | 18.0 | 66,401 | 33.2 | 67.0 | 68,887 | 68.9 | 178 |
| ai/target: no search, not a think tick | 352,586 | 176 | 243 | 2,009,882 | 1,005 | 1,864 | 5,377,067 | 5,377 | 9,334 |
| move: units that step | 667,216 | 334 | 412 | 4,936,398 | 2,468 | 3,333 | 12,270,517 | 12,271 | 17,675 |
| move: projectiles | 55,377 | 27.7 | 114 | 954,976 | 477 | 942 | 1,771,734 | 1,772 | 3,887 |
| combat: projectiles | 55,377 | 27.7 | 114 | 954,976 | 477 | 942 | 1,771,734 | 1,772 | 3,887 |
| combat: attackers | 3,174 | 1.59 | 12.0 | 60,721 | 30.4 | 68.0 | 135,943 | 136 | 336 |
| effects: units with a buff | 15,178 | 7.59 | 21.0 | 317,587 | 159 | 313 | 697,310 | 697 | 1,656 |
| cleanup: dead or leaving units | 268 | 0.13 | 4 | 5,080 | 2.54 | 16.0 | 8,228 | 8.23 | 47.0 |
| cleanup: ground items | 4,940 | 2.47 | 9 | 6,776 | 3.39 | 13.0 | 2,752 | 2.75 | 13.0 |

## Load relative to entity count

Mean operations per tick divided by mean entities alive. Lower means a lighter facet.

| facet | skirmish ops/tick | battle ops/tick | war ops/tick | war ops per 1k entities |
|---|---:|---:|---:|---:|
| Change detection (stats recompute needed) | 0.89 | 13.0 | 62.1 | 1.63 |
| Hierarchy (ChildOf + MemberOf changes) | 0.89 | 10.3 | 51.8 | 1.36 |
| Relations with data (Equips + Threat changes) | 5.43 | 91.6 | 397 | 10.40 |
| Buff and tag archetype changes (add+remove) | 0.40 | 8.26 | 37.2 | 0.97 |
| Death cascade (unit, warlord, minion destroys) | 0.32 | 3.38 | 11.4 | 0.30 |
| Entity churn (creates+destroys, all kinds) | 5.28 | 88.8 | 422 | 11.03 |
| Targets relation (add+remove+retarget) | 2.30 | 87.7 | 573 | 14.99 |
| Spatial queries issued (target+heal+splash+pickup+shrine) | 74.7 | 402 | 2,104 | 55.06 |
| Per-tick query iteration (ai+move+combat+effects rows) | 766 | 6,710 | 31,747 | 830.82 |
| Spatial candidates scanned | 2,588 | 61,034 | 1,185,626 | 31028.02 |

## Spatial work: v1 against v2

The v1 numbers come from the profile of the v1 game that this page held before. Both columns are the mean number of spatial candidates scanned per tick, summed over all query kinds (v2 adds the shrine query).

| scenario | v1 candidates scanned per tick | v2 candidates scanned per tick | v2 as share of v1 | v1 queries issued per tick | v2 queries issued per tick |
|---|---:|---:|---:|---:|---:|
| skirmish | 6,739 | 2,588 | 38% | 255 | 75 |
| battle | 322,863 | 61,034 | 19% | 1,989 | 402 |
| war | 7,741,276 | 1,185,626 | 15% | 10,977 | 2,104 |

The drop is inferred to come from the think interval, which allows one target search in four ticks for a unit with no valid target, and from retaliation, which needs no search. The table does not isolate the two.

## Reading the numbers

Peak entities are 1,133 (skirmish), 10,698 (battle) and 51,768 (war), counting equipped items and shrines. The targets are about 1k, 10k and 50k.

The load is still dominated by per-tick iteration and spatial search. Structural change is larger than in v1. A rout adds `Routed` and `Fleeing` to a whole squad in one tick and later destroys the fleeing units in bulk at the home edge. Surges create thousands of units on one tick.

`Threat` is the busiest new relation. A victim holds at most 4 edges, so the eviction count shows how often a unit has more than 4 attackers in a tick. Decay touches every edge once in 20 ticks.

Hierarchy depth reaches 3 in every scenario: warlord, squad leader, member and the minion of a Host summoner member. A promotion after a warlord dies can hang a squad leader under another squad leader, which keeps the depth at 3 or less in these runs.

