// Hit rules, player damage, drops and particles.
import { fx, randInt } from '../kernel.ts'
import { COS, PLAYER_HP_FLOOR, PURPOSE, SIN } from './core.ts'
import { DUR, IMMUNE_HIT, STATUS, bit } from './status.ts'
import type { StatusId } from './status.ts'
import { AFFIX, ARMOR_DMG } from './mobs.ts'
import { CRIT_PERCENT, TRAIT } from './upgrades.ts'

/** Result of a hit on a mob with tag mask `mask`. THE tag interaction table. */
export interface HitOutcome { dmg: number; clear: number; crit: boolean }
export const hitOutcome = (baseDmg: number, mask: number, crit: boolean): HitOutcome => {
  if (mask & IMMUNE_HIT) return { dmg: 0, clear: 0, crit: false }
  let dmg = baseDmg
  let clear = 0
  const c = crit || (mask & bit(STATUS.MARKED)) !== 0
  if (c) dmg *= 2
  if (mask & bit(STATUS.MARKED)) clear |= bit(STATUS.MARKED)
  if (mask & bit(STATUS.FROZEN)) { dmg *= 2; clear |= bit(STATUS.FROZEN) }
  return { dmg, clear, crit: c }
}
/** The random crit draw of a hit. `source` is the projectile gameId, or PLAYER_ID for an aura. */
export const critDraw = (seed: number, tick: number, source: number, mobId: number): boolean =>
  randInt(100, seed, tick, source, PURPOSE.CRIT, mobId) < CRIT_PERCENT
/** Base damage after the ARMORED affix. */
export const armoredDamage = (dmg: number, affix: number): number => (affix & AFFIX.ARMORED ? Math.max(1, dmg - ARMOR_DMG) : dmg)

/** Tags that a hit applies: [status, base duration in ticks, stack delta]. `targetMask` is the mask at the start of `status.apply`. */
export const statusFromTraits = (traits: number, targetMask: number): [StatusId, number, number][] => {
  const out: [StatusId, number, number][] = []
  if (traits & TRAIT.FREEZE) {
    out.push([STATUS.SLOWED, DUR.SLOWED, 0])
    if (targetMask & bit(STATUS.SLOWED)) out.push([STATUS.FROZEN, DUR.FROZEN, 0])
  }
  if (traits & TRAIT.BURN) out.push([STATUS.BURNING, DUR.BURNING, 1])
  if (traits & TRAIT.MARK) out.push([STATUS.MARKED, DUR.MARKED, 0])
  if (traits & TRAIT.KNOCK) out.push([STATUS.KNOCKBACK, DUR.KNOCKBACK, 0])
  if (traits & TRAIT.STUN) out.push([STATUS.STUNNED, DUR.STUNNED, 0])
  return out
}

/** Player damage with the hp floor: returns the new hp. The caller adds the full `dmg` to `dmgTaken`. */
export const damagePlayer = (hp: number, dmg: number): number => Math.max(PLAYER_HP_FLOOR, hp - dmg)
/** A count scaled by a permille knob, rounded to nearest. */
export const scaleCount = (n: number, permille: number): number => fx.div(n * permille + 500, 1000)
export const SPARK_COUNT = 2
export const BURST_COUNT = 3
export const SPARK_LIFE = 4
export const BURST_LIFE = 8
export const PARTICLE_SPEED = 150
const particleVel = (a: number): [number, number] => [fx.mul(COS(a), PARTICLE_SPEED), fx.mul(SIN[a], PARTICLE_SPEED)]
/** Velocity of spark `n` of the mob `id` hurt this tick. */
export const sparkVel = (seed: number, tick: number, id: number, n: number): [number, number] =>
  particleVel(randInt(256, seed, tick, id, PURPOSE.SCATTER, 7 + n))
/** Velocity of burst particle `n` of the mob `id` killed this tick. */
export const burstVel = (seed: number, tick: number, id: number, n: number): [number, number] =>
  particleVel(randInt(256, seed, tick, id, PURPOSE.DROP, 1 + n))
export const PARTICLE_KIND = { SPARK: 0, BURST: 1 } as const
export const PICKUP_KIND = { GEM: 0, HEART: 1, CHEST: 2 } as const
