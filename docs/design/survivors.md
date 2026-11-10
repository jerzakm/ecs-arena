# Game 2: `survivors`, a small-world horde survivor

This document is the design of the second game and the reasons for it. `packages/spec/SPEC-survivors.md` holds the exact rules. The code that the design describes is in `packages/spec/src/survivors/` (rule tables, `SYSTEMS`, `FACETS`, scenarios) and `packages/spec/src/games.ts` (the `RTS` and `SURVIVORS` game values).

## Problem

The RTS loads each library with 5k to 50k entities, so it measures throughput. The owner wants a second game that measures the other end. The world has 1k to 3k live entities, many small systems, heavy churn and frequent tag changes. The game prices the fixed cost of a query and a system call, archetype moves, fragmentation, events and change detection.

Library authors also want two more things. They want to see the trade-off between sparse-set, archetype and hybrid storage. They also want guards against a library that overfits to the benchmark. One author saw an AI tune his library into a hybrid that was worse at both sparse and archetype strengths.

The design keeps these constraints:

- `PHASES` is a fixed tuple of 9 names. `Sim.phases` is `Record<PhaseName, ...>`. `TIMED_PHASES` sets the CSV columns.
- `SCENARIOS`, `BOARD_SCENARIOS`, `verify-all`, `budget.REGIONS`, and `liveness.LIVENESS` are RTS lists with no game id.
- The goldens live flat in `goldens/`. The RTS goldens must not change.
- `budget.ts` and `profile.ts` import baseline-js by path. baseline-js is the only instrumented impl.
- baseline-js writes a tag as a bit in an int. The budget cannot see archetype moves. This is the main measurement risk.

## Usage (caller's view)

The CLI does not change. The scenario name selects the game.

```
pnpm verify koota grove-smoke swarm   # game = survivors, entry impls/koota/src/survivors/index.ts
pnpm verify:all                       # every (impl, game) pair; a missing entry file shows as skip
pnpm bench baseline-js koota grove swarm
                                      # one headline per game
pnpm budget grove                     # regions and liveness rows of survivors
pnpm profile thicket                  # liveness rows and minMean floors
pnpm bench koota sweep                # the 9 sweep cells, off the board
```

The runner code changes in one place:

```ts
const { game, scenario } = findScenario(name)                  // packages/spec/src/games.ts
const createSim = (await import(implEntry(impl, game))).default
const trace = runTrace(createSim, scenario, game)              // runPhases(game, sim) inside
compare(trace, readJson(`goldens/${goldenFile(name, i)}`))     // flat dir, as today
```

An impl exports a default `createSim`. Koota is the template for the other libraries:

```ts
// impls/koota/src/survivors/index.ts
const createSim: CreateSim<SurvivorsScenario, SurvivorsKernel, SvPhase> = (sc, k) => {
  const ctx = createContext(sc, k)
  return {
    phases: {
      spawn: group(ctx, spawnWave, spawnElite),                 // each phase runs its systems in SYSTEMS order
      weapons: group(ctx, weaponFire, weaponOrbit, weaponPulse),
      /* player, ai, move, combat, status, resolve, cleanup, progress, stats */
    },
    snapshot: () => snapshot(ctx), save: () => save(ctx), load: (s) => load(ctx, s as Saved),
  }
}
// one small system with one small query
export const statusExpire = (ctx: Ctx) => () => {
  for (const T of TIMED_TAGS) ctx.world.query(T).updateEach(([t], e) => { if (t.until <= ctx.tick) e.remove(T) })
}
```

> Note: the shipped entry builds `phases` with `survivors.wirePhases(table, ctx)` from one `SystemTable`, not with `group` calls. See `impls/koota/src/survivors/index.ts`.

The phase map and the order of the systems come from the spec. The system bodies are idiomatic for each library. All rules come from the survivors kernel.

## Shape

Three decisions carry the design.

1. **A small `Game` value, found by scenario name.** `Game` holds `phases`, `timedPhases`, `startHook`, `kernel`, `scenarios`, `board` and `entry`. `findScenario(name)` replaces the `SCENARIOS[name]` lookups in the runner. A module-load assertion makes sure that no scenario name is in two games. Thus `goldens/` stays flat. `Sim<P>` and `CreateSim` take a phase-name parameter with the RTS phases as the default. No RTS file moves and no RTS hash input changes. (per boundary-discipline)
2. **Systems and facets are data, and the rest comes from them.** `SYSTEMS` (36 rows) and `FACETS` (22 rows) are the single source. The phases, the budget `REGIONS`, the `LIVENESS` rows and the facet table below come from them. `SystemTable<Ctx>` is a `Record` over the system ids, so a missing system in baseline-js is a type error. (per encode-lessons-in-structure)
3. **Determinism by the RTS house style.** SPEC.md §5.6 fixes the create order by gameId. Survivors uses the same rule. Each system that creates entities handles its sources in ascending gameId order. Each new entity takes the next `nextId` at once. The `creates` field of each such system states the order and whether later systems of the same phase see the new entities. Damage goes into `dmgIn`, which is a sum. A tag re-apply keeps the larger `until` (`mergeUntil`). Thus the order of hits does not change the hash.

