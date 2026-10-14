# Load profile

This page counts ECS-relevant operations in `impls/baseline-js` per tick. It counts work, not time.
Run `pnpm run profile skirmish battle war` to reproduce. (`pnpm profile` is a built-in pnpm command, so the script needs `run`.)
The hooks are in `impls/baseline-js/src/index.ts` behind an optional `counters` argument. They do not change any hash.

## How to read the tables

- Every number is an operation count for one tick of the real simulation, summed or averaged over the whole scenario.
- "total" is the sum over all ticks. "mean/tick" is total divided by ticks. "max/tick" is the busiest single tick.
- Population rows are gauges. The value for a tick is the highest count seen inside that tick. "mean" and "peak" are over ticks.
- Entities include units, minions, projectiles, ground items and equipped items. Items are counted as entities because the spec gives them a `gameId`.
- Spatial queries are the baseline's `forNear` grid lookups. "Scanned" is the number of candidate units the grid returned before the range test.
- "Stats needed" is the number of live units whose items or haste buff changed, plus new units. The baseline recomputes every unit each tick ("stats full").
- Creates are bursty. Waves spawn every 200 ticks, so max/tick for creates is the wave tick, and the mean hides it.

## Population

### Entities alive

| kind | skirmish mean | skirmish peak | battle mean | battle peak | war mean | war peak |
|---|---:|---:|---:|---:|---:|---:|
| units | 438 | 494 | 4,213 | 4,916 | 17,834 | 24,205 |
| minions | 17.9 | 47.0 | 116 | 255 | 595 | 1,090 |
| projectiles | 36.4 | 80.0 | 472 | 823 | 1,026 | 2,865 |
| ground items | 7.2 | 19.0 | 16.3 | 55.0 | 0.29 | 4.0 |
| equipped items | 747 | 885 | 6,840 | 8,104 | 27,556 | 37,825 |
| total | 1,246 | 1,482 | 11,656 | 13,868 | 47,011 | 64,937 |

## Churn

### Entity creates and destroys by kind

| metric | skirmish total | skirmish mean/tick | skirmish max/tick | battle total | battle mean/tick | battle max/tick | war total | war mean/tick | war max/tick |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| create unit | 957 | 0.48 | 247 | 9,252 | 4.6 | 1,885 | 28,562 | 28.6 | 7,584 |
| create minion | 169 | 0.08 | 13.0 | 1,234 | 0.62 | 75.0 | 3,272 | 3.3 | 302 |
| create projectile | 5,876 | 2.9 | 44.0 | 85,776 | 42.9 | 139 | 114,836 | 115 | 373 |
| create equipped item | 1,433 | 0.72 | 369 | 13,998 | 7.0 | 2,868 | 42,876 | 42.9 | 11,432 |
| destroy unit | 538 | 0.27 | 4.0 | 4,936 | 2.5 | 12.0 | 8,347 | 8.3 | 44.0 |
| destroy minion | 151 | 0.08 | 13.0 | 1,133 | 0.57 | 58.0 | 2,801 | 2.8 | 206 |
| destroy projectile | 5,839 | 2.9 | 25.0 | 85,122 | 42.6 | 161 | 112,650 | 113 | 481 |
| destroy equipped item | 615 | 0.31 | 6.0 | 6,780 | 3.4 | 19.0 | 10,349 | 10.3 | 64.0 |
| destroy ground item | 18.0 | 0.01 | 1.0 | 8.0 | 0.00 | 1.0 | 0.00 | 0.00 | 0.00 |

Ground items are not created. A death turns the first equipped item into a ground item (`item.drop`), and a pickup turns it back (`item.pickup`).

### Item transitions

| metric | skirmish total | skirmish mean/tick | skirmish max/tick | battle total | battle mean/tick | battle max/tick | war total | war mean/tick | war max/tick |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| drop (Equips removed) | 456 | 0.23 | 3.0 | 4,503 | 2.3 | 10.0 | 7,325 | 7.3 | 39.0 |
| pickup (Equips added) | 429 | 0.21 | 3.0 | 4,446 | 2.2 | 9.0 | 7,322 | 7.3 | 37.0 |
| squad leader promotions | 276 | 0.14 | 3.0 | 3,222 | 1.6 | 8.0 | 6,424 | 6.4 | 34.0 |

### Tag/buff changes (archetype changes)

