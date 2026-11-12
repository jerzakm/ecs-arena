# Bricks

Bricks is the small tutorial game of ECS Arena. Balls fly in a box and break blocks, and each hit gives 1 point.
New blocks appear at random cells, so the game never ends. It has no paddle and no player.

Each entry plays bricks with one ECS library. An entry is one file in the `entries/` folder. The `vanilla` entry uses plain loops and no library.
The runner checks each tick of an entry against a golden, a committed file of hashes (see Part 2).

The files of the game:

```
games/bricks/
  README.md
  package.json
  shared.ts          the shared code
  entries/
    vanilla.ts       the vanilla entry
    koota.ts
    bitecs.ts
    iris.ts
```

## Run it

```sh
pnpm install
pnpm verify koota bricks-smoke bricks        # check the koota entry on both scenarios, 3 seeds each
pnpm bench vanilla koota bricks --runs 3     # time koota against the vanilla entry
```

A scenario is a name and a number of ticks. Verify runs each scenario with 3 seeds. Bench uses the first seed. `bricks` runs 1000 ticks. `bricks-smoke` runs 200 ticks.
The results label bricks "tutorial". Bricks is not in the headline score.

## Part 1: Game rules

The box is a grid of cells. Ball positions and speeds are floats. All other values are integers.

A ball has these fields:

| Field  | Meaning                                          |
| ------ | ------------------------------------------------ |
| gameId | The number of the ball. `startRows` gives it.    |
| x, y   | The position in the box, a float in pixels.      |
| vx, vy | The speed on each axis, a float in pixels for each second. |

A block has these fields:

| Field  | Meaning                                     |
| ------ | ------------------------------------------- |
| gameId | The number of the block. `startRows` or `respawnRows` gives it. |
| cx, cy | The cell of the block.                      |
| hp     | The hits that the block can take. 1 to 3 at the start. |

The world has one more value: `score`, the number of hits. It starts at 0.

You can split these fields into components in any way you like. The runner sees only the rows from `snapshot()`.

The constants are in `shared.ts`, the shared code of the game:

| Constant         | Value     | Meaning                                   |
| ---------------- | --------- | ----------------------------------------- |
| COLS, ROWS       | 64, 48    | The number of cells on each axis.         |
| CELL             | 16        | The size of one cell, in pixels.          |
| W, H             | 1024, 768 | The size of the box: `COLS * CELL`, `ROWS * CELL`. |
| BALLS            | 32        | The number of balls. Balls are never destroyed. |
| BLOCKS           | 1500      | The number of blocks at the start.        |
| RESPAWN_PER_TICK | 6         | The number of candidate blocks on each tick. |
| DT               | 1 / 60    | The time of one tick, in seconds.         |

A speed is 180 to 540 pixels for each second, so a ball moves 3 to 9 pixels on each tick. Thus a ball never jumps over a cell. A cell holds at most one block.
The game keeps about 1370 to 1530 blocks, and the score grows the whole run.

**Start.** Call `startRows(scenario.seed)`. It returns `{ balls, blocks }`. Each ball row is `[gameId, x, y, vx, vy]`. Each block row is `[gameId, cx, cy, hp]`. Create one entity for each row. `shared.ts` makes the start values: `x = u * W`, `y = u * H`, and a speed of `(180 + 360 * u) * sign`, where each `u` is a new random float from 0 to 1.

A system is a function that changes the world in one way. An entry can use plain functions for its systems. It does not need the scheduler of the library. Each tick runs 4 systems in this order. The runner gives each system the tick number, from 0:

1. **moveBalls**: for each ball, `x += vx * DT`. If `x < 0`, then `x = -x` and `vx = -vx`. Else if `x > W - 1`, then `x = 2 * (W - 1) - x` and `vx = -vx`. Do the same for `y`, `vy` and `H`.
2. **hitBlocks**: for each ball, find the block in the cell of the ball: `cx == floor(x / CELL)` and `cy == floor(y / CELL)`. If there is one, then `hp -= 1` and `score += 1`. The ball then bounces: if `floor((y - vy * DT) / CELL) != cy`, then `vy = -vy`, else `vx = -vx`.
3. **destroyBroken**: destroy each block with `hp <= 0`.
4. **respawnBlocks**: call `respawnRows(scenario.seed, tick)`. It returns 6 rows `[gameId, cx, cy, hp]`. Create a block for each row whose cell holds no block. Skip the other rows.

A block with `hp <= 0` still counts in hitBlocks, because it dies only in destroyBroken. Thus two balls that hit one block on one tick give 2 points.

**Why order does not matter.** The order of the balls and the blocks in a system has no effect on the result, for three reasons:

- A ball reads only its own fields and the block in its cell. No ball reads another ball.
- hitBlocks does not destroy a block. Each hit takes 1 hp and adds 1 point, and a sum does not change with order.
- The shared code gives each gameId and each respawn cell, and the cells of one tick are all different.

## Part 2: Verification

Entity ids can be reused after destroyBroken, so do not use the entity id as the gameId.