### Entities

| Entity | Components | Notes |
|---|---|---|
| Player (1) | Player, Hp, Stats, tags | gameId 1. Walks `playerPos(tick)`, a fixed loop. Immortal: hp has a floor of 1 |
| Weapon (up to 6) | Weapon, Cooldown, WeaponStats, optional Orbit or Aura | `WeaponStats` comes from `deriveLoadout` on each pick |
| Mob (up to `mobCap`) | Mob, Vel, Hp, a move-kind tag, `HAS` components, tags, Affix | 12 kinds. Elites carry 1 to 3 of 6 affixes |
| Projectile (about 500) | Proj, Vel, Ttl, one optional component per trait bit (12), Hostile | mines are projectiles with speed 0 |
| Pickup (about 150) | Pickup, Ttl, Attracted tag | xp gem, heart, chest |
| Particle (about 400) | Particle, Vel, Ttl | in the snapshot, so an impl that skips them fails the hash |

## Game rules

**World.** The arena and the grid are the RTS ones (256 tiles, `SpatialGrid` as it is). Mobs spawn on a ring around the player, so the density stays local. The grid needs no change.

**Player.** The player walks a closed loop with no input and no randomness. The player is immortal. Hp has a floor of 1, and `dmgTaken` in the snapshot counts all damage. Contact damage and hostile shots still apply. A hit adds `IFRAMES` for 30 ticks, so the tag has a rule.

**Mob kinds (12).** Bat and Zombie chase. Weaver weaves on a sine table. Charger runs a state machine of three tags: Windup 20, Dash 12, Recover 30. Shooter kites at 10 tiles and fires every 45 ticks. Splitter makes 2 Swarmlings on death. Exploder starts a Fuse of 20 ticks near the player, then explodes. Healer heals 2 mobs every 15 ticks. Summoner makes up to 6 Swarmlings, and they die with it. Ghost is Phased for 30 of every 90 ticks. A Boss comes every 1200 ticks with 900 hp. It swaps phase components at 66% and 33% hp.

**State tags (17).** `STUNNED SLOWED BURNING FROZEN KNOCKBACK IFRAMES MARKED ENRAGED SHIELDED PHASED SPAWNING WINDUP DASH RECOVER FUSE ELITE DYING`. 15 tags are timed. `ELITE` and `DYING` are plain. The masks `BLOCKS_MOVE`, `BLOCKS_ACT` and `IMMUNE_HIT` are the single statement of which tag stops what. `hitOutcome` holds the interactions:

- Frozen: a hit does double damage ("shatter") and clears Frozen.
- Marked: the next hit is a crit and clears Marked.
- Burning: 1 damage per stack every 6 ticks, up to 5 stacks.
- Phased, Spawning, IFrames and Dying: a hit deals 0.
- Shielded: the shield value absorbs damage first.
- Enraged (Frenzied elite below 50% hp): speed is 1.5x.

A typical tick applies about 60 tag adds and 60 removes. The `minMean` floor of the `status` and `statusAdd` rows makes this a tested number.

**Upgrades (26).** There are 8 weapons, 12 passives and 6 evolutions. Xp gives a level-up. `pickUpgrade` draws 3 offers with the counter RNG and takes the best by a priority table. A chest forces an evolution when one is eligible. Each class of upgrade adds load in a different way:

- A weapon adds entities, wakes a gated system and adds projectile archetypes.
- A passive with a stat changes `WeaponStats` once per pick.
- A passive with a trait adds a trait bit to every weapon. 20 to 40 projectile archetypes are alive at once.
- An evolution replaces a weapon. Its orbiters die, new ones spawn, and live projectiles of that weapon get new components.

At tick 0, 13 of the 36 systems have an empty query. By the end of a full run, all of them run.

**Events (5).** `HIT, KILL, STATUS, PICKUP, LEVELUP`, one list for each type, cleared at the start of the tick. Each consumer gives the same result in any order, or sorts by subject gameId. The counters `evt0` to `evt4` are in the snapshot, so a lost event changes the hash.

### Systems in tick order (11 phases, 36 systems)