| metric | skirmish total | skirmish mean/tick | skirmish max/tick | battle total | battle mean/tick | battle max/tick | war total | war mean/tick | war max/tick |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| add stun | 391 | 0.20 | 3.0 | 2,776 | 1.4 | 8.0 | 5,134 | 5.1 | 20.0 |
| add burn | 448 | 0.22 | 13.0 | 6,739 | 3.4 | 57.0 | 14,646 | 14.6 | 160 |
| add haste | 589 | 0.29 | 4.0 | 5,127 | 2.6 | 10.0 | 6,891 | 6.9 | 28.0 |
| remove stun | 259 | 0.13 | 3.0 | 1,280 | 0.64 | 6.0 | 1,493 | 1.5 | 8.0 |
| remove burn | 187 | 0.09 | 15.0 | 2,291 | 1.1 | 44.0 | 3,612 | 3.6 | 59.0 |
| remove haste | 458 | 0.23 | 3.0 | 3,378 | 1.7 | 10.0 | 4,319 | 4.3 | 22.0 |
| refresh stun | 55.0 | 0.03 | 1.0 | 670 | 0.34 | 4.0 | 2,425 | 2.4 | 12.0 |
| refresh burn | 1,190 | 0.59 | 19.0 | 30,332 | 15.2 | 85.0 | 96,423 | 96.4 | 658 |
| refresh haste | 239 | 0.12 | 2.0 | 4,982 | 2.5 | 13.0 | 6,359 | 6.4 | 33.0 |

A refresh resets the timer on a buff that is already present. It is a value write, not an archetype change.

## Relations

### Relation changes

| metric | skirmish total | skirmish mean/tick | skirmish max/tick | battle total | battle mean/tick | battle max/tick | war total | war mean/tick | war max/tick |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Targets add | 9,168 | 4.6 | 96.0 | 179,285 | 89.6 | 470 | 524,440 | 524 | 2,060 |
| Targets remove | 8,362 | 4.2 | 64.0 | 170,383 | 85.2 | 466 | 499,961 | 500 | 2,037 |
| Targets retarget | 1,001 | 0.50 | 17.0 | 42,533 | 21.3 | 89.0 | 88,489 | 88.5 | 368 |
| Targets destroyDrop | 600 | 0.30 | 7.0 | 5,490 | 2.7 | 34.0 | 9,582 | 9.6 | 137 |
| MemberOf add | 804 | 0.40 | 207 | 7,773 | 3.9 | 1,585 | 24,006 | 24.0 | 6,384 |
| MemberOf remove | 276 | 0.14 | 3.0 | 3,222 | 1.6 | 8.0 | 6,424 | 6.4 | 34.0 |
| MemberOf retarget | 684 | 0.34 | 10.0 | 8,784 | 4.4 | 28.0 | 19,703 | 19.7 | 99.0 |
| MemberOf destroyDrop | 201 | 0.10 | 2.0 | 1,399 | 0.70 | 7.0 | 1,887 | 1.9 | 13.0 |
| ChildOf add | 169 | 0.08 | 13.0 | 1,234 | 0.62 | 75.0 | 3,272 | 3.3 | 302 |
| ChildOf destroyDrop | 151 | 0.08 | 13.0 | 1,133 | 0.57 | 58.0 | 2,801 | 2.8 | 206 |
| Equips add | 1,862 | 0.93 | 369 | 18,444 | 9.2 | 2,868 | 50,198 | 50.2 | 11,435 |
| Equips remove | 456 | 0.23 | 3.0 | 4,503 | 2.3 | 10.0 | 7,325 | 7.3 | 39.0 |
| Equips destroyDrop | 615 | 0.31 | 6.0 | 6,780 | 3.4 | 19.0 | 10,349 | 10.3 | 64.0 |

`destroyDrop` is a relation that the entity owned and lost when it was destroyed. A relation that points at a destroyed entity counts as `remove`, for example a Targets relation cleared by cleanup.

## Change detection and hierarchy

### Stats recompute

| metric | skirmish total | skirmish mean/tick | skirmish max/tick | battle total | battle mean/tick | battle max/tick | war total | war mean/tick | war max/tick |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| needed (items/haste changed or new) | 2,588 | 1.3 | 247 | 23,297 | 11.6 | 1,885 | 50,118 | 50.1 | 7,599 |
| done by baseline (all units) | 911,054 | 456 | 540 | 8,651,393 | 4,326 | 5,018 | 18,417,390 | 18,417 | 25,032 |

### Hierarchy

| kind | skirmish mean | skirmish peak | battle mean | battle peak | war mean | war peak |
|---|---:|---:|---:|---:|---:|---:|
| max depth (leader or ChildOf chain) | 1.0 | 1.0 | 1.0 | 1.0 | 1.0 | 1.0 |
| max children of one parent | 6.7 | 7.0 | 6.7 | 7.0 | 6.5 | 7.0 |

## Queries

### Spatial queries

