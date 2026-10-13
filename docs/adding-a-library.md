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

1. Copy `impls/koota` to `impls/<lib>`. Change the package name to `@ecs-arena/impl-<lib>`.
2. Replace the koota dependency with your library, then run `pnpm install`.
3. Write the systems, one for each phase. Use the SPEC.md section numbers in the function names or comments.
4. Run `pnpm verify <lib> skirmish-smoke`. On a failure, the runner shows the first tick that differs.
5. To find the cause, compare your parsed snapshot with `baseline-js` at that tick. Use the parser in `impls/baseline-js/src/testkit.ts`.
6. Run `pnpm verify <lib> skirmish battle war`. All three must pass.
7. Fill in `impls/<lib>/CAPABILITIES.md` from [the template](capabilities-template.md).
8. Open a PR. A reviewer checks the capability table against the code.

## Determinism traps

| Trap | Rule |
|---|---|
| Your library visits entities in a different order | Rules are order-independent. Sum damage and heal, then apply them at the end of the phase. |
| You read a value that another entity wrote in the same phase | Read the start-of-phase value. The only exception is leaders before members in `move`. |
| Two entities tie on distance | The lowest `gameId` wins. |
| You spawn many entities in one phase | Sort spawn intents by `(sourceGameId, salt)` before you assign `gameId`. |
| You call a random function in a loop | Use `kernel.rand(seed, tick, gameId, purpose, salt)`. A draw never depends on call order. |
| You use `Math.sqrt` | Use `kernel.distSq` and `kernel.isqrt`. |
