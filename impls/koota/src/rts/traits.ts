// The traits, tags and relations of the RTS (SPEC.md). A world trait holds a singleton: the clock, the id counter and the totals.
import { relation, trait } from 'koota'

export const GameId = trait({ id: 0 })
export const Position = trait({ x: 0, y: 0 })
export const Start = trait({ x: 0, y: 0 })
export const Team = trait({ value: 0 })
export const Kind = trait({ value: 0 })
export const Health = trait({ hp: 0, maxHp: 0 })
export const Stats = trait({ attack: 0, armor: 0, speed: 0 })
export const Cooldown = trait({ value: 0 })
export const Age = trait({ value: 0 })
export const KillCount = trait({ value: 0 })
export const Morale = trait({ size0: 0, lost: 0 })
export const Chronicle = trait({ kinds: () => [] as number[] })
/** Path history, x and y pairs, oldest first (SPEC §6.16). An AoS trait: the array lives in the trait value. */
export const Trail = trait({ pts: () => [] as number[] })
export const Shrine = trait({ owner: -1, progress: 0 })
export const Summoner = trait({ lastSummon: 0 })
export const ItemKind = trait({ value: 0 })
export const Ground = trait({ quality: 0 })
export const Projectile = trait({
  owner: 0, ownerTeam: 0, ownerKind: 0, attack: 0, crit: 0, speed: 0, volley: 0,
})

export const Unit = trait()
export const Minion = trait()
export const Item = trait()
export const Dead = trait()
export const Spent = trait()
export const Fleeing = trait()
export const Routed = trait()
export const Veteran = trait()
export const Overwhelmed = trait()
export const Bannered = trait()
export const Garrisoned = trait()
// SPEC §8 flags: bit i of a unit's flags is set when it has FLAG_TAGS[i].
export const FLAG_TAGS = [Fleeing, Veteran, Routed, Overwhelmed, Bannered, Garrisoned] as const

// One tag per item kind (SPEC 3.1), indexed by item kind. A unit carries the tag while it holds an item of that kind.
export const Sword = trait()
export const Axe = trait()
export const Shield = trait()
export const Helm = trait()
export const Boots = trait()
export const Bow = trait()
export const Ring = trait()
export const Cloak = trait()
export const ITEM_TAGS = [Sword, Axe, Shield, Helm, Boots, Bow, Ring, Cloak] as const

export const Stun = trait({ ticksLeft: 0 })
export const Burn = trait({ ticksLeft: 0 })
export const Haste = trait({ ticksLeft: 0 })

// World traits
export const Clock = trait({ tick: -1 })
export const NextId = trait({ value: 1 })
export const Metrics = trait({
  alive0: 0, alive1: 0, kills0: 0, kills1: 0, damage0: 0, damage1: 0, orders0: 0, orders1: 0, renderChain: 0x811c9dc5 | 0, winner: -1,
})
export const Score = trait({ shrines0: 0, shrines1: 0 })

// Relations
export const Targets = relation({ exclusive: true })
export const ChildOf = relation({ autoDestroy: 'orphan' })
export const MemberOf = relation({ exclusive: true, store: { offsetX: 0, offsetY: 0 } })
export const Equips = relation({ autoDestroy: 'target', store: { quality: 1 } })
export const Threat = relation({ store: { amount: 0 } })
export const GarrisonOf = relation({ exclusive: true })
export const LastHitBy = relation({ exclusive: true })
export const FiredBy = relation({ exclusive: true })
