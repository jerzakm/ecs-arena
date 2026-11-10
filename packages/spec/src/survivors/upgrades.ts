// Weapons, passives and evolutions: the table, the loadout, offers and the weapon draws.
import { FX, clampToArena, fx, randInt } from '../kernel.ts'
import { COS, PLAYER_HP, PLAYER_ID, PURPOSE, SIN, VIGOR_HP } from './core.ts'
import { MOB } from './mobs.ts'

export const TRAIT = {
  PIERCE: 1, BOUNCE: 2, HOMING: 4, SPLIT: 8, EXPLODE: 16, CHAIN: 32, RETURN: 64, FREEZE: 128, BURN: 256, MARK: 512, KNOCK: 1024, STUN: 2048,
} as const
export type AimMode = 'nearest' | 'random' | 'facing' | 'orbit' | 'aura' | 'drop' | 'rain'
export const TRAIT_COUNT = 12
export type StatKey = 'might' | 'haste' | 'reach' | 'velocity' | 'magnet' | 'amount' | 'vigor' | 'greed'
interface WeaponBase {
  id: number; name: string; maxLevel: number
  aim: AimMode; cooldown: number; damage: number; speed: number; life: number; count: number; area?: number; traits: number
}
export interface WeaponDef extends WeaponBase { kind: 'weapon' }
/** An evolution replaces the maxed weapon `from` when the passive `needs` is held. */
export interface EvolutionDef extends WeaponBase { kind: 'evolution'; from: number; needs: number }
export type PassiveGrant = { stat: StatKey; perLevel: number } | { trait: number }
export interface PassiveDef { id: number; kind: 'passive'; name: string; maxLevel: number; grants: PassiveGrant }
export type UpgradeDef = WeaponDef | PassiveDef | EvolutionDef
export type UpgradeKind = UpgradeDef['kind']
export const UPGRADES: readonly UpgradeDef[] = [
  { id: 0, kind: 'weapon', name: 'Bolt',      maxLevel: 3, aim: 'nearest', cooldown: 10, damage: 8,  speed: 420, life: 40,  count: 2, traits: TRAIT.HOMING | TRAIT.BURN },
  { id: 1, kind: 'weapon', name: 'Whip',      maxLevel: 5, aim: 'facing',  cooldown: 36, damage: 9,  speed: 0,   life: 4,   count: 1, area: 1200, traits: TRAIT.PIERCE | TRAIT.KNOCK },
  { id: 2, kind: 'weapon', name: 'Blades',    maxLevel: 5, aim: 'orbit',   cooldown: 0,  damage: 4,  speed: 0,   life: 0,   count: 2, area: 500, traits: TRAIT.PIERCE },
  { id: 3, kind: 'weapon', name: 'Pulse',     maxLevel: 3, aim: 'aura',    cooldown: 4,  damage: 1,  speed: 0,   life: 0,   count: 1, area: 12000, traits: TRAIT.FREEZE },
  { id: 4, kind: 'weapon', name: 'Boomerang', maxLevel: 5, aim: 'random',  cooldown: 48, damage: 8,  speed: 360, life: 50,  count: 1, traits: TRAIT.RETURN | TRAIT.PIERCE },
  { id: 5, kind: 'weapon', name: 'Mines',     maxLevel: 5, aim: 'drop',    cooldown: 60, damage: 14, speed: 0,   life: 150, count: 1, traits: TRAIT.EXPLODE },
  { id: 6, kind: 'weapon', name: 'Arc',       maxLevel: 5, aim: 'nearest', cooldown: 54, damage: 7,  speed: 600, life: 12,  count: 1, traits: TRAIT.CHAIN },
  { id: 7, kind: 'weapon', name: 'Storm',     maxLevel: 5, aim: 'rain',    cooldown: 72, damage: 10, speed: 0,   life: 20,  count: 3, traits: TRAIT.EXPLODE | TRAIT.STUN },
  { id: 8,  kind: 'passive', name: 'Might',    maxLevel: 5, grants: { stat: 'might',    perLevel: 100 } },
  { id: 9,  kind: 'passive', name: 'Haste',    maxLevel: 5, grants: { stat: 'haste',    perLevel: 80 } },
  { id: 10, kind: 'passive', name: 'Reach',    maxLevel: 5, grants: { stat: 'reach',    perLevel: 100 } },
  { id: 11, kind: 'passive', name: 'Velocity', maxLevel: 5, grants: { stat: 'velocity', perLevel: 100 } },
  { id: 12, kind: 'passive', name: 'Magnet',   maxLevel: 5, grants: { stat: 'magnet',   perLevel: 400 } },
  { id: 13, kind: 'passive', name: 'Amount',   maxLevel: 3, grants: { stat: 'amount',   perLevel: 1 } },
  { id: 14, kind: 'passive', name: 'Vigor',    maxLevel: 5, grants: { stat: 'vigor',    perLevel: 1 } },
  { id: 15, kind: 'passive', name: 'Greed',    maxLevel: 5, grants: { stat: 'greed',    perLevel: 150 } },
  { id: 16, kind: 'passive', name: 'Frost',    maxLevel: 3, grants: { trait: TRAIT.FREEZE } },
  { id: 17, kind: 'passive', name: 'Ember',    maxLevel: 3, grants: { trait: TRAIT.BURN } },
  { id: 18, kind: 'passive', name: 'Ricochet', maxLevel: 3, grants: { trait: TRAIT.BOUNCE | TRAIT.MARK } },
  { id: 19, kind: 'passive', name: 'Splinter', maxLevel: 3, grants: { trait: TRAIT.SPLIT } },
  { id: 20, kind: 'evolution', name: 'Glacial Lance', maxLevel: 1, from: 0, needs: 16, aim: 'nearest', cooldown: 14, damage: 12, speed: 520, life: 50, count: 2, traits: TRAIT.HOMING | TRAIT.PIERCE | TRAIT.FREEZE },
  { id: 21, kind: 'evolution', name: 'Serpent',       maxLevel: 1, from: 1, needs: 17, aim: 'facing',  cooldown: 24, damage: 16, speed: 0,   life: 6,  count: 2, area: 1600, traits: TRAIT.PIERCE | TRAIT.KNOCK | TRAIT.BURN },
  { id: 22, kind: 'evolution', name: 'Halo',          maxLevel: 1, from: 2, needs: 10, aim: 'orbit',   cooldown: 0,  damage: 8,  speed: 0,   life: 0,  count: 6, area: 600, traits: TRAIT.PIERCE | TRAIT.SPLIT },
  { id: 23, kind: 'evolution', name: 'Nova',          maxLevel: 1, from: 3, needs: 9,  aim: 'aura',    cooldown: 10, damage: 6,  speed: 0,   life: 0,  count: 1, area: 5000, traits: TRAIT.STUN },
  { id: 24, kind: 'evolution', name: 'Comet',         maxLevel: 1, from: 4, needs: 18, aim: 'random',  cooldown: 30, damage: 14, speed: 440, life: 60, count: 3, traits: TRAIT.RETURN | TRAIT.PIERCE | TRAIT.BOUNCE | TRAIT.MARK },
  { id: 25, kind: 'evolution', name: 'Tempest',       maxLevel: 1, from: 7, needs: 19, aim: 'rain',    cooldown: 40, damage: 16, speed: 0,   life: 20, count: 6, traits: TRAIT.EXPLODE | TRAIT.STUN | TRAIT.CHAIN },
]
export const WEAPON_SLOTS = 6
export const PASSIVE_SLOTS = 6
export const START_HELD: readonly number[] = [0, 2, 3, 16] // Bolt, Blades, Pulse and Frost
export const WEAPON_LEVEL_STEP = 25 // permille of base damage added per weapon level above 1

