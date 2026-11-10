# Add an ECS library

This guide shows how to add a library to ecs-arena. You write the three games, the RTS, survivors and factory, with your library, and the runner checks every tick against a committed hash trace. Library authors and maintainers are welcome, and so are agents working from this guide. Plan on 1 to 3 days for the RTS, about as long for survivors, and less than a day for factory.

## Before you start

Read these in order. Together they are the spec. You do not need to read another implementation to write yours.

1. [`CONTEXT.md`](CONTEXT.md). The glossary of the RTS terms.
2. [`packages/spec/SPEC.md`](packages/spec/SPEC.md). The RTS rules. §8 is the snapshot layout that the runner hashes. §10 is save and load.
3. This guide, then [`docs/impl-conventions.md`](docs/impl-conventions.md) for the file layout every entry follows.
4. [`packages/spec/SPEC-survivors.md`](packages/spec/SPEC-survivors.md). The survivors rules, when you get to the second game.
5. [`packages/spec/SPEC-factory.md`](packages/spec/SPEC-factory.md). The factory rules, for the third game.

The spec is the text plus the kernel in `@ecs-arena/spec`. You import the kernel for randomness, fixed-point math, rule tables and the spatial grid, so you never copy a formula. Where the text and the kernel differ, the kernel gives the value, and the text has a bug that you can report.

The goldens are in `goldens/<scenario>.json`, `<scenario>.s2.json` and `<scenario>.s3.json`, one for each seed. `baseline-js` writes them. You never write or change them.

The runner finds your entry by folder. `impls/<lib>/src/rts/index.ts`, `src/survivors/index.ts` and `src/factory/index.ts` each default-export a `createSim`. A missing file means that your entry does not play that game.

## Definition of done

A pull request for a new library is ready for review when all of these are true:

- `pnpm verify <lib> skirmish battle war grove thicket swarm mill works` passes, on all 3 seeds of each scenario. CI runs the smoke scenarios with `pnpm verify:all`.
- `impls/<lib>/CAPABILITIES.md` fills every row of [the template](docs/capabilities-template.md), and `pnpm run check:caps` passes.
- `pnpm test`, `pnpm typecheck` and `pnpm lint` pass.
- The entry uses only APIs that your library docs teach. A tuned entry goes in `impls/<lib>-tuned`.
- Your library is in the `bench:site` script in `package.json` and has a block in `site/index.html`, so the project page measures it and links it.
- The pull request names the library version and links its docs.

## The contract

An implementation exports one function for each game. The runner gives it a scenario and the kernel. This section shows the RTS. Survivors uses the same `Sim` shape with its own phases.

```ts
import type { CreateSim, Kernel, PhaseName, Scenario } from '@ecs-arena/spec'

const createSim: CreateSim<Scenario, Kernel, PhaseName> = (scenario, kernel) => ({
  phases: {
    spawn() {}, 'ai/target'() {}, move() {}, combat() {}, effects() {},
    morale() {}, cleanup() {}, objectives() {}, stats() {},
  },
  snapshot() { return [] },
  save() { return {} },
  load(state) {},
  // Optional:
  tick() {},
  dispose() {},
})
export default createSim
```

- `phases` holds the 9 phases. Deep-dive runs, `pnpm verify` and the diff tool call them one by one in spec order.
- `tick()` is optional. When it is there, headline runs call it once for each tick. It must run the 9 phases in spec order, the way your library teaches (for example a scheduler or a pipeline). Without it, headline runs call `phases` in order.
- `moveStart()` is optional. The runner calls it right before the `move` phase. Put the start-of-phase copy there, and a deep-dive run times it as its own `move.start` line. When you give a `tick()`, it must call `moveStart()` before `move`. `baseline-js` has no `moveStart`, because it keeps start positions in the move loop.
- `snapshot()` returns the flat int32 array from SPEC.md §8. The runner hashes it.
- `save()` returns a deep copy of everything that a later tick reads. The runner keeps the newest save and never looks inside it.
- `load(state)` replaces the live state of the same sim with a value from `save()`. Native ids can change. `gameId` values cannot. See SPEC.md §10.
- `dispose()` is optional. It frees library resources that a process can run out of, such as a world limit. `pnpm verify` calls it after each trace.
- Use the `kernel` argument for all randomness, math and rule tables. Do not copy the formulas.

### Save and load

The runner asks for a save after each 25th tick. In the RTS, after every 200th tick (199, 399 and so on), it calls `load` with the newest save and replays the 24 ticks after it. Survivors loads every 50 ticks. The hash trace must match a run without the loads. A wrong `load` fails `pnpm verify` at the first replayed tick.

