// Pure functions and rule tables from SPEC.md. No entity knowledge, no Node APIs.

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

/** SPEC §6.3 stepToward, including the clamp. Returns [x, y]. */
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

export const PURPOSE = {
  SQUAD_KIND: 1, SPAWN_Y: 2, ITEM_COUNT: 3, ITEM_KIND: 4, ITEM_QUALITY: 5, CRIT: 6, SURGE_KIND: 7, SURGE_Y: 8,
} as const

export const KIND = {
  WARRIOR: 0, ARCHER: 1, MAGE: 2, HEALER: 3, SUMMONER: 4, MINION: 5, PROJECTILE: 6, ITEM: 7, WARLORD: 8, SHRINE: 9,
} as const

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

/** Indexed by unit KIND: 0-5 and 8. The summoner has no range, so 0. */
export const UNIT_STATS: Readonly<Record<number, UnitStats>> = {
  [KIND.WARRIOR]: u(200, 14, 4, 1.5, 8, 20, 448),
  [KIND.ARCHER]: u(80, 10, 1, 8, 10, 30, 416),
  [KIND.MAGE]: u(70, 9, 0, 7, 10, 45, 416),
  [KIND.HEALER]: u(90, 15, 1, 6, 8, 40, 416),
  [KIND.SUMMONER]: u(100, 0, 2, 0, 8, 120, 352),
  [KIND.MINION]: u(30, 5, 0, 1.5, 8, 20, 512),
  [KIND.WARLORD]: u(400, 20, 6, 1.5, 10, 25, 416),
}

export const PROJECTILE_SPEED = 2048
export const PROJECTILE_LIFETIME = 60
export const VOLLEY_SIZE = 3
export const VOLLEY_SPEED_STEP = 256
export const SPLASH_RADIUS = 2 * FX
export const SUMMON_PERIOD = 120
export const MAX_MINIONS = 3
export const MINION_LIFETIME = 300
export const GROUND_ITEM_LIFETIME = 300
export const PICKUP_RANGE = 1.5 * FX
export const MAX_ITEMS = 3
export const CRIT_PERCENT = 10
export const THINK_INTERVAL = 4

export const THREAT_MAX_EDGES = 4
export const THREAT_RETALIATE = 20
export const THREAT_DECAY_PERIOD = 20
export const THREAT_CLAMP = 1_000_000

export const WARLORD_LOSS = 2
export const ROUT_LOST_PER_SIZE = [2, 3] as const

export const VETERAN_KILLS = 3
export const VETERAN_ATTACK_STEP = 2
export const VETERAN_MAX_STEPS = 3
export const CHRONICLE_MAX = 4
export const PROMOTION_MARK = -1

export const SHRINE_COUNT = 7
export const SHRINE_X = 128 * FX
export const shrineY = (i: number): number => (16 + 32 * i) * FX
export const SHRINE_RADIUS = 4 * FX
export const SHRINE_PROGRESS_MAX = 200
export const SHRINE_STEP_MAX = 5

export const SQUADS_PER_WARBAND = 4
export const SQUADS: readonly { leader: number; members: readonly number[] }[] = [
  { leader: KIND.WARRIOR, members: [0, 0, 0, 0, 1, 1] },
  { leader: KIND.WARRIOR, members: [0, 0, 1, 1, 1, 1] },
  { leader: KIND.WARRIOR, members: [1, 1, 2, 2, 3] },
  { leader: KIND.SUMMONER, members: [0, 0, 4, 3] },
]
export const SPAWN_X = [4 * FX, 252 * FX] as const
export const SPAWN_Y_MIN = 16 * FX
export const SPAWN_Y_RANGE = 224
export const WARLORD_SPAWN_GAP = 4 * FX
export const LEADER_SLOT_SPACING = 4 * FX
export const FORMATION_SPACING = 2 * FX

export const ITEMS: readonly { attack: number; armor: number; speed: number }[] = [
  { attack: 3, armor: 0, speed: 0 },
  { attack: 5, armor: 0, speed: -32 },
  { attack: 0, armor: 3, speed: -32 },
  { attack: 0, armor: 2, speed: 0 },
  { attack: 0, armor: 0, speed: 64 },
  { attack: 2, armor: 0, speed: 0 },
  { attack: 1, armor: 1, speed: 16 },
  { attack: 0, armor: 1, speed: 32 },
]

export const ITEM_KIND = { SWORD: 0, AXE: 1, SHIELD: 2, HELM: 3, BOOTS: 4, BOW: 5, RING: 6, CLOAK: 7 } as const
export const ITEM_KINDS = 8

/** SPEC §4 set bonuses. A unit gets one when it has both item tags of the set. */
export const SETS: readonly { items: readonly [number, number]; attack: number; armor: number; speed: number }[] = [
  { items: [ITEM_KIND.SWORD, ITEM_KIND.SHIELD], attack: 0, armor: 2, speed: 0 },
  { items: [ITEM_KIND.AXE, ITEM_KIND.BOOTS], attack: 3, armor: 0, speed: 0 },
  { items: [ITEM_KIND.BOW, ITEM_KIND.CLOAK], attack: 0, armor: 0, speed: 32 },
  { items: [ITEM_KIND.HELM, ITEM_KIND.RING], attack: 1, armor: 1, speed: 0 },
]

export interface SetBonus { attack: number; armor: number; speed: number }

/** Set bonus by item tag mask (bit k = item kind k). Each set counts once. */
export const SET_BONUS: readonly SetBonus[] = Array.from({ length: 1 << ITEM_KINDS }, (_, mask) => {
  const b = { attack: 0, armor: 0, speed: 0 }
  for (const s of SETS) {
    if (!(mask & (1 << s.items[0])) || !(mask & (1 << s.items[1]))) continue
    b.attack += s.attack; b.armor += s.armor; b.speed += s.speed
  }
  return b
})

/** SPEC §6.4 step 1: a volley projectile deals half damage, at least 1. */
export const volleyDamage = (attack: number, armor: number, crit: boolean): number =>
  Math.max(1, fx.div(damage(attack, armor, crit), 2))

/** SPEC §7.1 */
export const isCrit = (seed: number, tick: number, attackerGameId: number): boolean =>
  randInt(100, seed, tick, attackerGameId, PURPOSE.CRIT) < CRIT_PERCENT