| metric | skirmish total | skirmish mean/tick | skirmish max/tick | battle total | battle mean/tick | battle max/tick | war total | war mean/tick | war max/tick |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| grid builds | 6,000 | 3.0 | 3.0 | 6,000 | 3.0 | 3.0 | 3,000 | 3.0 | 3.0 |
| target searches | 412,688 | 206 | 452 | 3,102,492 | 1,551 | 3,379 | 9,412,499 | 9,412 | 15,733 |
| target candidates scanned | 11,142,643 | 5,571 | 11,345 | 447,831,369 | 223,916 | 516,680 | 6,656,756,477 | 6,656,756 | 10,837,695 |
| heal searches | 82,720 | 41.4 | 48.0 | 831,716 | 416 | 573 | 1,550,989 | 1,551 | 2,204 |
| heal candidates scanned | 1,997,363 | 999 | 1,526 | 190,018,862 | 95,009 | 171,687 | 1,071,819,181 | 1,071,819 | 2,654,862 |
| splash queries | 627 | 0.31 | 4.0 | 6,558 | 3.3 | 15.0 | 6,039 | 6.0 | 28.0 |
| splash candidates scanned | 17,683 | 8.8 | 248 | 1,372,114 | 686 | 4,145 | 5,804,494 | 5,804 | 40,597 |
| pickup queries | 14,799 | 7.4 | 20.0 | 36,695 | 18.3 | 58.0 | 7,589 | 7.6 | 41.0 |
| pickup candidates scanned | 319,949 | 160 | 527 | 6,504,332 | 3,252 | 14,137 | 6,896,340 | 6,896 | 48,577 |

### Per-phase query result sizes (rows visited)

| metric | skirmish total | skirmish mean/tick | skirmish max/tick | battle total | battle mean/tick | battle max/tick | war total | war mean/tick | war max/tick |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| spawn: summoners | 22,799 | 11.4 | 21.0 | 170,661 | 85.3 | 165 | 466,541 | 467 | 786 |
| ai/target: units evaluated | 883,196 | 442 | 518 | 8,451,466 | 4,226 | 4,912 | 17,905,810 | 17,906 | 24,463 |
| ai/target: kept current target | 387,788 | 194 | 363 | 4,517,258 | 2,259 | 3,143 | 6,942,322 | 6,942 | 14,633 |
| move: leaders | 119,189 | 59.6 | 106 | 799,032 | 400 | 786 | 2,183,154 | 2,183 | 3,690 |
| move: members | 510,478 | 255 | 413 | 4,245,199 | 2,123 | 3,501 | 10,841,947 | 10,842 | 16,457 |
| move: projectiles | 66,861 | 33.4 | 77.0 | 858,133 | 429 | 763 | 910,949 | 911 | 2,603 |
| combat: projectiles | 66,861 | 33.4 | 77.0 | 858,133 | 429 | 763 | 910,949 | 911 | 2,603 |
| combat: attackers | 11,795 | 5.9 | 62.0 | 136,161 | 68.1 | 178 | 219,117 | 219 | 571 |
| effects: units with a buff | 63,248 | 31.6 | 67.0 | 767,432 | 384 | 677 | 1,448,487 | 1,448 | 3,608 |
| cleanup: dead units | 572 | 0.29 | 5.0 | 5,226 | 2.6 | 12.0 | 8,765 | 8.8 | 44.0 |
| cleanup: ground items | 14,799 | 7.4 | 20.0 | 36,695 | 18.3 | 58.0 | 7,589 | 7.6 | 41.0 |

## Load relative to entity count

Mean operations per tick divided by mean entities alive. Lower means a lighter facet.

| facet | skirmish ops/tick | battle ops/tick | war ops/tick | war ops per 1k entities |
|---|---:|---:|---:|---:|
| Change detection (stats recompute needed) | 1.3 | 11.6 | 50.1 | 1.1 |
| Hierarchy (ChildOf + MemberOf changes) | 1.1 | 11.8 | 58.1 | 1.2 |
| Relations with data (Equips changes) | 1.5 | 14.9 | 67.9 | 1.4 |
| Buff/tag archetype changes (add+remove) | 1.2 | 10.8 | 36.1 | 0.77 |
| Death cascade (unit/minion destroys) | 0.34 | 3.0 | 11.1 | 0.24 |
| Entity churn (creates+destroys, all kinds) | 7.8 | 104 | 324 | 6.9 |
| Targets relation (add+remove+retarget) | 9.3 | 196 | 1,113 | 23.7 |
| Spatial queries issued (heal+target+splash+pickup) | 255 | 1,989 | 10,977 | 234 |
| Per-tick query iteration (ai+move+combat+effects rows) | 855 | 7,990 | 34,201 | 728 |
| Spatial candidates scanned | 6,739 | 322,863 | 7,741,276 | 164,671 |

## Reading the numbers

Peak entities are 1,482 (skirmish), 13,868 (battle) and 64,937 (war), counting equipped items. Without equipped items the peaks are about 640, 6,050 and 28,200. The last figure is the sum of per-kind peaks, so it is a small overestimate.

The load is dominated by large per-tick iteration and spatial search. Structural change is small. In war, one tick moves about 13,000 members and leaders and evaluates about 18,000 units, but only about 36 buff changes, 50 stats-relevant changes and 8 deaths happen.

Targets churn is the largest structural facet. It is about 1,100 relation writes per tick in war.
Entity churn is spiky. A wave tick in war creates 7,584 units and about 11,400 items in one tick. Every other tick creates around 150 entities.

Hierarchy depth is 1 in every scenario. Only squad leaders are summoners, and a promoted member is never one, so a minion never sits under a squad member. By spec the hierarchy cannot go deeper, and the largest fan-out is 7 children.
