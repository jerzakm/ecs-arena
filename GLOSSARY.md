# Glossary

This page defines the terms that all games of ecs-arena share. [CONTEXT.md](CONTEXT.md) holds the terms of the RTS game.

**Entry**:
The code of one library for one game. For bricks, an entry is one file, `games/bricks/entries/<lib>.ts`.

**Vanilla entry**:
Uses plain JS and no library. It defines the game, it writes the goldens, and each score divides by its time. For bricks, it is `games/bricks/entries/vanilla.ts`. For the large games, `baseline-js` is the vanilla entry.

**Tick**:
One step of game time.

**System**:
A function that changes the world in one way. Each tick runs the systems of a game in a fixed order. Bricks has 4 systems: moveBalls, hitBlocks, destroyBroken and respawnBlocks.

**Churn**:
Many creates and destroys of entities, or many adds and removes of components, on each tick.

**Tag**:
A component with no data. An entity has the tag or does not have it.

**Shared code**:
The code that every entry of a game imports: constants, start data, random draws and scenarios. For bricks, it is `games/bricks/shared.ts`.

**Row**:
A list of the field values of one entity, for example `[gameId, cx, cy, hp]` for a block. The shared code gives the start rows, and a snapshot returns rows.

**gameId**:
The identity of an entity that the shared code gives it. The native entity ID of a library is never a gameId.

**Snapshot**:
The state that an entry returns after a tick. The runner sorts it by gameId and hashes it.

**Golden**:
A committed file in `goldens/` that holds the hash of each tick for one scenario and one seed.

**Scenario**:
A named game setup: a tick count and, for the large games, the sizes of the world. For example `bricks` or `bricks-smoke`. Scenario names are unique across all games.

**Smoke scenario**:
A short scenario for a fast check. Its name ends in `-smoke`, and it does not count in the score.

**Seed**:
A number that sets all random draws of a run. Verify uses 3 seeds for each scenario. Timing uses the first seed.

**Main entry**:
An entry that does the same game logic as the baseline. Each loop uses the form that the library recommends for hot loops. A workaround, when needed, carries one short comment. The score of a library comes from this entry.

**Tuned entry**:
An optional entry that uses any public API for maximum speed. The results show it apart from the main entry.

## Old words in the large games

The code and docs of the RTS, survivors and factory games still use old words:

- "phase" means system.
- "kernel" means shared code.
- `baseline-js` is the vanilla entry.
