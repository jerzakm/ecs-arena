// The one place that says how survivors things look. To change a mob's sprite, edit its row in KIND_LOOK.
// See README.md in apps/viewer.
import { survivors } from '@ecs-arena/spec'

const { MOB, STATUS } = survivors.kernel

/** Sprite sets that exist in public/sprites. A new set also needs an entry in SETS in render.ts. */
export type SpriteSet = 'Soldier' | 'Orc' | 'Demon_A' | 'Blood_Monster_A'
type Rgba = readonly [r: number, g: number, b: number, a: number]

export interface KindLook {
  set: SpriteSet
  /** Multiplies the base sprite size. */
  scale: number
  /** Colour that mixes into the sprite. The last number is the strength from 0 to 1. */
  tint: Rgba
  /** The group that the HUD counts the kind in. */
  group: 'fodder' | 'runner' | 'ranged' | 'special' | 'boss'
}

/** Indexed by mob kind (MOB in the survivors kernel). */
export const KIND_LOOK: readonly KindLook[] = [
  /* BAT       */ { set: 'Demon_A', scale: 0.6, tint: [0.7, 0.3, 1, 0.45], group: 'fodder' },
  /* ZOMBIE    */ { set: 'Orc', scale: 1, tint: [0.4, 0.9, 0.3, 0.4], group: 'fodder' },
  /* WEAVER    */ { set: 'Blood_Monster_A', scale: 0.7, tint: [0.2, 0.9, 0.9, 0.4], group: 'runner' },
  /* CHARGER   */ { set: 'Orc', scale: 1.15, tint: [1, 0.2, 0.2, 0.45], group: 'runner' },
  /* SHOOTER   */ { set: 'Demon_A', scale: 0.9, tint: [1, 0.9, 0.2, 0.4], group: 'ranged' },
  /* SPLITTER  */ { set: 'Blood_Monster_A', scale: 1, tint: [1, 0.3, 0.8, 0.4], group: 'special' },
  /* EXPLODER  */ { set: 'Blood_Monster_A', scale: 0.8, tint: [1, 0.55, 0.1, 0.5], group: 'special' },
  /* HEALER    */ { set: 'Demon_A', scale: 0.9, tint: [0.5, 1, 0.6, 0.5], group: 'ranged' },
  /* SUMMONER  */ { set: 'Demon_A', scale: 1.4, tint: [0.45, 0.2, 0.8, 0.5], group: 'ranged' },
  /* GHOST     */ { set: 'Orc', scale: 0.9, tint: [0.8, 0.85, 1, 0.65], group: 'runner' },
  /* SWARMLING */ { set: 'Blood_Monster_A', scale: 0.4, tint: [1, 0.2, 0.2, 0.3], group: 'fodder' },
  /* BOSS      */ { set: 'Demon_A', scale: 3.5, tint: [0.8, 0.05, 0.05, 0.35], group: 'boss' },
]
if (KIND_LOOK.length !== survivors.kernel.MOBS.length || KIND_LOOK[MOB.BOSS].group !== 'boss') throw new Error('KIND_LOOK must have one row per mob kind')

export const PLAYER_KIND = 100
export const PLAYER_LOOK = { set: 'Soldier', scale: 1.3 } as const

/** Mob tag to tint. A later row wins. Stunned flickers instead of tinting. */
export const STATE_TINT = {
  frozen: [0.3, 0.6, 1, 0.75],
  burning: [1, 0.5, 0.1, 0.6],
  flicker: [1, 1, 1, 0.85],
} as const satisfies Record<string, Rgba>
export const ELITE_RGB = [1, 0.8, 0.15] as const
export const SHIELD_RGB = [0.4, 0.85, 1] as const

export interface WeaponLook {
  rgb: readonly [number, number, number]
  /** Glow size in tiles, or the arrow length when `arrow` is true. */
  size: number
  /** Draw Arrow01 rotated to the velocity. Else draw a glow. */
  arrow: boolean
}
const glow = (rgb: WeaponLook['rgb'], size: number): WeaponLook => ({ rgb, size, arrow: false })
const arrow = (rgb: WeaponLook['rgb'], size: number): WeaponLook => ({ rgb, size, arrow: true })
/** Indexed by upgrade id of the weapon (0 to 7 weapons, 20 to 25 evolutions). */
export const WEAPON_LOOK: Readonly<Record<number, WeaponLook>> = {
  0: arrow([0.5, 0.8, 1], 3), 1: glow([1, 1, 0.8], 3.5), 2: glow([0.6, 1, 0.9], 1.6), 3: glow([0.8, 0.5, 1], 2),
  4: arrow([1, 0.7, 0.3], 3), 5: glow([1, 0.45, 0.1], 2), 6: arrow([0.9, 0.9, 1], 3), 7: glow([1, 0.95, 0.3], 2.4),
  20: arrow([0.5, 1, 1], 4), 21: glow([1, 0.4, 0.1], 4.5), 22: glow([1, 0.9, 0.5], 2), 23: glow([0.9, 0.6, 1], 3),
  24: arrow([1, 0.5, 0.2], 4), 25: glow([1, 0.9, 0.4], 3),
}
export const HOSTILE_LOOK = glow([1, 0.2, 0.2], 1.4)

/** Pickups by kind: 0 gem, 1 heart, 2 chest. `icon` is a cell name of the icon atlas in render.ts. */
export const PICKUP_LOOK = [
  { icon: 'diamond', rgb: [0.3, 1, 0.6], size: 0.7 },
  { icon: 'cross', rgb: [1, 0.3, 0.35], size: 1.1 },
  { icon: 'star', rgb: [1, 0.85, 0.1], size: 1.5 },
] as const
/** Particles by kind: 0 spark, 1 burst. Drawn as small glows. */
export const PARTICLE_LOOK = [
  { rgb: [1, 0.95, 0.5], size: 0.6 },
  { rgb: [1, 0.55, 0.2], size: 0.9 },
] as const

export const TAG = {
  stunned: 1 << STATUS.STUNNED,
  burning: 1 << STATUS.BURNING,
  frozen: 1 << STATUS.FROZEN,
  iframes: 1 << STATUS.IFRAMES,
  shielded: 1 << STATUS.SHIELDED,
  spawning: 1 << STATUS.SPAWNING,
  elite: 1 << STATUS.ELITE,
} as const