/** A held upgrade. `cd` is the cooldown left of a weapon and 0 for a passive. */
export interface Held { id: number; level: number; cd: number }
export interface WeaponStats { id: number; aim: AimMode; cooldown: number; damage: number; speed: number; life: number; count: number; area: number; traits: number }
export type Stats = Record<StatKey, number>

export const NEAREST_RANGE = 14 * FX
export const CHAIN_RANGE = 6 * FX
export const ORBIT_RADIUS = 2.5 * FX
export const ORBIT_STEP = 5
export const ORBIT_REARM = 20
export const DEFAULT_HIT_RADIUS = 400
export const PIERCE_BUDGET = 4
export const CHAIN_BUDGET = 3
export const BOUNCE_BUDGET = 2
export const SPLIT_CHILDREN = 2
export const SPLIT_LIFE = 10
export const FACING_NEAR = 1500
export const FACING_STEP = 1000
export const SCATTER_MINE = 2048
export const RAIN_HALF = 8 * FX
/** Velocity of shot `shot` of a `random` aim weapon. */
export const randomAimVel = (seed: number, tick: number, weaponId: number, shot: number, speed: number): [number, number] => {
  const a = randInt(256, seed, tick, PLAYER_ID, PURPOSE.AIM, weaponId * 16 + shot)
  return [fx.mul(COS(a), speed), fx.mul(SIN[a], speed)]
}
/** Position of shot `shot` of a `drop` or `rain` aim weapon: the player at (px, py) plus a scatter, clamped to the arena. */
export const scatterPoint = (seed: number, tick: number, aim: 'drop' | 'rain', weaponId: number, shot: number, px: number, py: number): [number, number] => {
  const half = aim === 'drop' ? SCATTER_MINE : RAIN_HALF
  const range = 2 * half + 1
  const dx = randInt(range, seed, tick, PLAYER_ID, PURPOSE.SCATTER, weaponId * 16 + 2 * shot) - half
  const dy = randInt(range, seed, tick, PLAYER_ID, PURPOSE.SCATTER, weaponId * 16 + 2 * shot + 1) - half
  return [clampToArena(px + dx), clampToArena(py + dy)]
}
export const CRIT_PERCENT = 10

