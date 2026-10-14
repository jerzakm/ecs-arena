# Game v3: one number, a load budget, seven new facets

This file records the v3 design and the reasons for it. `SPEC.md` holds the exact rules. `v2-game.md` holds the game that v3 builds on.

## The claim

Each library gets one headline number. The number is the geometric mean, over the 3 scenarios, of the library time divided by the `baseline-js` time. Lower is better.

- `skirmish` has about 5k peak entities, `battle` about 20k and `war` about 50k.
- A headline run times whole ticks only. The headline is the total run time. The report shows p99, the max tick and the ticks over 16.6 ms next to it.
- One number is only fair when the game loads each facet by a known amount. The load budget below sets that amount.

## The load budget

Each facet that the game claims to test must use a known share of the tick.

- **Reference.** Shares are measured in `baseline-js` time. Each facet is a named, timed region in `baseline-js`.
- **Floor and cap.** Each facet uses at least 2% and at most 25% of the tick.
- **Naive way.** A flag switches each region to naive code. The naive code must be at least 1.5 times slower than the normal region. If it is not, the game does not reward the library feature, and the facet is not a real test.
- **Where.** The check must pass in every scenario and with each of the K = 3 seeds.

A facet that fails the floor gets more load from a tuned number. A facet that passes the cap gets less. Tuning changes the goldens.

## Facets

Region names are proposals. The unit that adds the regions (U4) can change them and must update this table.

| Facet | Game rule | Phase(s) | Naive way for the 1.5x check | `baseline-js` region |
|---|---|---|---|---|
| Numeric data, large queries | Units move toward a target or a slot | `move` | Find each unit through a `Map` by `gameId` in the loop | `move.step` |
| Create and destroy churn | Projectiles, volleys, minions, items | `combat`, `cleanup`, `spawn` | Rebuild the entity array with a filter after each destroy | `churn` |
| Buffs | Stun, Burn, Haste with `ticksLeft` | `combat`, `effects` | Scan every unit for each buff kind | `effects.buffs` |
| Exclusive link | `Targets`, cleared when the target dies | `ai/target`, `cleanup` | Scan all units for links to each destroyed unit | `cleanup.unlink` |
| Hierarchy, move order | Warband to depth 4, leader moves first | `move` | Walk the chain of each unit to get its depth, then sort | `move.depthOrder` |
| Cascade destroy | Minions die with the summoner | `cleanup` | Scan all minions for each destroyed unit | `cleanup.cascade` |
| Link with data | `Equips` with quality, `MemberOf` offsets | `spawn`, `cleanup`, `stats` | Keep links in one global list and scan it | `links` |
| Sparse set, singleton | Shrines and `Score` | `objectives`, `spawn` | Scan all units for each shrine | `objectives.capture` |
| Bulk tag add | Rout gives `Fleeing` to a squad | `morale` | Scan all units for `MemberOf` each routed leader | `morale.rout` |
| Rules on `Added` | Drop target and threat on flee | `morale` | Compare the full `Fleeing` set with the set of the last tick | `morale.onFlee` |
| Change-driven recompute | Stats on a change of items, buffs, kills, `Veteran`, `bannered` | `stats` | Recompute every unit | `stats.recompute` |
| Many-to-many with data | `Threat` with write, evict, decay | `combat`, `effects` | Keep all edges in one list and scan it for each victim | `threat` |
| Array data | Veteran chronicle | `cleanup` | Copy the full array on each append | `cleanup.credit` |
| A. Fragmentation | Item tags and buff tags, set bonuses | `stats`, `effects`, `cleanup` | Find set bonuses by a scan of the item list of each unit, every tick | `stats.setBonus` |
| B. Dense change | The library reports moved units to the kernel grid | after `spawn`, `move`, `cleanup` | Send every unit again before each search | `grid.update` |
| C. High fan-in | Overwhelmed: 6 or more attackers give more damage | `combat` | For each victim, scan all units for `Targets` to it | `combat.fanIn` |
| D. Ancestor read | Banner: units below a living warlord get armor | `stats` | Walk the full chain of each unit, every tick | `stats.banner` |
| E. Disabled entities | Garrison: units in a held shrine leave move and target queries | `objectives`, `ai/target`, `move` | Keep garrisoned units in every query and test a flag | `garrison` |
| F. Lookup by key | Commander orders by `gameId`, with dead keys | `ai/target` | Scan all entities for each key | `orders.lookup` |
| G. Render extraction | A flat int32 buffer of all units, folded into `renderChain` | `stats` | Build one object for each unit, then copy it into the buffer | `stats.render` |
| Snapshot and restore | Save each 100 ticks, load one save, replay | between ticks | Serialize the world to JSON and parse it back | `save`, `load` |

### Why each new facet has a hash effect

A rule that does not change the hash can be skipped. Each new rule changes it.

- A: set bonuses change `attack`, `armor` and `speed`.
- B: a wrong grid gives wrong targets, splash and captures.
- C: the multiplier changes damage, `lastHitBy`, `Threat` and `damageN`. Flag bit 3 shows the tag.
- D: the banner changes `armor`. Flag bit 4 shows it.
- E: garrison units are in the shrine part of the snapshot and in flag bit 5.
- F: `orders0` and `orders1` count the orders that took effect. A wrong dead-key result changes them.
- G: `renderChain` folds each buffer. A skipped tick changes the last hash.
- Snapshot: the replayed ticks must give the golden hashes again.

## Out of scope

| Idea | Reason |
|---|---|
| Subscribed reads (React, network clients) | They are event driven with many listeners. They do not fit one tick loop. |
| Many worlds and world reset | They need a different scenario shape. One world per run keeps the headline simple. |
| Editor reflection | No game rule needs it. It does not fit one tick loop. |
| Workers | The spec order and start-of-phase values make one thread the fair base. A worker axis is a separate study. |
| Symmetric relations | No game rule needs one that `Threat` or `Targets` does not cover. |
| Prefabs | Spawn already gives each unit kind fixed stats. A prefab adds API surface, not a new load. |

The README lists these items.

## Known biases

- **`baseline-js` under-prices structural change.** Its tags are plain fields, so a tag change costs little. Facet shares in `baseline-js` time make fragmentation look cheap. Archetype libraries pay more than the budget shows.
- **Start-of-phase copy.** The start-of-phase rule makes libraries that write in place keep a copy. The deep-dive report shows the copy cost as its own line.
- **Shared grid.** The kernel grid costs the same for every library. This pulls the ratios toward 1. Only the moved-unit report (facet B) is library work.

## Open points for tuning

- `targetPop` and the wave numbers must give about 5k, 20k and 50k peak entities. `pnpm run profile` measures them.
- Each facet must pass the 2% floor and the 25% cap in every scenario and seed. Fragmentation is the most likely to fail the floor, because v2 has about 1 tag change for each 1k entities in a tick.
- Overwhelmed threshold (6) and multiplier (1280, so × 1.25).
- Banner armor (2) and the set bonus table.
- `garrisonCap` and `ordersPerTeam` for each scenario, and the order period (10 ticks).
- Save interval (100) and `loadTick`.
- The naive way of each region must be at least 1.5 times slower. `stats.recompute` in v2 already recomputes every unit, so its normal code must change to tracked recompute first.