- Use the library API to list the entities and their data. If the library has a serialize API, use it.
- Keep relation targets as `gameId` values in the save. Relink them by `gameId` in `load`.
- After `load`, the library must not report old change events. Drain or reset each tracker and observer queue.
- Tell the kernel grid about every unit again after `load`.
- Note in `CAPABILITIES.md` if you emulate save or load, and give the reason.

### The kernel grid

The kernel owns the spatial grid (`SpatialGrid` from `@ecs-arena/spec`). Create one in your sim. Every spatial search uses it. Keep it current with these calls.

- `grid.add(handle, gameId, x, y)` when a unit spawns or leaves a garrison.
- `grid.update(handle, x, y)` for each unit that moves.
- `grid.remove(handle)` when a unit dies, leaves the battle or enters a garrison.
- `grid.forNear(x, y, r, fn)` and `grid.nearest(x, y, r, accept)` for searches.

The handle is your choice, for example the native entity id. Map it back to the entity yourself. Report moves with your library's change detection when it has one. This is facet B.

## Rules

1. Use the library API for each required capability. `CAPABILITIES.md` lists them. Use [the template](docs/capabilities-template.md).
2. Store `gameId` as a component. Never hash a native entity ID.
3. Use the kernel grid for spatial searches. Do not write your own spatial index.
4. Do not depend on Node APIs inside `impls/`. Only `runner/` can use Node.
5. Do not change `SPEC.md` or the goldens to make your implementation pass. If you find a spec bug, open an issue.

## Steps

Time `pnpm verify baseline-js <scenario>` on your machine first. Then compare your run with it. A run many times slower than the other entries means a hot loop that scans too much.

1. Create `impls/<lib>`. You can start from a copy of `impls/koota` or `impls/bitecs`, whichever is closer to your library, as a layout to fill in. Change the package name to `@ecs-arena/impl-<lib>`. Keep the layout in `docs/impl-conventions.md`. `src/rts/index.ts` is the entry the runner loads for this game. `context.ts`, `traits.ts`, `queries.ts`, `entities.ts`, `snapshot.ts`, `save.ts` and `systems/<phase>.ts` in `src/rts/` hold the rest, one system for each phase.
2. Replace the koota dependency with your library, then run `pnpm install`.
3. Learn your library's relation semantics. Answer the four questions below in your notes before you write code.
   - Exclusive swap. What happens when you add a second target to an exclusive relation? Does the old pair go away?
   - Cleanup on destroy. When you destroy a target, does the library remove the pairs that point to it? Does it destroy the sources?
   - Store lifetime. Does a destroyed entity keep its component data? Does a new entity see old data?
   - Id recycling. Does the library reuse entity ids? How soon?
