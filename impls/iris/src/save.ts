// SPEC §10 save and load. iris 0.0.14 has no snapshot or serialize API, so the save is emulated: a query over `GameId` lists the
// entities, `hasComponent` and `getComponent` read each component, `getRelationTargets` reads each relation. Link components hold
// gameIds already, so they are copied as they are, a link to a destroyed entity included. A relation target is saved as a gameId. `resetWorld` empties the world and keeps every definition, then `load` creates the entities again.
import {
  addComponent, addResource, collectEntities, createEntity, getComponent, getRelationTargets, getResource, hasComponent, pair, resetWorld,
  type Component, type ComponentEntry, type EntityId,
} from 'iris-ecs'
import type { Context } from './context.ts'
import {
  Age, Bannered, Burn, Chronicle, Trail, Clock, Cooldown, Dead, Equips, FiredBy, Fleeing, GameId, Ground, Haste, Health, Item, ItemKind, ItemTags, KillCount, Kind, LastHitBy,
  MemberOf, Metrics, Minion, Morale, NextId, Overwhelmed, Position, Projectile, Routed, Score, Shrine, Spent, Start, Stats, Stun, Summoner, Targets, Team, Threat, Unit, Veteran,
} from './components.ts'
import { AnyGarrison, ChildOf, GarrisonOf } from './relations.ts'
import { runAs } from './driver.ts'
import { TRACKERS } from './queries.ts'

// Every component an entity can carry. A component missing here is lost by a load, and the replay hashes catch that.
const COMPONENTS: EntityId[] = [
  GameId, Position, Start, Team, Kind, Health, Stats, Cooldown, Age, KillCount, Morale, Chronicle, Trail, Shrine, Summoner, ItemKind, Ground, Projectile,
  Unit, Minion, Item, Dead, Spent, Fleeing, Routed, Veteran, Overwhelmed, Bannered, ...ItemTags, Stun, Burn, Haste,
  Targets, LastHitBy, FiredBy, MemberOf, Threat, Equips,
]
const RESOURCES: Component[] = [Clock, NextId, Metrics, Score]
type Data = Record<string, unknown>
/** A component value without the component: `null` for a tag. Arrays are copied, so the save shares nothing with the world. */
const copy = (v: Data | undefined): Data | null => {
  if (!v) return null
  const out: Data = { ...v }
  for (const key in out) if (Array.isArray(out[key])) out[key] = [...(out[key] as unknown[])]
  return out
}

interface SavedEntity {
  gameId: number
  components: [index: number, value: Data | null][]
  /** The gameId of the summoner (`ChildOf` target), or 0. */
  childOf: number
  /** The gameId of the shrine (`GarrisonOf` target), or 0. */
  garrisonOf: number
}
export interface Saved { resources: (Data | null)[]; entities: SavedEntity[] }

export const save = (ctx: Context): Saved => {
  const { world, gid } = ctx
  const entities: SavedEntity[] = []
  for (const e of collectEntities(world, [GameId])) {
    const components: SavedEntity['components'] = []
    COMPONENTS.forEach((c, i) => {
      if (!hasComponent(world, e, c)) return
      components.push([i, copy(getComponent(world, e, c as Component) as Data | undefined)])
    })
    const summoner = ctx.summonerOf(e), shrine = getRelationTargets(world, e, GarrisonOf)[0]
    entities.push({ gameId: gid(e), components, childOf: summoner === undefined ? 0 : gid(summoner), garrisonOf: shrine === undefined ? 0 : gid(shrine) })
  }
  entities.sort((a, b) => a.gameId - b.gameId)
  return { resources: RESOURCES.map((r) => copy(getResource(world, r) as Data)), entities }
}

/** The respawn raised tracker windows and observer events. Drop them so no event of the discarded ticks reaches the next tick. */
const dropEvents = (ctx: Context) => {
  ctx.dirty.clear()
  for (const [system, queries] of Object.entries(TRACKERS)) runAs(ctx.world, system, () => { for (const q of queries) collectEntities(ctx.world, q) })
}

export const load = (ctx: Context, saved: Saved): void => {
  const { world } = ctx
  ctx.units.clear()
  ctx.entityOf.clear()
  resetWorld(world)
  RESOURCES.forEach((r, i) => addResource(world, r as never, copy(saved.resources[i]!) as never))

  const byGameId = new Map<number, EntityId>()
  const entry = ([i, v]: SavedEntity['components'][number]) => (v ? [COMPONENTS[i], copy(v)] : COMPONENTS[i]) as ComponentEntry
  for (const s of saved.entities) byGameId.set(s.gameId, createEntity(world, s.components.map(entry)))
  for (const s of saved.entities) {
    const e = byGameId.get(s.gameId)!
    if (s.childOf) addComponent(world, e, pair(ChildOf, byGameId.get(s.childOf)!))
    if (s.garrisonOf) addComponent(world, e, pair(GarrisonOf, byGameId.get(s.garrisonOf)!))
  }

  // The kernel grid holds every unit that is not garrisoned (SPEC 3.2). The `componentAdded` observer of the context has refilled the gameId map.
  for (const [gameId, e] of byGameId) {
    if (!hasComponent(world, e, Unit)) continue
    ctx.units.track(e, gameId, ctx.get(e, Team, 'value'), ctx.get(e, Position, 'x'), ctx.get(e, Position, 'y'))
    if (hasComponent(world, e, AnyGarrison)) ctx.units.leave(e)
  }
  dropEvents(ctx)
}
