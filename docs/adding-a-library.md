# Add an ECS library

This guide shows how to add a new library to ecs-arena. The work takes about 1–3 days.

## The contract

An implementation exports one function. The runner gives it a scenario and the kernel.

```ts
import type { CreateSim } from '@ecs-arena/spec'

const createSim: CreateSim = (scenario, kernel) => ({
  phases: {
    spawn() {}, 'ai/target'() {}, move() {}, combat() {},
    effects() {}, cleanup() {}, stats() {},
  },
  snapshot() { return [] },
})
export default createSim
```

- The runner calls the 7 phases in spec order, once for each tick. It times each phase.
- `snapshot()` returns the flat int32 array from SPEC.md §8. The runner hashes it.
- Use the `kernel` argument for all randomness, math and rule tables. Do not copy the formulas.

## Rules

1. Use the library API for each required capability. These are entity create and destroy, tags, relations with targets, relations with data, change detection, and queries with `Not` and `Or`.
2. Store `gameId` as a component. Never hash a native entity ID.
3. Own your spatial index. The kernel does not give one.
4. Do not depend on Node APIs inside `impls/`. Only `runner/` can use Node.
5. Do not change `SPEC.md` or the goldens to make your implementation pass. If you find a spec bug, open an issue.

## Steps

Expected `pnpm verify` times, measured on one laptop with Node 24. Your times differ, but the ratios hold.

| Scenario | Ticks | baseline-js | koota |
|---|---|---|---|
| `skirmish-smoke` | 400 | 1 s | 1 s |
| `skirmish` | 2000 | 1 s | 2 s |
| `battle` | 2000 | 4 s | 17 s |
| `war` | 1000 | 18 s | 52 s |

A run much slower than these numbers means a hot loop that scans too much.

1. Copy `impls/koota` to `impls/<lib>`. Change the package name to `@ecs-arena/impl-<lib>`. Keep the layout. `src/index.ts` is the entry the runner loads. `components.ts`, `relations.ts`, `queries.ts`, `spawning.ts`, `snapshot.ts` and `systems/<phase>.ts` hold the rest, one system for each phase.
2. Replace the koota dependency with your library, then run `pnpm install`.
3. Learn your library's relation semantics. Answer the four questions below in your notes before you write code.
   - Exclusive swap. What happens when you add a second target to an exclusive relation? Does the old pair go away?
   - Cleanup on destroy. When you destroy a target, does the library remove the pairs that point to it? Does it destroy the sources?
   - Store lifetime. Does a destroyed entity keep its component data? Does a new entity see old data?
   - Id recycling. Does the library reuse entity ids? How soon?
4. Write the systems, one for each phase. Use the SPEC.md section numbers in the function names or comments. Read the [traps](#traps) first.
5. Run `pnpm verify <lib> skirmish-smoke`. A pass here is not proof. Smoke is 400 ticks. It stops before the first rout. A trial implementation passed smoke with two real bugs.
6. Run `pnpm verify <lib> skirmish` before you trust smoke. Then run `battle` and `war`. All must pass.
7. On a failure, debug with the diff tool. See [Debug a failing scenario](#debug-a-failing-scenario).
8. Fill in `impls/<lib>/CAPABILITIES.md` from [the template](capabilities-template.md). Run `pnpm run check:caps`.
9. Open a PR. A reviewer checks the `Support` column and the links against the code.

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

- **Start-of-phase reads.** A library has no double-buffered stores. Copy the positions at the top of `move`.
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