| Phase | Systems |
|---|---|
| `spawn` | `spawn.wave`, `spawn.elite` |
| `player` | `player.path` |
| `weapons` | `weapon.fire`, `weapon.orbit`, `weapon.pulse` |
| `ai` | `ai.chase`, `ai.weave`, `ai.charge`, `ai.kite`, `ai.shoot`, `ai.summon`, `ai.heal`, `ai.fuse` |
| `move` | `move.mobs`, `move.proj`, `move.particles`, `grid.update` |
| `combat` | `combat.hit`, `combat.hostile`, `combat.contact`, `combat.explode` |
| `status` | `status.apply`, `status.tick`, `status.expire` |
| `resolve` | `resolve.damage`, `resolve.changed` |
| `cleanup` | `cleanup.ttl`, `cleanup.death`, `cleanup.drops`, `cleanup.cascade` |
| `progress` | `pickup.magnet`, `pickup.collect`, `progress.pick`, `progress.apply` |
| `stats` | `stats.render` |

`SYSTEMS` holds the exact order, the `does` text, the gate and the create order. A phase is a group of systems, so the contract has 11 phase keys. The fixed cost of each system shows in the totals and in the `query.match` region.

**Create order.** These systems create entities. Each handles its sources in ascending gameId order:

| System | Order | Visible to later systems of the same phase |
|---|---|---|
| `spawn.wave` | kind order of `spawnPlan`, then ring index | yes |
| `spawn.elite` | elite, then boss, then ring index | yes |
| `weapon.fire` | weapons by upgrade id, then shot index | no |
| `ai.shoot` | shooters in gameId order | no |
| `ai.summon` | summoners in gameId order, then slot | no |
| `combat.hit` | split children: projectiles in gameId order, then child index | no |
| `resolve.changed` | changed mobs in gameId order (spark particles) | no |
| `cleanup.drops` | dead mobs in gameId order, then drop, split and particle index | no |
| `progress.apply` | new weapon entity, then orbiter slots | no |

"No" means that the systems of the same phase skip the new entities. They join the queries in the next phase.

### Scenarios

One rule set at three sizes, sized by live entities. The seeds and K=3 are the RTS ones. All scenarios have `loadEvery 200`.

| Scenario | Mob cap | Peak entities | Ticks | Smoke |
|---|---|---|---|---|
| `grove` | 450 | about 1.1k | 3000 | `grove-smoke`, 600 ticks |
| `thicket` | 1000 | about 2.0k | 3000 | `thicket-smoke` |
| `swarm` | 1700 | about 3.0k | 2400 | `swarm-smoke` |

Two knobs sit next to `mobCap`. Both are permille, and the board scenarios use 1000:

- `tagScale` scales the tag adds and removes per mob per tick. Status durations and proc rates scale by it.
- `traitScale` scales the trait bits per projectile, so it sets the count of live projectile archetypes.

The board uses `grove` and `swarm`, the smallest and the largest. `thicket` is for local use. The tick counts are first guesses. A measured run sets the final values. The smoke variants use a faster pace and less xp per level, so late kinds and evolutions appear.

### Crossover sweep

The sweep shows where a library crosses over between sparse and archetype storage. It is 9 extra scenarios, a grid of 3 mob caps and 3 tag rates. The cells are config only. They use the `thicket` rules with 1200 ticks, and an impl needs no new code.

| | `tagScale` 250 | `tagScale` 1000 | `tagScale` 4000 |
|---|---|---|---|
| `mobCap` 300 | `sweep-m300-t250` | `sweep-m300-t1000` | `sweep-m300-t4000` |
| `mobCap` 900 | `sweep-m900-t250` | `sweep-m900-t1000` | `sweep-m900-t4000` |
| `mobCap` 1700 | `sweep-m1700-t250` | `sweep-m1700-t1000` | `sweep-m1700-t4000` |

The output is one plot per library: the ratio `target total / baseline-js total` in each cell. The axes are the real churn, not the knob values. `profile` gives the measured mean of `tag.add`, `tag.remove` and `ttl.expire` per tick for each cell, from the existing `minMean` counters. A sparse-set library gets better toward high tag rates. An archetype library gets better toward many mobs and few tags. A hybrid shows where it sits between the two.

The sweep is not on the board and has no headline number. It does not enter `scoreByGame`.

**Goldens.** Each cell has one golden, for the timing seed only. baseline-js writes the 9 files with `--write`. The bench child checks the final hash against this golden on every run, as for the board scenarios. `verify:all` does not run the sweep, because the cells are not in `SMOKE`. A hash mismatch in a sweep cell removes that cell from the plot.

**Wall time.** A cell takes about 0.4 to 1.8 s per run at 0.3 to 1.5 ms per tick. With 3 fixed runs and the warmup, the sweep takes about 1 min per impl. Four impls take about 4 min. These values are estimates until a measured run.

### Snapshot and save

The snapshot is a flat int32 array: world scalars, then sections for the player, mobs, projectiles, pickups and particles. Records are in gameId order. Each mob has a list of `(statusId, until, stacks)`. Links are gameIds, with -1 for none. `SNAPSHOT` in the kernel holds the layout. `save` copies all entity sections, the held list, `nextId`, the timers and the world counters. `load` resets change detection and sends every entity to the grid again.

