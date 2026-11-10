// Mob kinds, affixes and the per-kind behaviour numbers.
import { FX, fx } from '../kernel.ts'
import { STATUS, bit } from './status.ts'

export const MOB = {
  BAT: 0, ZOMBIE: 1, WEAVER: 2, CHARGER: 3, SHOOTER: 4, SPLITTER: 5, EXPLODER: 6,
  HEALER: 7, SUMMONER: 8, GHOST: 9, SWARMLING: 10, BOSS: 11,
} as const
export type MobKind = (typeof MOB)[keyof typeof MOB]
export type MoveKind = 'chase' | 'weave' | 'charge' | 'kite'
export const HAS = { AURA: 1, SHOOT: 2, SUMMON: 4, PHASE: 8, CHARGE: 16, FUSE: 32, BOSSPHASE: 64 } as const
export type DeathRule = 'none' | 'split' | 'explode' | 'drop-heart' | 'cascade'
export interface MobDef {
  hp: number; speed: number; contact: number; radius: number
  move: MoveKind; has: number; death: DeathRule
  from: number; weight: number
  xp: number
}
export const MOBS: readonly MobDef[] = [
  /* BAT      */ { hp: 18, speed: 90,  contact: 1, radius: 400,  move: 'chase',  has: 0,          death: 'none',    from: 0,    weight: 40, xp: 1 },
  /* ZOMBIE   */ { hp: 144, speed: 36,  contact: 3, radius: 600,  move: 'chase',  has: 0,          death: 'none',    from: 0,    weight: 30, xp: 2 },
  /* WEAVER   */ { hp: 48, speed: 70,  contact: 2, radius: 450,  move: 'weave',  has: 0,          death: 'none',    from: 300,  weight: 20, xp: 2 },
  /* CHARGER  */ { hp: 84, speed: 50,  contact: 4, radius: 550,  move: 'charge', has: HAS.CHARGE, death: 'none',    from: 500,  weight: 14, xp: 3 },
  /* SHOOTER  */ { hp: 60, speed: 45,  contact: 1, radius: 450,  move: 'kite',   has: HAS.SHOOT,  death: 'none',    from: 700,  weight: 12, xp: 3 },
  /* SPLITTER */ { hp: 108, speed: 40,  contact: 2, radius: 600,  move: 'chase',  has: 0,          death: 'split',   from: 900,  weight: 10, xp: 3 },
  /* EXPLODER */ { hp: 36, speed: 80,  contact: 0, radius: 500,  move: 'chase',  has: HAS.FUSE,   death: 'explode', from: 1100, weight: 8,  xp: 2 },
  /* HEALER   */ { hp: 96, speed: 30,  contact: 1, radius: 500,  move: 'kite',   has: HAS.AURA,   death: 'none',    from: 1300, weight: 5,  xp: 4 },
  /* SUMMONER */ { hp: 60,  speed: 25,  contact: 2, radius: 700,  move: 'kite',   has: HAS.SUMMON, death: 'cascade', from: 1600, weight: 3,  xp: 8 },
  /* GHOST    */ { hp: 72, speed: 55,  contact: 2, radius: 450,  move: 'chase',  has: HAS.PHASE,  death: 'none',    from: 2000, weight: 6,  xp: 4 },
  /* SWARMLING*/ { hp: 24,  speed: 100, contact: 1, radius: 300,  move: 'chase',  has: 0,          death: 'none',    from: 0,    weight: 0,  xp: 0 },
  /* BOSS     */ { hp: 600, speed: 40,  contact: 6, radius: 1400, move: 'chase',  has: HAS.SHOOT | HAS.BOSSPHASE | HAS.SUMMON, death: 'drop-heart', from: 0, weight: 0, xp: 60 },
]
export const ELITE_HP_MULT = 3
export const ELITE_XP_MULT = 3
export const SHIELD_VALUE = 10
export const AFFIX = { SWIFT: 1, ARMORED: 2, VAMPIRIC: 4, SCORCHING: 8, FRENZIED: 16, SHIELDED: 32 } as const
export const AFFIX_COUNT = Object.keys(AFFIX).length
export const ARMOR_DMG = 2
export const VAMPIRIC_HEAL = 2
export const SCORCH_RANGE = 3 * FX
export const SCORCH_PERIOD = 10

/** Maximum hp of a mob from its kind and its ELITE tag. */
export const mobMaxHp = (kind: number, flags: number): number => MOBS[kind].hp * (flags & bit(STATUS.ELITE) ? ELITE_HP_MULT : 1)
/** Units per tick. SWIFT and ENRAGED each multiply by 3/2 (truncated, in that order). SLOWED halves (truncated). */
export const mobSpeed = (kind: number, affix: number, flags: number): number => {
  let s = MOBS[kind].speed
  if (affix & AFFIX.SWIFT) s = fx.div(s * 3, 2)
  if (flags & bit(STATUS.ENRAGED)) s = fx.div(s * 3, 2)
  if (flags & bit(STATUS.SLOWED)) s = fx.div(s, 2)
  return s
}
// mob behaviour numbers
export const CHARGE_RANGE = 8 * FX
export const CHARGE_SPEED = 220
export const KITE_FAR = 9 * FX
export const KITE_NEAR = 7 * FX
export const SHOOT_PERIOD = 45
export const HOSTILE_SPEED = 70
export const HOSTILE_LIFE = 200
export const HOSTILE_DAMAGE = 14
export const SUMMON_PERIOD = 45
export const SUMMON_CAP = 6
export const SUMMON_BATCH = 2
export const HEAL_PERIOD = 15
export const HEAL_RANGE = 5 * FX
export const HEAL_AMOUNT = 4
export const HEAL_TARGETS = 2
export const FUSE_RANGE = 2 * FX
export const BLAST_RADIUS = 2 * FX
export const EXPLODER_BLAST = 2.5 * FX
export const EXPLODER_DAMAGE = 6
export const KNOCK_SPEED = 200
export const GHOST_PERIOD = 90
export const BOSS_PHASE_SHOOT = 1
export const BOSS_PHASE_SUMMON = 2
/** Boss phase from hp: 0 above 2/3, 1 above 1/3, else 2. Never goes back down. */
export const bossPhase = (hp: number, maxHp: number, current: number): number =>
  Math.max(current, hp * 3 <= maxHp ? 2 : hp * 3 <= maxHp * 2 ? 1 : 0)
