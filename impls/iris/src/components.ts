import { defineComponent, Type } from 'iris-ecs'

const i32 = () => Type.i32()
const u32 = () => Type.u32()

export const GameId = defineComponent('GameId', { schema: { id: i32() } })
export const Position = defineComponent('Position', { schema: { x: i32(), y: i32() } })
export const Start = defineComponent('Start', { schema: { x: i32(), y: i32() } })
export const Team = defineComponent('Team', { schema: { value: i32() } })
export const Kind = defineComponent('Kind', { schema: { value: i32() } })
export const Health = defineComponent('Health', { schema: { hp: i32(), maxHp: i32() } })
export const Stats = defineComponent('Stats', { schema: { attack: i32(), armor: i32(), speed: i32() } })
export const Cooldown = defineComponent('Cooldown', { schema: { value: i32() } })
export const Age = defineComponent('Age', { schema: { value: i32() } })
export const KillCount = defineComponent('KillCount', { schema: { value: i32() } })
export const Morale = defineComponent('Morale', { schema: { size0: i32(), lost: i32() } })
export const Chronicle = defineComponent('Chronicle', { schema: { kinds: Type.ref<number[]>() } })
/** Path history, x and y pairs, oldest first (SPEC §6.16). A `Type.ref` field: the array lives in the column and is edited in place. */
export const Trail = defineComponent('Trail', { schema: { pts: Type.ref<number[]>() } })
export const Shrine = defineComponent('Shrine', { schema: { owner: i32(), progress: i32() } })
export const Summoner = defineComponent('Summoner', { schema: { lastSummon: i32() } })
export const ItemKind = defineComponent('ItemKind', { schema: { value: i32() } })
export const Ground = defineComponent('Ground', { schema: { quality: i32() } })
export const Projectile = defineComponent('Projectile', {
  schema: { owner: i32(), ownerTeam: i32(), ownerKind: i32(), attack: i32(), crit: i32(), speed: i32(), volley: i32() },
})

// Links to other entities. A link is a plain `u32` field that holds a gameId, and 0 is no entity: gameIds start at 1 (`NextId`).
// (A native id would also work for 0: entity type bits 1<<28 make every encoded id non-zero.) The field holds a gameId, not an
// entity id, because iris has an 8-bit generation: after 256 reuses of a slot a stale id names a live entity again and `isEntityAlive`
// cannot tell. A gameId is never reused, so `ctx.entityOf` resolves it exactly, and `ctx.targetOf` reads a destroyed target as no target.
// A relation pair would make up to B x T archetypes (B base archetypes, T distinct targets), and these links change every tick: see
// CAPABILITIES.md. Only `ChildOf` and `GarrisonOf` stay relations (relations.ts), because T is small.
export const Targets = defineComponent('Targets', { schema: { to: u32() } })
export const LastHitBy = defineComponent('LastHitBy', { schema: { to: u32() } })
export const FiredBy = defineComponent('FiredBy', { schema: { to: u32() } })
/** Present while the unit follows a leader, so `to` is never 0. The offsets are the formation slot. */
export const MemberOf = defineComponent('MemberOf', { schema: { to: u32(), offsetX: i32(), offsetY: i32() } })
export type Link = typeof Targets | typeof LastHitBy | typeof FiredBy | typeof MemberOf
/** Threat edges, flat: attacker gameId, amount, attacker gameId, amount... */
export const Threat = defineComponent('Threat', { schema: { edges: Type.ref<number[]>() } })
/** Held items, flat: item gameId, quality, item gameId, quality... */
export const Equips = defineComponent('Equips', { schema: { items: Type.ref<number[]>() } })

export const Unit = defineComponent('Unit')
export const Minion = defineComponent('Minion')
export const Item = defineComponent('Item')
export const Dead = defineComponent('Dead')
export const Spent = defineComponent('Spent')
export const Fleeing = defineComponent('Fleeing')
export const Routed = defineComponent('Routed')
export const Veteran = defineComponent('Veteran')
export const Overwhelmed = defineComponent('Overwhelmed')
export const Bannered = defineComponent('Bannered')

// One tag per item kind (SPEC 3.1), indexed by item kind. A unit carries the tag while it holds an item of that kind.
export const Sword = defineComponent('Sword')
export const Axe = defineComponent('Axe')
export const Shield = defineComponent('Shield')
export const Helm = defineComponent('Helm')
export const Boots = defineComponent('Boots')
export const Bow = defineComponent('Bow')
export const Ring = defineComponent('Ring')
export const Cloak = defineComponent('Cloak')
export const ItemTags = [Sword, Axe, Shield, Helm, Boots, Bow, Ring, Cloak] as const

export const Stun = defineComponent('Stun', { schema: { ticksLeft: i32() } })
export const Burn = defineComponent('Burn', { schema: { ticksLeft: i32() } })
export const Haste = defineComponent('Haste', { schema: { ticksLeft: i32() } })

// Resources: one copy per world, no entity.
export const Clock = defineComponent('Clock', { schema: { tick: i32() } })
export const NextId = defineComponent('NextId', { schema: { value: i32() } })
export const Metrics = defineComponent('Metrics', {
  schema: {
    alive0: i32(), alive1: i32(), kills0: i32(), kills1: i32(), damage0: i32(), damage1: i32(),
    orders0: i32(), orders1: i32(), renderChain: i32(), winner: i32(),
  },
})
export const Score = defineComponent('Score', { schema: { shrines0: i32(), shrines1: i32() } })
