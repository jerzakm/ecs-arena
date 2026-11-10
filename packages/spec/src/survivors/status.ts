// Status tags: ids, masks, durations and the merge rule.
import { fx } from '../kernel.ts'

export const STATUS = {
  STUNNED: 0, SLOWED: 1, BURNING: 2, FROZEN: 3, KNOCKBACK: 4, IFRAMES: 5, MARKED: 6, ENRAGED: 7, SHIELDED: 8,
  PHASED: 9, SPAWNING: 10, WINDUP: 11, DASH: 12, RECOVER: 13, FUSE: 14, ELITE: 15, DYING: 16,
} as const
export type StatusId = (typeof STATUS)[keyof typeof STATUS]
export const STATUS_COUNT = Object.keys(STATUS).length
export const bit = (s: StatusId): number => 1 << s

export const UNTIMED = bit(STATUS.ELITE) | bit(STATUS.DYING)
export const BLOCKS_MOVE = bit(STATUS.STUNNED) | bit(STATUS.FROZEN) | bit(STATUS.KNOCKBACK) | bit(STATUS.WINDUP) | bit(STATUS.RECOVER) | bit(STATUS.SPAWNING) | bit(STATUS.DYING)
export const BLOCKS_ACT = bit(STATUS.STUNNED) | bit(STATUS.FROZEN) | bit(STATUS.SPAWNING) | bit(STATUS.DYING)
export const IMMUNE_HIT = bit(STATUS.PHASED) | bit(STATUS.SPAWNING) | bit(STATUS.DYING) | bit(STATUS.IFRAMES)

/** Tag merge rule. A re-apply keeps the larger `until`, so the order of applies does not matter. */
export const mergeUntil = (a: number, b: number): number => (a > b ? a : b)
export const BURN_MAX_STACKS = 5
export const BURN_PERIOD = 6
/** A burning mob lights every mob within this distance (centre to centre) once each FIRE_SPREAD_PERIOD, staggered by gameId. */
export const FIRE_SPREAD_RANGE = 1500
export const FIRE_SPREAD_PERIOD = 24
/** Tag durations in ticks. */
export const DUR = {
  SPAWNING: 15, WINDUP: 20, DASH: 12, RECOVER: 30, FUSE: 20, PHASED: 30, ENRAGED: 300, SHIELDED: 300, STUNNED: 20, SLOWED: 60,
  FROZEN: 30, BURNING: 90, KNOCKBACK: 6, MARKED: 120,
} as const
/** A duration scaled by scenario.tagScale (permille). A higher scale gives shorter tags, so more adds and removes. Never below 1. */
export const tagDuration = (base: number, tagScale: number): number => Math.max(1, fx.div(base * 1000, tagScale))