The expiry wheel is the normal way in baseline-js for `status.expire` and `cleanup.ttl`. The ECS impls can use any structure that gives the same hash.

## Facet table

The format is the format of `v3-game.md`, with three more columns. `Region` is the baseline-js region name. `Favors` is the storage model that the facet is expected to reward, with the reason. The rows come from `FACETS`, and `favors` and `why` there are the source.

| Facet | Game rule | System(s) | Naive way for the 1.5x check | Region | Hash effect | New or RTS | Favors |
|---|---|---|---|---|---|---|---|
| Gated and partitioned queries | 13 systems wait for a kind or an upgrade. 4 move kinds each have one system | gated systems, `ai.*` | Each system finds its entities by a scan of all entities and a flag test (normal code keeps a set for each system and returns early when it is empty) | `query.match` | Each gated system changes positions, hp or entity count when its set fills. Row `sys.<id>` for each gated system | NEW | archetype: a cached archetype list makes an empty query one length test |
| Negated queries | A mob moves or acts only if it has no tag in `BLOCKS_MOVE` or `BLOCKS_ACT` | `move.mobs`, `ai.*`, `combat.contact` | Test each blocking tag through its own set, one lookup per tag per mob (normal code reads one `mask` int) | `move.gate` | A frozen mob that moves changes x and y | NEW | archetype: a negated term drops whole archetypes, a sparse set tests each mob |
| Tag churn | 17 tags apply and expire, about 60 adds and 60 removes per tick | `status.apply`, `status.expire` | Test every mob for each timed tag every tick (normal code pops the expiry wheel bucket) | `status.expire` | Flags and `until` lists of each mob. `minMean 30` on `tag.add` and `tag.remove` | NEW (RTS has 3 buffs) | sparse: a tag add or remove is a set write, not a row move |
| Tag interactions | Shatter, mark crit, shield absorb, phased immunity | `combat.hit`, `resolve.damage` | Read each tag from its own set inside the hit rule (normal code reads `mask` once and calls `hitOutcome`) | `flag.reads` (merged, see U4 below) | Hp, shield and flags after a hit. Counter `rule.shatter` | NEW | neutral: reads a few tags of one entity per hit |
| Optional components | A projectile has 0 to 12 trait components | `weapon.fire`, `move.proj`, `combat.hit` | One scan of all projectiles for each trait (normal code partitions by mask) | none (liveness only, see U4 below) | Pierce, bounce, split and chain change hits and spawns | NEW | sparse: 12 trait bits split projectiles into 20 to 40 archetypes |
| Fragmentation | Elites carry 1 to 3 of 6 affixes on 12 kinds: more than 100 small archetypes | `spawn.elite`, `status.tick`, `resolve.changed` | Find the affix set of each mob by a loop over the 6 affixes with one lookup each (normal code reads an `affix` int) | `mob.affix` | Speed, armor, hp, heal and scorch damage | NEW (RTS has item tags) | sparse: more than 100 small archetypes fragment iteration |
| Range queries from moving or short-lived origins | Magnet from the player, pulse aura, mines, Exploder blast, Storm | `pickup.magnet`, `weapon.pulse`, `combat.explode` | Scan all pickups or all mobs for each origin (normal code asks the grid) | none (liveness only, see U4 below) | Hp of hit mobs, `dmgOut`, pickup positions, xp timing | NEW | neutral: the grid does the search, not the storage |
| Events | 5 typed event lists, each read by 1 to 4 systems | `status.apply`, `cleanup.drops`, `pickup.collect`, `progress.pick` | Each consumer scans all entities for a `justX` flag (normal code keeps the lists) | `flag.reads` (merged, see U4 below) | `evt0` to `evt4`, drops, xp, splits | NEW | neutral: plain lists outside the entity storage |
| Change detection | A hp change drives enrage, boss phase and spark particles | `resolve.changed` | Keep a `prevHp` copy and compare every mob each tick (normal code collects ids at damage time) | `flag.reads` (merged, see U4 below) | Enrage flag, boss components, particles | NEW (RTS reads `Changed` for stats) | neutral: cost depends on the change-flag design, not the storage |
| Create and destroy churn | About 30 creates and 30 destroys per tick of 3 entity types, expiry by ttl | `weapon.fire`, `cleanup.*`, `spawn.*` | Rebuild each entity array with a filter after each destroy (as RTS) | `churn` | Ids and counts. `minMean 20` on `ttl.expire` | RTS mechanism, new shape | archetype: a create writes one row, not one insert per component |
| Grid update | Moved mobs and projectiles go to the grid | `grid.update` | Send every entity again before each search (as RTS) | `grid.update` | A wrong grid gives wrong hits | RTS | neutral: the grid is outside the entity storage |
| Cascade | Summons die with the summoner. Orbiters die with a replaced weapon | `cleanup.cascade` | Scan all children for each destroyed parent (as RTS) | none (liveness only, see U4 below) | Entity count | RTS | neutral: a link walk, not a storage scan |
| Render | Entities in the camera window fold into `renderChain` | `stats.render` | Copy each entity into a new object, then into the buffer (as RTS) | `stats.render` | `renderChain` | RTS (windowed) | archetype: dense position columns iterate fast |
| Save | Save every 25 ticks | between ticks | JSON round trip (as RTS) | `save` | Replayed hashes | RTS | archetype: whole columns copy in one pass |
| Load | Load every 50 ticks | between ticks | JSON round trip (as RTS) | `load` | Replayed hashes | RTS | neutral: both models rebuild every entity |

