// SoA components for bitECS 0.4: a component is a plain object whose fields are typed arrays indexed by the native entity id.
// The stores are module-level and sized for the peak of `war` (about 50k entities). bitECS recycles ids at once and never clears a store,
// so every spawn writes every field of every component it adds. A tag is an empty object.

export const CAP = 1 << 17
const ints = () => new Int32Array(CAP)

export const GameId = { id: ints() }
export const Position = { x: ints(), y: ints() }
export const Start = { x: ints(), y: ints() }
export const Team = { value: ints() }
export const Kind = { value: ints() }
export const Health = { hp: ints(), maxHp: ints() }
export const Stats = { attack: ints(), armor: ints(), speed: ints() }
export const Cooldown = { value: ints() }
export const Age = { value: ints() }
export const KillCount = { value: ints() }
export const Morale = { size0: ints(), lost: ints() }
/** Veteran log, oldest first (SPEC §6.13). Array data per entity: one small typed array for each entity that carries it. */
export const Chronicle = { n: ints(), kinds: Array.from<Int32Array>({ length: CAP }) }
/** Path history, x and y pairs, oldest first (SPEC §6.16). */
export const Trail = { n: ints(), pts: Array.from<Int32Array>({ length: CAP }) }
export const Shrine = { owner: ints(), progress: ints() }
export const Summoner = { lastSummon: ints() }
export const ItemKind = { value: ints() }
export const Ground = { quality: ints() }
export const Projectile = { owner: ints(), ownerTeam: ints(), ownerKind: ints(), attack: ints(), crit: ints(), speed: ints(), volley: ints() }

export const Unit = {}
export const Minion = {}
export const Item = {}
export const Dead = {}
export const Spent = {}
export const Fleeing = {}
export const Routed = {}
export const Veteran = {}
export const Overwhelmed = {}
export const Bannered = {}
export const Garrisoned = {}

// One tag per item kind (SPEC 3.1), indexed by item kind. A unit carries the tag while it holds an item of that kind.
export const Sword = {}
export const Axe = {}
export const Shield = {}
export const Helm = {}
export const Boots = {}
export const Bow = {}
export const Ring = {}
export const Cloak = {}
export const ItemTags = [Sword, Axe, Shield, Helm, Boots, Bow, Ring, Cloak]

export const Stun = { ticksLeft: ints() }
export const Burn = { ticksLeft: ints() }
export const Haste = { ticksLeft: ints() }

export const COMPONENTS = {
  GameId, Position, Start, Team, Kind, Health, Stats, Cooldown, Age, KillCount, Morale, Chronicle, Trail, Shrine, Summoner, ItemKind, Ground, Projectile,
  Unit, Minion, Item, Dead, Spent, Fleeing, Routed, Veteran, Overwhelmed, Bannered, Garrisoned,
  Sword, Axe, Shield, Helm, Boots, Bow, Ring, Cloak, Stun, Burn, Haste,
}
