// The player path and the integer geometry helpers.
import { FX, clampToArena, fx, isqrt } from '../kernel.ts'
import { COS, SIN } from './core.ts'

export const PATH_TILES: readonly (readonly [number, number])[] = [
  [140, 128], [137, 137], [128, 140], [119, 137], [116, 128], [119, 119], [128, 116], [137, 119],
]
export const PATH_SEG_TICKS = 230
export const PATH_PERIOD = PATH_TILES.length * PATH_SEG_TICKS
/** Player position at tick t. A closed loop through the waypoint table. No input, no state. */
export const playerPos = (tick: number): [x: number, y: number] => {
  const t = tick % PATH_PERIOD
  const seg = Math.floor(t / PATH_SEG_TICKS)
  const ph = t - seg * PATH_SEG_TICKS
  const [ax, ay] = PATH_TILES[seg]
  const [bx, by] = PATH_TILES[(seg + 1) % PATH_TILES.length]
  return [ax * FX + fx.div((bx - ax) * FX * ph, PATH_SEG_TICKS), ay * FX + fx.div((by - ay) * FX * ph, PATH_SEG_TICKS)]
}
/** Unit vector (length FX) of the player move at tick t. (FX, 0) when the player does not move. */
export const facing = (tick: number): [number, number] => {
  const [x, y] = playerPos(tick)
  const [px, py] = playerPos(tick > 0 ? tick - 1 : 0)
  const dx = x - px, dy = y - py
  const d = isqrt(dx * dx + dy * dy)
  return d === 0 ? [FX, 0] : [fx.div(dx * FX, d), fx.div(dy * FX, d)]
}

// geometry helpers
/** Velocity toward a point with length `speed`. It is the whole offset when the point is nearer than `speed`. */
export const velToward = (x: number, y: number, tx: number, ty: number, speed: number): [number, number] => {
  const dx = tx - x, dy = ty - y
  const d2 = dx * dx + dy * dy
  if (d2 <= speed * speed) return [dx, dy]
  const d = isqrt(d2)
  return [fx.div(dx * speed, d), fx.div(dy * speed, d)]
}
/** Position after a step of `speed` toward a point, clamped to the arena. */
export const stepTo = (x: number, y: number, tx: number, ty: number, speed: number): [number, number] => {
  const [vx, vy] = velToward(x, y, tx, ty, speed)
  return [clampToArena(x + vx), clampToArena(y + vy)]
}
/** Point on a ring around (cx, cy). `a` is the angle index 0..255. Clamped to the arena. */
export const ringPoint = (cx: number, cy: number, radius: number, a: number): [number, number] =>
  [clampToArena(cx + fx.mul(COS(a), radius)), clampToArena(cy + fx.mul(SIN[a & 255], radius))]