**Tuning decisions (U4, see `survivors-tuning.md`).** These decisions follow measured runs. The naive code never gets slower with fake work.

- **`flag.reads` merges `status.interact`, `events.route`, `hp.changed` and `mob.affix`.** Each alone gave a naive share of 0.3 to 1.9% in `grove`, `thicket` and `swarm`, because each costs a few hundred nanoseconds for each hit or each mob and a rate of 10 to 50 hits a tick is the most the game gives. The four are one idea: reading a flag, a tag or an affix bit of one entity, and the bookkeeping that follows a hit (route the event, detect the hp change). The merged region has a naive share of about 3.5 to 5%. A flag switches the four naive paths at once. The four liveness rows stay (`rule.shatter`, `evt.route`, `hp.changed`, `rule.affix`).
- **`range.aoe` is liveness only.** The grid has 16-tile cells and the horde stays inside about 3 cells around the player (the loop is small on purpose, so mobs keep up). A radius query then visits the same mobs as a scan, so the grid cannot win and the naive/normal ratio was 0.4 to 0.5 in every `grove` seed. Spreading the mobs over more cells would undo the dense horde. The counter `rule.aoe` stays (fire spread, Pulse and blasts call it).
- **`proj.traits` is liveness only.** `baseline-js` has no per-archetype iteration. Its trait pass is a bit test over about 100 to 300 projectiles. The naive share was 0.5 to 1.4% with a ratio near 1. The load of this facet sits in the archetype count, and `proj.traitSets` (minMean 3, measured 4.9 to 6) keeps it.
- **`cleanup.cascade` is liveness only.** A cascade destroys the few children of one dead summoner. Even with a summon period of 45 ticks and swarmlings that stay alive, a naive scan of all mobs for each dead summoner costs less than 0.05% of a tick. 2% needs about 10 summoner deaths a tick. `rule.cascade` and `sys.cleanup.cascade` stay live.
- **minMean changes.** `q.idleSkip` 6 to 4 (measured 4.1 to 4.8, because all gated kinds are mostly alive), `tag.remove` 30 to 15 (a mob that dies takes its tags with it, measured 17 to 45), `evt.route` 25 to 10 (it counts HIT, KILL, PICKUP and LEVELUP events, measured 11 to 62).
- **Rule change: fire spread** (SPEC 6.18 step 2). A burning mob lights mobs within 1.5 tiles every 6 ticks. It makes the burn a crowd effect, and it lifts hp changes (40 to 100 a tick), tag adds and particle churn.

These facets have a liveness row and no region: `loadout` (about 45 picks per run), `evolve`, `enrage`, `bossphase`, `charge` and `player` (the hp floor). They are cheap rules, and their cost sits in a region above. A counter keeps each of them alive. Their `favors` labels are: `loadout` and `player` neutral, `evolve`, `enrage`, `bossphase` and `charge` sparse (each is a tag or component swap). `statusAdd` shares the sparse label of tag churn.

### Storage profile

Each library's `CAPABILITIES.md` records its storage model (sparse, archetype or hybrid), so the report can group results by model.

The report gives a storage profile for each library. It takes the deep-run phase ratios to baseline-js and groups them by `favors`. A deep run times the 11 phases, not the regions. Thus a phase gets a label only through the facets of its systems:

| Label | Phases |
|---|---|
| sparse | `status` |
| archetype | `stats` |
| mixed | `spawn` (churn, affix), `ai` (gate, query, charge), `move` (gate, traits, grid), `combat` (traits, interact), `resolve` (interact, enrage, bossphase), `cleanup` (churn, cascade), `weapons` (churn, traits), `progress` (range, evolve) |
| neutral | `player` |

Only `status` and `stats` are clean. Most phases mix labels, so the profile shows them in a `mixed` group and does not count them for either side. Save and load times also come from deep runs, and they have the archetype and neutral labels.

What the profile can claim: a library is fast or slow, compared to baseline-js, in the phases that are clean for one model. What it cannot claim: that a region or a facet costs a given amount, or that a library is "archetype-strong" in general. Two clean phases are a small sample. The sweep is the better evidence for the crossover.

