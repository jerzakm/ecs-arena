// SPEC.md §1-§7: pure functions and rule tables only. No entity knowledge, no Node APIs.

export const FX = 1024
export const ARENA_TILES = 256
export const ARENA = ARENA_TILES * FX
export const MAX_COORD = ARENA - 1

export const fx = {
  // + 0 turns -0 into 0
  div: (a: number, b: number): number => Math.trunc(a / b) + 0,
  mul: (a: number, b: number): number => Math.trunc((a * b) / FX) + 0,
}

export const distSq = (ax: number, ay: number, bx: number, by: number): number => {
  const dx = ax - bx
  const dy = ay - by
  return dx * dx + dy * dy
}

/** Exact floor(sqrt(n)) for 0 <= n < 2^53. Math.sqrt seeds a guess, the loops make it exact. */
export const isqrt = (n: number): number => {
  let s = Math.floor(Math.sqrt(n))
  while (s * s > n) s--
  while ((s + 1) * (s + 1) <= n) s++
  return s
}

export const clampToArena = (v: number): number => (v < 0 ? 0 : v > MAX_COORD ? MAX_COORD : v)

/** SPEC §6.3, including the clamp. Returns [x, y]. */
export const stepToward = (x: number, y: number, tx: number, ty: number, speed: number): [number, number] => {
  const dx = tx - x
  const dy = ty - y
  const d2 = dx * dx + dy * dy
  if (d2 <= speed * speed) return [clampToArena(tx), clampToArena(ty)]
  const d = isqrt(d2)
  return [clampToArena(x + fx.div(dx * speed, d)), clampToArena(y + fx.div(dy * speed, d))]
}

export const damage = (attack: number, armor: number, crit: boolean): number =>
  Math.max(1, attack - armor) * (crit ? 2 : 1)

// SPEC §2
export const fmix32 = (h: number): number => {
  h ^= h >>> 16
  h = Math.imul(h, 0x85ebca6b)
  h ^= h >>> 13
  h = Math.imul(h, 0xc2b2ae35)
  h ^= h >>> 16
  return h >>> 0
}

export const rand = (seed: number, tick: number, gameId: number, purpose: number, salt = 0): number =>
  fmix32(fmix32(fmix32(fmix32(fmix32(seed) ^ tick) ^ gameId) ^ purpose) ^ salt)

export const randInt = (n: number, seed: number, tick: number, gameId: number, purpose: number, salt = 0): number =>
  rand(seed, tick, gameId, purpose, salt) % n

export const teamGameId = (team: number): number => 0xffffff00 + team

export const PURPOSE = { SQUAD_KIND: 1, SPAWN_Y: 2, ITEM_COUNT: 3, ITEM_KIND: 4, ITEM_QUALITY: 5, CRIT: 6 } as const

// SPEC §3
export const KIND = { WARRIOR: 0, ARCHER: 1, MAGE: 2, HEALER: 3, SUMMONER: 4, MINION: 5, PROJECTILE: 6, ITEM: 7 } as const

/** Buff kind ids follow the order of the §6.5 table. The spec does not number them (see report). */
export const BUFF = { STUN: 0, BURN: 1, HASTE: 2 } as const
export const BUFF_DURATION = [20, 60, 40] as const
export const BURN_DAMAGE = 2
export const BURN_INTERVAL = 10

export interface UnitStats {
  maxHp: number
  attack: number
  armor: number
  /** fixed point units */
  range: number
  /** fixed point units */
  sight: number
  cooldown: number
  speed: number
}
const u = (maxHp: number, attack: number, armor: number, rangeTiles: number, sightTiles: number, cooldown: number, speed: number): UnitStats =>
  ({ maxHp, attack, armor, range: rangeTiles * FX, sight: sightTiles * FX, cooldown, speed })

/** Indexed by KIND 0..5. The summoner has no range, so 0. */
export const UNIT_STATS: readonly UnitStats[] = [
  u(200, 14, 4, 1.5, 12, 20, 96),
  u(80, 10, 1, 8, 14, 30, 80),
  u(70, 9, 0, 7, 14, 45, 80),
  u(90, 15, 1, 6, 10, 40, 80),
  u(100, 0, 2, 0, 12, 120, 72),
  u(30, 5, 0, 1.5, 10, 20, 112),
]

export const PROJECTILE_SPEED = 512
export const PROJECTILE_LIFETIME = 60
export const SPLASH_RADIUS = 2 * FX
export const SUMMON_PERIOD = 120
export const MAX_MINIONS = 3
export const MINION_LIFETIME = 300
export const GROUND_ITEM_LIFETIME = 300
export const PICKUP_RANGE = 1.5 * FX
export const MAX_ITEMS = 3
export const CRIT_PERCENT = 10
export const CRIT_STUN_KIND = BUFF.STUN

// SPEC §5
export const SQUADS: readonly { leader: number; members: readonly number[] }[] = [
  { leader: KIND.WARRIOR, members: [0, 0, 0, 0, 1, 1] },
  { leader: KIND.WARRIOR, members: [0, 0, 1, 1, 1, 1] },
  { leader: KIND.WARRIOR, members: [1, 1, 2, 2, 3] },
  { leader: KIND.SUMMONER, members: [0, 0, 0, 3] },
]
export const SPAWN_X = [4 * FX, 252 * FX] as const
export const SPAWN_Y_MIN = 16 * FX
export const SPAWN_Y_RANGE = 224
export const FORMATION_SPACING = 2 * FX

export const ITEMS: readonly { attack: number; armor: number; speed: number }[] = [
  { attack: 3, armor: 0, speed: 0 },
  { attack: 5, armor: 0, speed: -8 },
  { attack: 0, armor: 3, speed: -8 },
  { attack: 0, armor: 2, speed: 0 },
  { attack: 0, armor: 0, speed: 16 },
  { attack: 2, armor: 0, speed: 0 },
  { attack: 1, armor: 1, speed: 4 },
  { attack: 0, armor: 1, speed: 8 },
]

/** SPEC §7.1 */
export const isCrit = (seed: number, tick: number, attackerGameId: number): boolean =>
  randInt(100, seed, tick, attackerGameId, PURPOSE.CRIT) < CRIT_PERCENT
