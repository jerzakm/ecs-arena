// SPEC §10 save and load. bitECS 0.4 has a snapshot serializer, but it cannot carry this state. It writes native ids, it has no support
// for the links or for the per-entity arrays, and it allocates a 100 MB buffer for each call. So the save is emulated: one record for each
// kind of entity (shrine, unit, projectile, ground item) is read from the SoA stores. A link in a record names a gameId, never a native id.
// The restore empties the world with `resetWorld` and spawns every entity again.
import { addComponent, addComponents, hasComponent, query, resetWorld } from 'bitecs'
import { observeWorld, type Ctx, type Resources } from './context.ts'
import {
  Age, Burn, Chronicle, Cooldown, FLAG_TAGS, Garrisoned, Ground, Haste, Health, Item, ItemKind, ItemTags, KillCount, Kind, Minion, Morale,
  Position, Projectile, Shrine, Start, Stats, Stun, Summoner, Team, Trail, Unit,
} from './components.ts'
import { GameId } from '../shared/components.ts'
import { equip, newEntity } from './entities.ts'
import { Q } from './queries.ts'
import {
  addThreat, ChildOf, Equips, FiredBy, GarrisonOf, LastHitBy, type Link, MemberOf, resetStores, setLink, Targets, Threat,
} from './relations.ts'
import { flagsOf } from './snapshot.ts'
import { sortedByGameId } from '../shared/util.ts'

const NONE = -1

interface SavedShrine { gameId: number; x: number; y: number; owner: number; progress: number }
interface SavedItem { gameId: number; kind: number; quality: number }
interface SavedUnit {
  gameId: number; team: number; kind: number; x: number; y: number; startX: number; startY: number; hp: number; maxHp: number
  attack: number; armor: number; speed: number; cooldown: number; kills: number
  trail: { n: number; pts: number[] }
  flags: number // the SPEC §8 flag tags, in bit order
  stun: number | null; burn: number | null; haste: number | null // ticks left, null when the unit has no such buff
  lastSummon: number | null // null when the unit is not a summoner
  minionAge: number | null // null when the unit is not a minion
  morale: { size0: number; lost: number } | null
  chronicle: { n: number; kinds: number[] } | null
  items: SavedItem[] // in the order of `Equips`
  threats: [attackerGameId: number, amount: number][]
  // Links by gameId, or -1.
  targets: number; childOf: number; memberOf: number; offsetX: number; offsetY: number; garrisonOf: number; lastHitBy: number
}
interface SavedProjectile {
  gameId: number; owner: number; ownerTeam: number; ownerKind: number; attack: number; crit: number; speed: number; volley: number
  x: number; y: number; age: number; targets: number; firedBy: number
}
interface SavedGroundItem { gameId: number; kind: number; quality: number; x: number; y: number; age: number }
export interface Saved {
  world: Resources
  shrines: SavedShrine[]
  units: SavedUnit[]
  projectiles: SavedProjectile[]
  groundItems: SavedGroundItem[]
}

const gameIdOf = (e: number): number => (e === NONE ? NONE : GameId.id[e])
const orNull = (has: boolean, value: number): number | null => (has ? value : null)

const saveUnit = (ctx: Ctx, e: number): SavedUnit => {
  const { world } = ctx
  const morale = hasComponent(world, e, Morale)
  const chronicle = hasComponent(world, e, Chronicle)
  const items = Equips.items[e] ?? []
  return {
    gameId: GameId.id[e], team: Team.value[e], kind: Kind.value[e], x: Position.x[e], y: Position.y[e],
    startX: Start.x[e], startY: Start.y[e],
    hp: Health.hp[e], maxHp: Health.maxHp[e], attack: Stats.attack[e], armor: Stats.armor[e], speed: Stats.speed[e],
    cooldown: Cooldown.value[e], kills: KillCount.value[e],
    trail: { n: Trail.n[e], pts: Array.from(Trail.pts[e]) },
    flags: flagsOf(world, e),
    stun: orNull(hasComponent(world, e, Stun), Stun.ticksLeft[e]),
    burn: orNull(hasComponent(world, e, Burn), Burn.ticksLeft[e]),
    haste: orNull(hasComponent(world, e, Haste), Haste.ticksLeft[e]),
    lastSummon: orNull(hasComponent(world, e, Summoner), Summoner.lastSummon[e]),
    minionAge: orNull(hasComponent(world, e, Minion), Age.value[e]),
    morale: morale ? { size0: Morale.size0[e], lost: Morale.lost[e] } : null,
    chronicle: chronicle ? { n: Chronicle.n[e], kinds: Array.from(Chronicle.kinds[e]) } : null,
    items: items.map((it, i) => ({ gameId: GameId.id[it], kind: ItemKind.value[it], quality: Equips.quality[e][i] })),
    threats: (Threat.attackers[e] ?? []).map((a, i) => [GameId.id[a], Threat.amount[e][i]]),
    targets: gameIdOf(Targets.to[e]), childOf: gameIdOf(ChildOf.to[e]), memberOf: gameIdOf(MemberOf.to[e]),
    offsetX: MemberOf.offsetX[e], offsetY: MemberOf.offsetY[e],
    garrisonOf: gameIdOf(GarrisonOf.to[e]), lastHitBy: gameIdOf(LastHitBy.to[e]),
  }
}