## Harness changes

| Piece | Change | Lines |
|---|---|---|
| `contract.ts` | `BaseScenario`, `Game`, `Sim<P = PhaseName>`, `CreateSim<S, K, P>`, `runPhases(game, sim)`, `minMean` on `LivenessRow`, `Regions` and `Counters` types. RTS call sites compile as they are | +40 |
| `packages/spec/src/games.ts` (new) | `RTS` and `SURVIVORS` values, `GAMES`, `findScenario`, the uniqueness assertion | +40 |
| `packages/spec/src/survivors/` (new) | `kernel.ts`, `facets.ts`, `scenarios.ts` | +550 |
| `SPEC-survivors.md` (new) | rules, system order, create order, snapshot layout, save notes. `SPEC.md` gets one line that points to it | +500 |
| `runner/src/games.ts` (new) | `HARNESS` per game, `implEntry`, `scoreByGame`. The RTS arrays move here from `budget.ts` and `liveness.ts` | +60 |
| `verify.ts`, `child.ts`, `bench.ts`, `profile.ts` | `SCENARIOS[n]` becomes `findScenario(n)`. The impl path becomes `implEntry`. `runPhases(game, sim)` | about 40 changed |
| `verify-all.ts` | smoke list from `HARNESS`. A missing entry file is a skip, not a failure | 6 |
| `budget.ts`, `liveness.ts`, `profile.ts` | regions and liveness rows from `HARNESS`. The thresholds stay the same (2%, 25%, 1.5x). `profile` checks `minMean` | about 30 |
| headline | `scoreByGame` runs `scoreTargets` once per game. No combined number | about 15 |
| results | RTS keeps `bench-data/summary.csv` and `docs/results.md`. Survivors writes `bench-data/survivors/summary.csv` and `docs/results-survivors.md`. The RTS CSV schema does not change | about 25 |
| goldens | flat in `goldens/`: 3 scenarios x 2 (full and smoke) x 3 seeds = 18 files, plus 9 sweep files for the timing seed only. baseline-js writes them with `--write`. RTS goldens do not change | data |
| `grid.ts`, `diff.ts` | no change | 0 |

> Note: the single survivors `kernel.ts` of this plan is now a barrel over `core`, `path`, `status`, `mobs`, `spawn`, `upgrades`, `hits`, `render` and `totals` in `packages/spec/src/survivors/`.

The budget and the liveness guard work as in the RTS. Each region in baseline-js has a naive branch. The floor of 2% naive share and the cap of 25% normal share apply in every scenario and for 3 seeds. The new `minMean` field covers the part that the budget cannot price, which is archetype moves. `profile` counts structural events per tick and fails when a mean is below its floor.

The headline of `survivors` is its own geomean of `target total / baseline-js total` over `grove` and `swarm`. The RTS number does not change. A library gets two numbers, and the report shows both.

## Runner follow-up

These items are for the runner after the first survivors version. They guard against overfitting and add a drift metric. They change no impl code.

**Held-out timing seed.** SPEC.md §11 sets one timing seed, `0xEC5A7E7A`, and that seed is in the public goldens. A tuned library can learn the exact load of that seed. Whoever publishes the board times a second seed as well. That seed is secret and has no file in `goldens/`. The headline reports both seeds, and a large gap between them is a warning sign.

Verify still works without a public golden. The run first plays baseline-js live on the held-out seed. Its final hash becomes the `golden` argument of `runChild` in `runner/src/child.ts`, which already takes any hash string. Each impl must match that hash, or the child exits with code 3 as today. The seed comes from an environment variable and never goes to the CSV.

**Keep the sweep off the headline.** An author can tune a library to one sweep cell. Thus no sweep cell enters `scoreByGame`, and the report shows the sweep only as a plot.

**Drift over time.** The report adds one number per (library, scenario): the mean tick time of the last 10% of ticks over the mean of the first 10%. A value above 1 shows that the library gets slower as the world ages, for example from fragmentation or leaked archetypes. The JIT warmup runs on a separate sim in `child.ts`, so the first 10% of the timed sim is after warmup.

The per-tick data exists today:

- Every run, headline and deep, fills `tickMs` in `runner/src/child.ts` and sends it in `RunResult`. `stats.ts` reduces it to p99, max and frames over 16.6 ms, and then drops it.
- Deep runs also keep one row per tick with the tick ms. `results.ts` writes the median of these rows to `bench-data/ticks/<scenario>/<target>.csv`.

Thus the drift ratio needs no new recording. Compute it in `tailMetrics` in `stats.ts` from the headline `tickMs`, so it has the full run count. The tick list includes the ticks that `runScheduled` replays after each load, so the last 10% is in execution order, not in game time.

## Synthesis decision