4. Write the systems, one for each phase. Use the SPEC.md section numbers in the function names or comments. Read the [traps](#traps) first.
5. Run `pnpm verify <lib> skirmish-smoke`. A pass here is not proof. Smoke is 400 ticks. It stops before the first rout. A trial implementation passed smoke with two real bugs.
6. Run `pnpm verify <lib> skirmish` before you trust smoke. Then run `battle` and `war`. All must pass. Each scenario runs with 3 seeds, and each seed has its own golden. A pass with one seed is not enough.
7. On a failure, debug with the diff tool. See [Debug a failing scenario](#debug-a-failing-scenario).
8. Fill in `impls/<lib>/CAPABILITIES.md` from [the template](docs/capabilities-template.md). Include the rows for save and load and for the kernel grid. Run `pnpm run check:caps`. It fails on a broken link.
9. Run `pnpm bench baseline-js <lib> skirmish war` to see your headline score.
10. Open a PR. A reviewer checks the `Support` column and the links against the code.

You do not run `pnpm budget` for a new library. The load budget measures `baseline-js` only. It shows that the game loads each facet, not how fast your library is.

## Add the survivors game

Survivors is a small world (1k to 3k live entities) with 36 small systems, heavy churn and frequent tag changes. Its rules are in `packages/spec/SPEC-survivors.md`. Its kernel is `survivors.kernel` from `@ecs-arena/spec`. The runner passes the kernel to `createSim` as `k`.

1. Write the files in `src/survivors/`. `docs/impl-conventions.md` names each file and what it holds. `src/survivors/index.ts` is the entry the runner loads for this game. Use `impls/koota/src/survivors/` as the template. The context holds data only. Tags, entities, events, hits, loadout and queries each have their own file of plain functions that take `ctx`.
2. Write one system for each row of `survivors.SYSTEMS` (`packages/spec/src/survivors/facets.ts`). A system has the type `(ctx) => () => void`. It builds its state once and returns the function that runs each tick. Group the systems in `systems/<group>.ts`, one object of systems for each group.
3. Merge the groups into one `survivors.SystemTable<Ctx>`. The table is a `Record` over the system ids, so a missing system is a type error. Pass it to `survivors.wirePhases(table, ctx)`, which returns the `phases` of the `Sim`. It runs the systems of each phase in table order. If your library registers each system with a scheduler, pass the optional third argument `wrap(id, run)`. It turns each built system into the step its phase calls.

   ```ts
   const table: survivors.SystemTable<Ctx> = { ...spawnSystems, ...weaponSystems, /* every group */ }

   const createSim: CreateSim<survivors.SurvivorsScenario, SvKernel, survivors.SvPhase> = (scenario, k) => {
     const ctx = createContext(scenario, k)
     return {
       phases: survivors.wirePhases(table, ctx),
       snapshot: () => snapshot(ctx),
       save: () => save(ctx),
       load: (state) => load(ctx, state as Saved),
       dispose: () => ctx.world.destroy(),
     }
   }
   export default createSim
   ```

4. Use the kernel for every rule. Do not copy a formula or a table.
   - Randomness comes from the named draws, for example `critDraw`, `spawnAngle`, `eliteAffixes`, `sparkVel`, `burstVel`, `randomAimVel`, `scatterPoint`, `dropsHeart` and `pickUpgrade`. Each draw holds its purpose and salt from SPEC-survivors §2. Do not call `rand` with a purpose yourself.
   - Keep the world totals in one `Totals` from `newTotals()`. Write the first fields of the snapshot with `worldHeader(totals)` (SPEC-survivors §8 item 1).
   - `aimOf(weaponId)` gives the aim mode of a weapon (`'orbit'`, `'aura'` and others). Branch on it, not on weapon ids.
   - `TRAIT_COUNT` is the number of projectile trait bits, and `STATUS_COUNT` the number of status tags. If your library has one tag for each bit, check the length of your tag list against these values at compile time. `impls/iris/src/survivors/components.ts` shows one way.
5. Write `snapshot.ts` and `save.ts` from SPEC-survivors §8 and §10. Survivors saves every 25 ticks and loads every 50 ticks, so a wrong `load` fails early.
6. Run `pnpm verify <lib> grove-smoke`. It runs 600 ticks with 3 seeds and takes a few seconds. Then run `thicket-smoke` and `swarm-smoke`.
7. Run `pnpm verify <lib> grove swarm`. These are the board scenarios. Each runs with 3 seeds, and each seed has its own golden. For koota the two take about 2 min. All must pass. `pnpm run diff` does not decode survivors snapshots, so debug a failure with the systems of the failing tick and SPEC-survivors §6.
8. Add a `## Survivors` section to `impls/<lib>/CAPABILITIES.md` from [the template](docs/capabilities-template.md). Run `pnpm run check:caps`.
9. Run `pnpm bench baseline-js <lib> grove swarm`. Survivors gets its own headline score. No number mixes the games.

## Add the factory game

Factory is a large, mostly idle world: up to 150,000 machines, of which about 2% work on a tick, with drones that carry stacks of crates. It is the smallest of the three games, with 3 entity kinds and 9 phases. Its rules are in `packages/spec/SPEC-factory.md`. Its kernel is `factory.kernel` from `@ecs-arena/spec`.

1. Write the files in `src/factory/`. Use `impls/koota/src/factory/` as the template.
2. Use the kernel for the layout of the machines (`kindOf`, `slotPos`, `manualOf`, `boostOf`, `startOutput`), the routes and the outages. Do not keep a table of machine kinds.
3. Build the list of changed machines (SPEC-factory §8) on every tick, not when the snapshot is taken. After a load, reset the change tracking.
4. Run `pnpm verify <lib> mill-smoke works-smoke`, then `pnpm verify <lib> mill works`.
5. Add a `## Factory` section to `impls/<lib>/CAPABILITIES.md` from [the template](docs/capabilities-template.md). Run `pnpm run check:caps`.
6. Run `pnpm bench baseline-js <lib> mill works`.

## Debug a failing scenario

`pnpm verify` shows the first tick whose hash differs. Then run the diff tool.

```sh
pnpm run diff <impl> <scenario> <tick> [gameIds...]
```

The tool runs `baseline-js` and your implementation in lockstep. It stops at the first tick whose hashes differ, or at `<tick>` if the hashes match until then. For each snapshot section it prints the first differing record. A `*` marks each field that differs. Each `gameId` that you list is printed in full, even when it is the same in both snapshots.

Use this loop.

1. Run `pnpm verify <lib> <scenario>` and note the tick.
2. Run `pnpm run diff <lib> <scenario> <tick>`. Read the first differing section and field.
3. Name the phase that writes the field. Look for a trap in the list below.
4. Run the tool again with the `gameId` values from the output to see whole records.

The tool uses `pnpm run diff`. The bare `pnpm diff` is not a script. It decodes RTS snapshots only. For a survivors or factory scenario it stops with an error.

## Determinism traps

| Trap | Rule |
|---|---|
| Your library visits entities in a different order | Rules are order-independent. Sum damage and heal, then apply them at the end of the phase. |
| You read a value that another entity wrote in the same phase | Read the start-of-phase value. The only exception is leaders before members in `move`. |
| Two entities tie on distance | The lowest `gameId` wins. |
| You spawn many entities in one phase | Sort spawn intents by `(sourceGameId, salt)` before you assign `gameId`. |
| You call a random function in a loop | In the RTS, use `kernel.rand(seed, tick, gameId, purpose, salt)`. In survivors and factory, use the named draw functions of the kernel. A draw never depends on call order. |
| You use `Math.sqrt` | Use `kernel.distSq` and `kernel.isqrt`. |

## Traps

Check this list before you write code, and again when a scenario fails.

### Library traps

- **Change detection on a second relation pair.** `Added` on a relation can fire for the first pair of an entity only. A second `Equips` pair then raises nothing. Use an observer, or compare the lists yourself.
- **Change detection that needs a filter.** In koota 0.6.6 a query with only a tracker modifier reports every new entity as added. Add a plain trait to the query.
- **Change detection with `Or`.** `Or(Added(T), Removed(T))` with another trait missed a trait that was added after spawn. Use observers for the dirty set.
- **Observers on destroyed entities.** `onRemove` fires when you destroy an entity. Skip a dirty entity that is no longer alive.
- **Relation cleanup on destroy.** Not every library cleans up relation pairs when you destroy a target. Manual cleanup is allowed. Note it in `CAPABILITIES.md` with the reason. bitECS needed it because its relation wildcard is not reference-counted.
- **Relation update with an updater function.** koota 0.6.6 ignores `entity.set(Threat(a), (t) => ...)`. Read the value, then pass an object.
- **Entity id reuse.** Some libraries reuse an id at once. Initialise every field on spawn. Never keep a native id across a destroy. `gameId` is the identity.
- **Live query results.** Some libraries return the live array of a query. If your loop adds, removes or destroys, the array changes under you. Copy the result first, or collect the entities and change them after the loop.
- **Structural changes in an iteration callback.** Do not add, remove or destroy inside `readEach` or `updateEach`. Collect first.
- **Per-target queries.** A query for each target entity (`MemberOf(e)`) can register one cached query for each entity. Count grows with the population. Scan the wildcard once when you can.
- **Native relation lookups in a hot loop.** `getRelationTargets` in bitECS copies the components on each call. Cache the result for the phase.

### Ordering traps

- **Start-of-phase reads.** Most libraries have no double-buffered stores. Copy the positions in `moveStart`, so that the deep-dive report shows the cost as `move.start`.
- **Replay after load.** The replayed ticks must give the same hashes as the first time. Reset every counter, cache and memo that `load` makes stale.
- **Hierarchy order by depth.** `move` visits leaders before members. Compute the depth of each unit through `MemberOf` and `ChildOf`, bucket by depth, then move in order. A query cannot filter by depth.
- **Snapshot order.** Sort each snapshot section by `gameId`. Native iteration order is not part of the rules.

## Where the runner names koota

Variants compare two builds of one library, as in `pnpm compare koota@main koota@fresh-perf battle`. Variants work for koota only today. These places name koota.

- `runner/variants.json` lists the variants. Each entry holds a git `repo` and a `ref`.
- `runner/src/variants.ts` builds the package with `pnpm -F koota build`. It reads the result from `packages/publish`. Both belong to the koota repository layout.
- `runner/src/bench.ts` maps each variant to the alias `{ koota: <built package> }`.
- `runner/src/bench-child.ts` prints the resolved path of `koota` at start.
- `runner/src/alias.test.ts` uses a fake `koota` package. The alias hook in `runner/src/alias-hook.mjs` is generic. It maps any package name.

A git-ref variant of another library needs a change in `variants.ts` and `bench.ts`. The plain name `pnpm bench <lib> <scenario>` works for every library.
