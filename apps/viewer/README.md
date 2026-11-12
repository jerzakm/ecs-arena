# Viewer

Run it with `pnpm --filter @ecs-arena/viewer dev`. The scenario list has two groups, `rts` and `survivors`. The group picks the game. Every impl plays both games.

A URL such as `?scenario=war&impl=koota` opens that run. The viewer keeps the URL in step with the lists, so you can copy it to share a run. The project page (`site/index.html`) links to the viewer this way.

The factory and bricks games have their own pages: `factory.html` and `bricks.html`. Bricks draws the blocks and balls and runs the `vanilla`, `koota`, `bitecs` and `iris` entries of `games/bricks/entries/`. The game never ends, so the page keeps running after the last tick of the scenario. Example: `bricks.html?scenario=bricks&impl=koota`.

## Change a sprite for a survivors mob kind

All looks are in `src/svlook.ts`. Edit one row of `KIND_LOOK`. The row is indexed by mob kind.

1. Put the sprite sheets in `public/sprites`. The names are `<Set>_Idle.png`, `_Walk.png`, `_Attack01.png`, `_Hurt.png` and `_Death.png`. Each frame is 100 px wide.
2. Add the set name to `SETS` in `src/render.ts` and to the `SpriteSet` type in `src/svlook.ts`.
3. Set `set` in the `KIND_LOOK` row to the new name. Change `scale` and `tint` to taste.

The same file holds the weapon, pickup, particle and state tints.
