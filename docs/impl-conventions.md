# Implementation conventions

Each implementation in `impls/` is a benchmark entry and a template. A library author copies it, so a reader must be able to open the same system in two libraries and see only the differences between the libraries. These rules apply to every game in every implementation.

## Layout

```
src/rts/        the RTS game: index.ts is its entry
src/survivors/  the survivors game: index.ts is its entry
src/factory/    the factory game: index.ts is its entry
src/shared/     only code that more than one game imports
```

A game folder never imports from the other game folder. A helper moves to `shared/` only when both games use it. An impl that does not play a game leaves its folder out.

## Names

- The context type is `Ctx` and its value is `ctx`. The scenario is `scenario`, and the kernel is `k`.
- `createSim` stores the kernel that the runner passes on `ctx.k`. Functions come from `ctx.k`. Module-level declarations may import constant tables (`STATUS`, `MOB`, `TRAIT`) from the spec.
- One helper sorts by gameId (`byGameId`). Every system that creates entities or iterates in a fixed order calls it. Nothing sorts inline.

## The context holds data

`Ctx` holds the library world, the queries, the scenario, the kernel, the per-tick lists and the totals. It holds no behavior. It has no methods that wrap a library call or a kernel function.

Behavior lives in plain functions that take `ctx`, grouped by topic. Each game folder has its own set of these files:

| File | Contents |
|---|---|
| `index.ts` | `createSim`: builds the context and wires the phases |
| `context.ts` | the `Ctx` type and `createContext` |
| `components.ts` | components, tags and relations (`traits.ts` where the library uses that word) |
| `queries.ts` | every query, created in one place |
| `entities.ts` | factories (`makeMob` and others) and destroy |
| `tags.ts` | status tags: add, remove, read (survivors) |
| `events.ts` | the event lists and their typed readers (survivors) |
| `snapshot.ts`, `save.ts` | SPEC §8 and §10 |
| `systems/<group>.ts` | one file per phase group |

A file that a game does not need is left out. A library-specific helper that has no row here gets its own file with a one-line header that says why it exists.

## Systems call the library

A system reads and writes components through the library API, not through context helpers. The library calls are the content that a reader comes to see.

## Determinism

The order rules are in SPEC.md §5.6 and SPEC-survivors.md. A system that creates entities handles its sources in ascending gameId order. It never uses the iteration order of the library.

## Types

- No `any`, no `as unknown as` and no `as never`. When a library type does not fit, write a typed helper once in `components.ts` and give it a comment that says why.
- Tag lists are typed `as const` tuples. Timed tags and plain tags are separate lists, so the code reads `until` without a cast.

## Loops and lines

- A loop over entities in a per-tick system uses the iteration form that the library recommends for speed. Other code uses `for...of`.
- Lines stay under 140 characters. A long predicate becomes a named function.

## Comments

A comment states a reason that the code cannot show, or a SPEC section. A workaround for a library bug states the library version and goes in `workarounds.ts`, so it can be removed when the library is upgraded.

## baseline-js only

baseline-js is the plain JavaScript reference. It is also the only instrumented implementation. It has regions, counters and the naive variant of each region. Each system selects the normal or the naive function of a region once, when the system is built. Domain code has no inline `if (naive)` branches. Other implementations do not copy the instrumentation.