export const save = (ctx: Ctx): Saved => {
  const { world } = ctx
  return {
    world: structuredClone({ tick: world.tick, nextId: world.nextId, score: world.score, metrics: world.metrics }),
    shrines: sortedByGameId(ctx, Q.shrines).map((e) => ({
      gameId: GameId.id[e], x: Position.x[e], y: Position.y[e], owner: Shrine.owner[e], progress: Shrine.progress[e],
    })),
    units: sortedByGameId(ctx, Q.units).map((e) => saveUnit(ctx, e)),
    projectiles: sortedByGameId(ctx, Q.allProjectiles).map((e) => ({
      gameId: GameId.id[e], owner: Projectile.owner[e], ownerTeam: Projectile.ownerTeam[e], ownerKind: Projectile.ownerKind[e],
      attack: Projectile.attack[e], crit: Projectile.crit[e], speed: Projectile.speed[e], volley: Projectile.volley[e],
      x: Position.x[e], y: Position.y[e], age: Age.value[e], targets: gameIdOf(Targets.to[e]), firedBy: gameIdOf(FiredBy.to[e]),
    })),
    groundItems: sortedByGameId(ctx, Q.ground).map((e) => ({
      gameId: GameId.id[e], kind: ItemKind.value[e], quality: Ground.quality[e], x: Position.x[e], y: Position.y[e], age: Age.value[e],
    })),
  }
}

/** Spawns a unit with its items and everything but its links, which `load` sets once every entity exists. */
const loadUnit = (ctx: Ctx, s: SavedUnit): number => {
  const { world } = ctx
  const e = newEntity(ctx)
  addComponents(world, e, [Unit, GameId, Team, Kind, Position, Start, Health, Stats, Cooldown, KillCount, Trail])
  GameId.id[e] = s.gameId; Team.value[e] = s.team; Kind.value[e] = s.kind
  Position.x[e] = s.x; Position.y[e] = s.y; Start.x[e] = s.startX; Start.y[e] = s.startY
  Health.hp[e] = s.hp; Health.maxHp[e] = s.maxHp
  Stats.attack[e] = s.attack; Stats.armor[e] = s.armor; Stats.speed[e] = s.speed
  Cooldown.value[e] = s.cooldown; KillCount.value[e] = s.kills
  Trail.n[e] = s.trail.n; Trail.pts[e] = Int32Array.from(s.trail.pts)
  for (let bit = 0; bit < FLAG_TAGS.length; bit++) if ((s.flags >> bit) & 1) addComponent(world, e, FLAG_TAGS[bit])
  if (s.stun !== null) { addComponent(world, e, Stun); Stun.ticksLeft[e] = s.stun }
  if (s.burn !== null) { addComponent(world, e, Burn); Burn.ticksLeft[e] = s.burn }
  if (s.haste !== null) { addComponent(world, e, Haste); Haste.ticksLeft[e] = s.haste }
  if (s.lastSummon !== null) { addComponent(world, e, Summoner); Summoner.lastSummon[e] = s.lastSummon }
  if (s.minionAge !== null) { addComponents(world, e, [Minion, Age]); Age.value[e] = s.minionAge }
  if (s.morale) { addComponent(world, e, Morale); Morale.size0[e] = s.morale.size0; Morale.lost[e] = s.morale.lost }
  if (s.chronicle) {
    addComponent(world, e, Chronicle)
    Chronicle.n[e] = s.chronicle.n; Chronicle.kinds[e] = Int32Array.from(s.chronicle.kinds)
  }
  MemberOf.offsetX[e] = s.offsetX; MemberOf.offsetY[e] = s.offsetY
  for (const item of s.items) {
    const it = newEntity(ctx)
    addComponents(world, it, [Item, GameId, ItemKind])
    GameId.id[it] = item.gameId; ItemKind.value[it] = item.kind
    equip(ctx, e, it, item.quality)
    addComponent(world, e, ItemTags[item.kind])
  }
  return e
}

