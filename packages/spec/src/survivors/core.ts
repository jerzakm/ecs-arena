// Survivors constants shared by every rule module: timing, ids, RNG purposes and the sine table.
import { FX } from '../kernel.ts'

export const TICKS_PER_SEC = 30
export const CAMERA_HALF = 14 * FX
export const PLAYER_ID = 1
export const FIRST_ID = 10
export const PLAYER_HP = 12
export const PLAYER_HP_FLOOR = 1
export const PLAYER_RADIUS = 500
export const VIGOR_HP = 5
export const REGEN_PERIOD = 60
export const IFRAMES_TICKS = 30
export const INF_TTL = 0x7fffffff

export const PURPOSE = {
  SPAWN_ANGLE: 101, SPAWN_KIND: 102, AFFIX: 103, ELITE: 104, AIM: 105, CRIT: 106, DROP: 107, OFFER: 108, SCATTER: 109, WEAVE: 110,
} as const

// tables of sine and cosine
/** SIN[i] = round(sin(2 pi i / 256) * FX). The kernel table is normative. An impl must import it. */
export const SIN: readonly number[] = Array.from({ length: 256 }, (_, i) => Math.round(Math.sin((2 * Math.PI * i) / 256) * FX))
export const COS = (i: number): number => SIN[(i + 64) & 255]