After each tick, the runner calls `snapshot()`. It returns `{ score, balls, blocks }`. `balls` has one row `[gameId, x, y, vx, vy]` for each ball. `blocks` has one row `[gameId, cx, cy, hp]` for each live block. The rows can be in any order.
The runner sorts each list by gameId and makes one list: `[score, ballCount, ...balls, blockCount, ...blocks]`. It then calculates a hash of this list. It does this outside the timed part.

The goldens are in `goldens/bricks*.json`, one file for each scenario and seed. The vanilla entry writes them.
Your entry passes when each hash agrees with the golden. When a hash does not agree, verify shows the first tick that is different.

**Numbers.** The ball fields are floats. The vanilla entry keeps them as JS numbers (64-bit). Store them as 64-bit numbers: a plain array, a `Float64Array`, or the 64-bit type of your library. Use the same expressions as the vanilla entry, with `DT` from `shared.ts`. A 32-bit column changes the values, so the entry fails verify. Some library docs, for example bitecs, use `Float32Array` in their examples. Do not copy that here. In bitecs, use `new Float64Array(4096)` for x, y, vx and vy.

At most about 1530 blocks live at once, and the gameIds go up to about 7600. Size any fixed array for 4096 entities. Entity ids stay below 4096 if the library reuses ids after destroyBroken. Store the gameId as a value, never as an index.

## Add a library

1. Read `entries/vanilla.ts`. Each system is one short function. Import the constants, the two row functions and the types from `../shared.ts`, as `vanilla.ts` does.
2. Run `cd games/bricks && pnpm add <lib>`. Pin a current major version. Start with `node_modules/<lib>/README.md`, then its `docs/` folder. If there is no folder, read the comments in its `.d.ts` files. For large docs, read only the intro and the sections on entities, queries and removal. Do not use a legacy API.
3. Make the file `games/bricks/entries/<lib>.ts`. It must have this default export. Create the world inside `createSim`, never at module scope:

   ```ts
   import { CELL, W, H, startRows, respawnRows, type BricksScenario, type SystemName } from '../shared.ts'

   export default function createSim(scenario: BricksScenario) {
     const systems: Record<SystemName, (tick: number) => void> = { moveBalls, hitBlocks, destroyBroken, respawnBlocks }
     return {
       systems,
       snapshot, // () => ({ score: number, balls: number[][], blocks: number[][] })
       dispose,  // optional: () => void, free the world
     }
   }
   ```

4. Run `pnpm verify <lib> bricks-smoke bricks`. Each line must start with `ok`.
5. Run `pnpm bench vanilla <lib> bricks --runs 3` to get the time. The score divides your time by the time of `vanilla`.

When a tick fails, run `pnpm diff <lib> bricks-smoke 199`. It compares your entry with `vanilla` and stops at the first tick with a different hash. It then shows the first ball or block that is different. A `*` marks each field that is different. This output comes from an entry with `Float32Array` columns:

```
tick 0: hashes differ (vanilla 6aabc9d4, mylib 0621640f)

ball: 32 differing, first below
ball 1
          vanilla                                   other
  gameId  1                                         1
* x       528.9609117312357                         528.9609375
* y       554.8683468243107                         554.8683471679688
* vx      361.702624540776                          361.70263671875
* vy      292.3136302269995                         292.3136291503906
```

The number 199 is the last tick to compare. Add a gameId to the command to show one ball or block, for example `pnpm diff <lib> bricks-smoke 5 40`.

You can destroy a block while you loop over a query if the library allows it. If it does not, collect the entities first, then destroy them. In some libraries, for example bitecs, a query inside a query commits the pending removals. Do not remove entities in a system that nests queries unless the docs say it is safe.

There is no other registration. `pnpm verify <lib>` loads `games/bricks/entries/<lib>.ts`. Use `entries/koota.ts`, `entries/bitecs.ts` or `entries/iris.ts` as a second example.

Every entry does the same game logic as `vanilla.ts` in each system. The block lookup in hitBlocks and the cell check in respawnBlocks stop at the first match. Each loop uses the form that the library recommends for hot loops. If that form cannot express the logic, use the next documented form and add one short comment that says why. Do not keep side lists, grids or maps next to the library.

## Add a game

1. Copy this folder to `games/<game>/` without `node_modules`. Keep `shared.ts`, `package.json`, `entries/vanilla.ts` and `entries/koota.ts`. Remove the other entries.
2. In `package.json`, change the package name to `@ecs-arena/games-<game>`. Run `pnpm install`.
3. Change the game rules in this README, the shared code and the vanilla entry. In `shared.ts`, rename the keys of `SCENARIOS` and each `name` to `<game>` and `<game>-smoke`. A scenario name must be unique in all games.
4. In `packages/spec/src/games.ts`, import `games/<game>/shared.ts` as `<game>Shared`. Add one line, `export const <GAME> = tutorialGame('<game>', <game>Shared)`, and add `<GAME>` to the `GAMES` array.
5. Write the goldens: `pnpm verify vanilla <game>-smoke <game> --write`.
6. Run `pnpm verify vanilla <game>-smoke <game>` and `pnpm verify koota <game>-smoke <game>`. Each line must start with `ok`. Then run `pnpm test`.

`pnpm diff` does not work for a new game. It has no decoder for the rows. Add one to `DECODERS` in `runner/src/diff.ts` if you need it.