/** Weapon stat blocks and player stats from the held list. A pure function of `id` and `level`. `cd` is ignored. */
export const deriveLoadout = (held: readonly Held[]): { weapons: WeaponStats[]; stats: Stats } => {
  const stats: Stats = { might: 0, haste: 0, reach: 0, velocity: 0, magnet: 0, amount: 0, vigor: 0, greed: 0 }
  let grantTraits = 0
  for (const h of held) {
    const d = UPGRADES[h.id]
    if (d.kind !== 'passive') continue
    if ('stat' in d.grants) stats[d.grants.stat] += d.grants.perLevel * h.level
    else grantTraits |= d.grants.trait
  }
  const weapons: WeaponStats[] = []
  for (const h of held) {
    const d = UPGRADES[h.id]
    if (d.kind === 'passive') continue
    const dmg = fx.div(d.damage * (1000 + WEAPON_LEVEL_STEP * (h.level - 1)), 1000)
    weapons.push({
      id: d.id,
      aim: d.aim,
      cooldown: d.cooldown === 0 ? 0 : Math.max(1, fx.div(d.cooldown * 1000, 1000 + stats.haste)),
      damage: Math.max(1, fx.div(dmg * (1000 + stats.might), 1000)),
      speed: fx.div(d.speed * (1000 + stats.velocity), 1000),
      life: d.life,
      count: d.count + stats.amount,
      area: fx.div((d.area ?? 0) * (1000 + stats.reach), 1000),
      traits: d.traits | grantTraits,
    })
  }
  return { weapons, stats }
}
/** Aim of upgrade `id`. null for a passive. */
export const aimOf = (id: number): AimMode | null => {
  const d = UPGRADES[id]
  return d.kind === 'passive' ? null : d.aim
}
/** Trait bits a new projectile keeps under scenario.traitScale (permille). Bit i stays when i * 1000 < traitScale * TRAIT_COUNT. */
export const scaleTraits = (traits: number, traitScale: number): number => {
  let out = 0
  for (let i = 0; i < TRAIT_COUNT; i++) if (traits & (1 << i) && i * 1000 < traitScale * TRAIT_COUNT) out |= 1 << i
  return out
}
/** Projectile hit radius of a weapon. */
export const hitRadius = (area: number): number => (area > 0 ? area : DEFAULT_HIT_RADIUS)
export const maxHp = (vigor: number): number => PLAYER_HP + VIGOR_HP * vigor
export const MAGNET_BASE = 6 * FX
export const PICKUP_SPEED = 400
export const PICKUP_RANGE = FX
export const PICKUP_LIFE = 450
export const HEART_HEAL = 10
export const HEART_PERCENT = 3
/** Whether the mob `id` of kind `kind` killed this tick drops a heart. A boss always does. */
export const dropsHeart = (seed: number, tick: number, id: number, kind: number): boolean =>
  kind === MOB.BOSS || randInt(100, seed, tick, id, PURPOSE.DROP, 0) < HEART_PERCENT