Candidate 2 is the base. It measures the stated goals of the owner directly. It has facet regions for the fixed cost per query, tag churn, events, change detection and fragmentation. Its single-source `SYSTEMS` and `FACETS` tables give the phases, the regions and the liveness rows. Its `minMean` floor makes the load shape a tested number. The cross-judge picked the same base.

The two candidates came to the same harness shape on their own. A game value is found by scenario name. `Sim<P>` is generic with the RTS phases as the default. The RTS goldens do not change. Each game has one headline. That shape ships.

From candidate 1:

- The harness. The small `Game` value (`phases`, `timedPhases`, `startHook`, `kernel`, `scenarios`, `board`, `entry`) and `findScenario(name)`. Scenario names are unique across games, with a module-load assertion. The goldens stay flat. `grid.ts` does not change.
- The immortal player. Hp has a floor of 1, and `dmgTaken` counts all damage. Contact damage and `IFRAMES` stay, so the tag has a rule.
- The shorter tick counts (3000, 3000, 2400), until a measured run gives better values.

From candidate 2:

- The derivation of the survivors regions and liveness rows from `FACETS` and `SYSTEMS`, instead of a `HARNESS` list kept by hand.
- Separate results files for survivors, so the RTS CSV schema does not change.
- The scenario names `grove`, `thicket` and `swarm`, and the board of `grove` and `swarm`.
- Commutative damage in `dmgIn`, and the tag merge by max.
- The expiry wheel as the normal way for baseline-js. The ECS impls can use any structure that gives the same hash.

Changes to both:

- Determinism uses the RTS house style (SPEC.md §5.6), not `SpawnReq`. Each system that creates entities handles its sources in gameId order. `SpawnReq`, `orderSpawns` and the commit at the end of each phase are gone.
- The game has 36 systems in 11 phases, not 46 in 12. The cut systems added impl lines and no new facet. `spawn.fade`, `player.timers`, `move.knockback`, `move.pickups`, `weapon.cooldown`, `weapon.mine`, `ai.orbit`, `ai.blink`, `ai.phase`, `progress.xp` and `stats.world` merged into other systems. The Orbiter and Blinker kinds are gone.
- The `idle` and `kinds` facets merged into one facet, `query.match`, as candidate 2 suggested. `ttl.expire` folded into `churn`. `pickup.magnet` folded into `range.aoe`. `loadout` is liveness only, because it runs about 45 times per run. The RTS facets `move.step` and `cleanup.unlink` are not repeated. The result is 15 regions, not 22.

Rejected:

- The many-to-many `HitCooldown` of candidate 1. The RTS `threat` facet already covers many-to-many with data, and the judge found it unfair to bitecs.
- The `goldens/survivors/` subdirectory and the per-game golden paths of candidate 2. The flat dir with unique names needs less plumbing.
- The claim of candidate 1 that many small systems have no region. Candidate 2 shows a naive way (a scan with a flag test instead of an active set), so the facet gets a region.
- The union of phase columns in one CSV of candidate 1.

## Tradeoffs accepted

- We accept coarse phases (11 groups of 36 systems) in exchange for a small contract, CSV schema and deep-run output. The cost of a single system shows only in totals and in `query.match`.
- We accept a secret timing seed. In exchange, a library cannot tune to the exact load of the headline. The cost is one more baseline-js run per board run and a result that nobody can replay without the secret.
- We accept a rule that scenario names are unique across games. In exchange, the CLIs, the goldens dir and the CSV keys do not change.
- We accept that `rts` stays at the root paths while `survivors` uses a subdirectory in each impl. This asymmetry is on purpose.
- We accept that baseline-js cannot price archetype moves. The `minMean` floor makes the count a tested number. The cost of each move shows only in the times of the other libraries.
- We accept 9 sweep goldens for one seed only. In exchange, the sweep costs about 1 min per impl and no impl code. A seed-specific bug in a sweep cell is possible.
- We accept a storage profile from phases, not regions. Most phases mix labels, so only `status` and `stats` count. The `favors` labels are design claims, and the sweep tests them.
- We accept six facets with no region. Their liveness counters keep them alive, but the share floor does not apply to them.
- We accept create order by gameId, as the RTS does. An impl must not create entities in the order of its query iteration. In exchange, there is no commit step and no request type.
- We accept that the smoke scenarios change `paceScale` and `xpScale`. Their hashes do not predict the full-scenario hashes.

## Alternatives considered