/**
 * Empties the same world with `resetWorld`, which also drops the queries and their observers, so `observeWorld` runs again. Every entity
 * is spawned again in gameId order and the links are set from a gameId map. The new observers have seen only the respawn, and the
 * lists they filled are emptied, so no event of the discarded ticks reaches the next tick.
 */
export const load = (ctx: Ctx, saved: Saved): void => {
  const { world } = ctx
  for (const e of ctx.unitById.values()) if (ctx.inGrid[e]) ctx.grid.remove(e)
  ctx.unitById.clear()
  ctx.inGrid.fill(0)
  ctx.destroyed.clear()
  resetStores()
  resetWorld(world)
  observeWorld(ctx)
  Object.assign(world, structuredClone(saved.world))

  const byId = new Map<number, number>()
  for (const s of saved.shrines) {
    const e = newEntity(ctx)
    byId.set(s.gameId, e)
    addComponents(world, e, [Shrine, GameId, Position])
    GameId.id[e] = s.gameId; Position.x[e] = s.x; Position.y[e] = s.y; Shrine.owner[e] = s.owner; Shrine.progress[e] = s.progress
  }
  for (const s of saved.units) byId.set(s.gameId, loadUnit(ctx, s))
  for (const s of saved.groundItems) {
    const e = newEntity(ctx)
    addComponents(world, e, [Item, GameId, ItemKind, Ground, Position, Age])
    GameId.id[e] = s.gameId; ItemKind.value[e] = s.kind; Ground.quality[e] = s.quality
    Position.x[e] = s.x; Position.y[e] = s.y; Age.value[e] = s.age
  }
  for (const s of saved.projectiles) {
    const e = newEntity(ctx)
    byId.set(s.gameId, e)
    addComponents(world, e, [GameId, Position, Age, Projectile])
    GameId.id[e] = s.gameId; Position.x[e] = s.x; Position.y[e] = s.y; Age.value[e] = s.age
    Projectile.owner[e] = s.owner; Projectile.ownerTeam[e] = s.ownerTeam; Projectile.ownerKind[e] = s.ownerKind
    Projectile.attack[e] = s.attack; Projectile.crit[e] = s.crit; Projectile.speed[e] = s.speed; Projectile.volley[e] = s.volley
  }

  const link = (e: number, l: Link, target: number) => { if (target !== NONE) setLink(e, l, byId.get(target)!) }
  for (const s of saved.units) {
    const e = byId.get(s.gameId)!
    link(e, Targets, s.targets); link(e, ChildOf, s.childOf); link(e, MemberOf, s.memberOf)
    link(e, GarrisonOf, s.garrisonOf); link(e, LastHitBy, s.lastHitBy)
    for (const [attacker, amount] of s.threats) addThreat(e, byId.get(attacker)!, amount)
  }
  for (const s of saved.projectiles) {
    const e = byId.get(s.gameId)!
    link(e, Targets, s.targets); link(e, FiredBy, s.firedBy)
  }

  // The kernel grid and the gameId lookup hold every unit that is not garrisoned (SPEC 3.2).
  for (const e of query(world, Q.units)) {
    ctx.unitById.set(GameId.id[e], e)
    if (!hasComponent(world, e, Garrisoned)) { ctx.grid.add(e, GameId.id[e], Position.x[e], Position.y[e]); ctx.inGrid[e] = 1 }
  }

  ctx.dirty.clear(); ctx.killsChanged.clear()
  ctx.newlyRouted.length = ctx.newlyFleeing.length = ctx.newlyVeteran.length = 0
}
