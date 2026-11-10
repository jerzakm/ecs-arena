// Rule tables and pure rule functions of survivors (SPEC-survivors.md). Integer math only. No entity knowledge.
// It reuses the RTS fixed point, counter RNG and render fold. RNG purposes start at 101 so RTS streams stay as they are.
export { FX, ARENA, MAX_COORD, foldRender, RENDER_SEED, fx, isqrt, clampToArena, distSq } from '../kernel.ts'
export * from './core.ts'
export * from './path.ts'
export * from './status.ts'
export * from './mobs.ts'
export * from './spawn.ts'
export * from './upgrades.ts'
export * from './hits.ts'
export * from './render.ts'
export * from './totals.ts'