1. **One shared `Scenario` union and one phase tuple.** `Scenario` gets a `kind` field, and `PHASES` becomes a union. This changes the RTS contract or the goldens, and each impl must know the phases of both games. The `Game` value gives the same runner reuse with no RTS edits.
2. **One workspace package per game, with the RTS moved.** This is the cleanest end state. It moves about 100 files and changes every impl import and many doc links. `Game` is already the seam, so this move can happen later.
3. **Each system is a phase.** This gives the cost of each system directly. It adds 36 CSV columns and makes deep runs large. Coarse phases plus the `query.match` region give the data that the budget needs.
4. **Spawn requests sorted at the end of each phase (`SpawnReq`).** This lets an impl create entities in any order. It adds a request type, a sort and a commit step to each phase in all four impls. The RTS rule of SPEC.md §5.6 already gives the same result.
5. **Fewer, larger systems, as in the RTS (9 systems).** This does not test the fixed cost of many queries, which is the first goal of the owner.

## Lines per impl (non-test, estimate)

| Impl | Estimate | Reason |
|---|---|---|
| baseline-js | 1300 | 36 systems, 15 regions with naive branches, counters, snapshot, save, load, wheel |
| koota | 900 | one trait for each tag and each trait bit, `updateEach` systems |
| bitecs | 1050 | manual removal, relation cleanup, tags as components |
| iris | 1100 | separate unit grid, driver, event handling |

The spec side is about 550 lines of kernel, facets and scenarios, and about 500 lines of `SPEC-survivors.md`. The runner and harness change about 230 lines. The total is about 5.6k new lines.

## Implementation reconciliation

The first baseline-js version (`impls/baseline-js/src/survivors/`) changed `SPEC-survivors.md` in these places, because the text was open to two readings:
- The survivors kernel re-exports `fx`, `isqrt`, `rand`, `randInt`, `clampToArena` and `distSq`.
- `pierceLeft` and `bounceLeft` come from the traits of the new projectile, after `scaleTraits`.
- An aura weapon fires whenever `cd` is 0.
- The `hitMask` skip test reads the mask once, before the first hit of a projectile.
- Split: step 4 applies to any projectile whose traits have `SPLIT`. The rule "not a split child" is gone.
- Explode: the `IMMUNE_HIT` test uses the flags after the fuse step.
- Every pickup has `ttl = tick + 900`. The drop order is gem, heart, chest.
- `owner` is a link: it is -1 in the snapshot when its mob is gone.
- `n` of the render buffer counts the player.
- `progress.apply` destroys every live projectile of an orbit weapon id.
The move.proj row of `SYSTEMS` no longer says that BOUNCE reflects at the arena edge. The spec has no such rule.

## Open questions and risks

Risks:

- **Floor of 2% on a small world.** A tick takes about 0.3 to 1 ms. `query.match` and `hp.changed` can fall below the floor in `grove`. The fix is more load, as in the RTS. Tuning changes the goldens.
- **Region timer overhead.** 15 regions and 36 systems give about 80 timer calls per tick. Measure this first in `grove`.
- **Budget wall time.** 3 scenarios x 3 seeds x all variants is large even at 3 s per run. Allow `--runs 3` for survivors.
- **Archetype moves are not visible to baseline-js.** Only `minMean` covers them. If observers or change flags take most of the tag cost of a library, the board shows it but the budget does not explain it.
- **Create order.** Each system that creates entities must sort its sources by gameId. A library that iterates in another order and does not sort gives other ids. The `creates` field and SPEC-survivors are the places to review first.
- **Sweep axes are not clean.** `tagScale` also changes the time that mobs spend in `BLOCKS_MOVE` tags, so it changes the move and combat load too. The plot uses the measured churn on its axis for this reason.
- **Labels can be wrong.** A `favors` label is a guess about storage. A library with a good tag path can win a sparse phase as an archetype library. The profile reports times, and the labels only group them.
- **Late content in sweep cells.** 1200 ticks at the `thicket` pace can miss evolutions and late kinds. The sweep measures storage, not the full rule set, so this is acceptable. Do not use a sweep cell for liveness.
- **Save size.** 3k small entities saved every 25 ticks can make `save` more than 25% of the tick. `particleScale` is the cheap knob.
- **Upgrade picks are a script.** A seed can miss an evolution. The `evolve` row is `late` and the check runs on all 3 seeds.

Questions for the owner:

1. Is the survivors number on the README board next to the RTS number, or on a second page?
2. Is the first version fine with coarse phases, or does the owner want timing for each system?
3. Does `pnpm diff` need survivors support in the first version?
4. Is an arena of 256 tiles with a spawn ring near the player correct, or must the arena be smaller (which needs a `grid.ts` change)?
5. Is a 3 x 3 sweep enough, or does the owner want a `traitScale` axis too? A 3-cell line on `traitScale` adds about 20 s per impl.
6. Who holds the held-out seed, and does it change after each public results release?
7. Does the drift ratio go in the main results table, or only next to the tick plots?

## Next implementation step

Add `Game`, `findScenario` and the `RTS` value, and run `pnpm verify:all` to prove that the RTS goldens stay byte-identical. Then land the survivors kernel and a baseline-js `createSim` that gives a stable hash trace for `grove-smoke`.
