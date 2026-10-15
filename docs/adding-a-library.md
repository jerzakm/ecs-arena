# Add an ECS library

This guide shows how to add a new library to ecs-arena. The work takes about 1 to 3 days.

## The contract

An implementation exports one function. The runner gives it a scenario and the kernel.

```ts
import type { CreateSim } from '@ecs-arena/spec'

const createSim: CreateSim = (scenario, kernel) => ({
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

The runner asks for a save after each 25th tick. After every 200th tick (199, 399 and so on), it calls `load` with the newest save and replays the 24 ticks after it. The hash trace must match a run without the loads. A wrong `load` fails `pnpm verify` at the first replayed tick.

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

1. Use the library API for each required capability. `CAPABILITIES.md` lists them. Use [the template](capabilities-template.md).
2. Store `gameId` as a component. Never hash a native entity ID.
3. Use the kernel grid for spatial searches. Do not write your own spatial index.
4. Do not depend on Node APIs inside `impls/`. Only `runner/` can use Node.
5. Do not change `SPEC.md` or the goldens to make your implementation pass. If you find a spec bug, open an issue.

## Steps

Time `pnpm verify baseline-js <scenario>` on your machine first. Then compare your run with it. A run many times slower than `koota` means a hot loop that scans too much.

1. Copy `impls/koota` to `impls/<lib>`. Change the package name to `@ecs-arena/impl-<lib>`. Keep the layout. `src/index.ts` is the entry the runner loads. `context.ts`, `components.ts`, `relations.ts`, `queries.ts`, `spawning.ts`, `snapshot.ts`, `save.ts` and `systems/<phase>.ts` hold the rest, one system for each phase.
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
8. Fill in `impls/<lib>/CAPABILITIES.md` from [the template](capabilities-template.md). Include the rows for save and load and for the kernel grid. Run `pnpm run check:caps`. It fails on a broken link.
9. Run `pnpm bench baseline-js <lib> skirmish battle war` to see your headline score.
10. Open a PR. A reviewer checks the `Support` column and the links against the code.

You do not run `pnpm budget` for a new library. The load budget measures `baseline-js` only. It shows that the game loads each facet, not how fast your library is.

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

The tool uses `pnpm run diff`. The bare `pnpm diff` is not a script.

## Determinism traps

| Trap | Rule |
|---|---|
| Your library visits entities in a different order | Rules are order-independent. Sum damage and heal, then apply them at the end of the phase. |
| You read a value that another entity wrote in the same phase | Read the start-of-phase value. The only exception is leaders before members in `move`. |
| Two entities tie on distance | The lowest `gameId` wins. |
| You spawn many entities in one phase | Sort spawn intents by `(sourceGameId, salt)` before you assign `gameId`. |
| You call a random function in a loop | Use `kernel.rand(seed, tick, gameId, purpose, salt)`. A draw never depends on call order. |
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
