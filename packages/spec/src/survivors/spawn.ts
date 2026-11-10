// Spawning: waves, elites, the boss and the swarmling ring.
import { FX, fx, rand, randInt } from '../kernel.ts'
import { PURPOSE } from './core.ts'
import { ringPoint } from './path.ts'
import { AFFIX_COUNT, MOBS } from './mobs.ts'

/** The mob kinds that spawn from tick `tick`, with `from` scaled by paceScale (permille). Ascending kind. */
export const unlocked = (tick: number, paceScale: number): number[] => {
  const out: number[] = []
  for (let k = 0; k < MOBS.length; k++) if (MOBS[k].weight > 0 && fx.div(MOBS[k].from * paceScale, 1000) <= tick) out.push(k)
  return out
}
const weightedKind = (kinds: readonly number[], r: number): number => {
  let total = 0
  for (const k of kinds) total += MOBS[k].weight
  let v = r % total
  for (const k of kinds) { if (v < MOBS[k].weight) return k; v -= MOBS[k].weight }
  return kinds[kinds.length - 1]
}

export const SPAWN_RING = 12 * FX
export const PACK_BASE = 3
export const PACK_GROWTH_TICKS = 600
export const RING_SWARM = 12
export const RING_SWARM_RADIUS = 8 * FX
export const RING_SWARM_EVERY = 3
/** Angle step between ring swarmlings. The ring start is a draw in 0..RING_SWARM_STEP-1. */
export const RING_SWARM_STEP = 21

/** Kinds to spawn this tick, one per mob, in ring index order. Empty when it is not a spawn tick or the cap is full. */
export const spawnPlan = (seed: number, tick: number, alive: number, mobCap: number, spawnEvery: number, paceScale: number): number[] => {
  if (tick % spawnEvery !== 0 || alive >= mobCap) return []
  const n = Math.min(mobCap - alive, PACK_BASE + Math.floor(tick / PACK_GROWTH_TICKS))
  const kinds = unlocked(tick, paceScale)
  const out: number[] = []
  for (let i = 0; i < n; i++) out.push(weightedKind(kinds, rand(seed, tick, i, PURPOSE.SPAWN_KIND)))
  return out
}
/** Ring angle index of spawn `i` of this tick. */
export const spawnAngle = (seed: number, tick: number, i: number): number => randInt(256, seed, tick, i, PURPOSE.SPAWN_ANGLE)
/** Position of the elite of this tick on the spawn ring around the player at (px, py). */
export const eliteSpawnPoint = (seed: number, tick: number, px: number, py: number): [number, number] =>
  ringPoint(px, py, SPAWN_RING, randInt(256, seed, tick, 0, PURPOSE.SPAWN_ANGLE, 1))
/** Position of the boss of this tick on the spawn ring around the player at (px, py). */
export const bossSpawnPoint = (seed: number, tick: number, px: number, py: number): [number, number] =>
  ringPoint(px, py, SPAWN_RING, randInt(256, seed, tick, 0, PURPOSE.SPAWN_ANGLE, 2))
/** Position of ring swarmling `i` of this tick around the player at (px, py). */
export const ringSwarmPoint = (seed: number, tick: number, px: number, py: number, i: number): [number, number] =>
  ringPoint(px, py, RING_SWARM_RADIUS, (i * RING_SWARM_STEP + randInt(RING_SWARM_STEP, seed, tick, 0, PURPOSE.SCATTER, 0)) & 255)
/** Kind of the elite of this tick. */
export const eliteKind = (seed: number, tick: number, paceScale: number): number =>
  weightedKind(unlocked(tick, paceScale), rand(seed, tick, 0, PURPOSE.ELITE))
/** Affix bit set of an elite with gameId `id`: 1 to 3 distinct affixes. */
export const eliteAffixes = (seed: number, tick: number, id: number): number => {
  let left = (1 << AFFIX_COUNT) - 1
  let out = 0
  const n = 1 + randInt(3, seed, tick, id, PURPOSE.AFFIX, 0)
  for (let j = 0; j < n; j++) {
    let skip = randInt(AFFIX_COUNT - j, seed, tick, id, PURPOSE.AFFIX, 1 + j)
    for (let b = 0; b < AFFIX_COUNT; b++) {
      if (!(left & (1 << b))) continue
      if (skip-- === 0) { out |= 1 << b; left &= ~(1 << b); break }
    }
  }
  return out
}
/** Weave: the sideways phase index of a weaver at a tick. */
export const weaveIndex = (seed: number, id: number, tick: number): number => (tick * 4 + (rand(seed, 0, id, PURPOSE.WEAVE) % 256)) & 255
export const WEAVE_AMP_DIV = 2