/** Distance from the dead splitter at which each of its two swarmlings appears, on the x axis. */
export const SPLIT_OFFSET = 300
/** Extra reach beyond PLAYER_RADIUS at which a hostile shot hits the player. */
export const HOSTILE_HIT_PAD = 300

/** Upgrades the player may get now. Ids ascending. */
export const eligible = (held: readonly Held[]): number[] => {
  const byId = new Map(held.map((h) => [h.id, h.level]))
  let weapons = 0, passives = 0
  for (const h of held) {
    if (UPGRADES[h.id].kind === 'passive') passives++
    else weapons++
  }
  const out: number[] = []
  for (const d of UPGRADES) {
    const lv = byId.get(d.id)
    if (d.kind === 'evolution') {
      if (lv === undefined && byId.get(d.from) === UPGRADES[d.from].maxLevel && byId.has(d.needs)) out.push(d.id)
    } else if (lv !== undefined) {
      if (lv < d.maxLevel) out.push(d.id)
    } else if (d.kind === 'weapon' ? weapons < WEAPON_SLOTS : passives < PASSIVE_SLOTS) out.push(d.id)
  }
  return out
}
/** Offer priorities. A higher value wins. */
export const PRIORITY = { EVOLUTION: 400, EVOLUTION_NEED: 350, HELD_WEAPON: 300, NEW_WEAPON: 250, HELD_PASSIVE: 200, NEW_PASSIVE: 100 } as const
export const priority = (id: number, held: readonly Held[]): number => {
  const d = UPGRADES[id]
  const has = held.some((h) => h.id === id)
  if (d.kind === 'evolution') return PRIORITY.EVOLUTION
  if (d.kind === 'weapon') return has ? PRIORITY.HELD_WEAPON : PRIORITY.NEW_WEAPON
  if (has) return PRIORITY.HELD_PASSIVE
  const unlocksEvolution = UPGRADES.some((e) => e.kind === 'evolution' && e.needs === id && held.some((h) => h.id === e.from && h.level === UPGRADES[e.from].maxLevel))
  return unlocksEvolution ? PRIORITY.EVOLUTION_NEED : PRIORITY.NEW_PASSIVE
}
export const OFFER_COUNT = 3
/** Draws OFFER_COUNT distinct offers with the counter RNG, then takes the highest priority (ties: lowest id). -1 when none. */
export const pickUpgrade = (seed: number, tick: number, key: number, held: readonly Held[]): number => {
  const pool = eligible(held)
  const offers: number[] = []
  for (let j = 0; j < OFFER_COUNT && pool.length > 0; j++) offers.push(pool.splice(randInt(pool.length, seed, tick, key, PURPOSE.OFFER, j), 1)[0])
  let best = -1
  for (const id of offers) if (best === -1 || priority(id, held) > priority(best, held) || (priority(id, held) === priority(best, held) && id < best)) best = id
  return best
}
/** A chest takes the lowest eligible evolution, else the normal pick. */
export const chestPick = (seed: number, tick: number, key: number, held: readonly Held[]): number =>
  eligible(held).find((id) => UPGRADES[id].kind === 'evolution') ?? pickUpgrade(seed, tick, key, held)
/** Key of a chest pick: the chest gameId, apart from the level keys. */
export const CHEST_KEY = 0x10000
/** The held list after taking upgrade `id`. Sorted by id. An evolution replaces its `from` weapon (cd 0). */
export const takeUpgrade = (held: readonly Held[], id: number): Held[] => {
  const d = UPGRADES[id]
  const replaced = d.kind === 'evolution' ? d.from : -1
  const out = held.filter((h) => h.id !== replaced).map((h) => ({ ...h }))
  const cur = out.find((h) => h.id === id)
  if (cur) cur.level++
  else out.push({ id, level: 1, cd: 0 })
  return out.sort((a, b) => a.id - b.id)
}

/** XP needed to leave `level`, scaled by scenario.xpScale (permille). */
export const xpForLevel = (level: number, xpScale: number): number =>
  Math.max(1, fx.div((4 + 2 * level + fx.div(level * level, 8)) * xpScale, 1000))
