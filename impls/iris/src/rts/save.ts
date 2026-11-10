// SPEC §10 save and load. iris 0.0.14 has no snapshot or serialize API, so the save is emulated: a query over `GameId` lists the
// entities, `hasComponent` and `getComponent` read each component, `getRelationTargets` reads each relation. Link components hold
// gameIds already, so they are copied as they are, a link to a destroyed entity included. A relation target is saved as a gameId.
// `resetWorld` empties the world and keeps every definition, then `load` creates the entities again.
import {
  addComponent, collectEntities, type Component, type ComponentEntry, createEntity, type EntityId, getComponent, getComponentValue,
  getRelationTargets, hasComponent, pair, resetWorld,
} from 'iris-ecs'
import { copy, type Data, dataOf, GameId, resourceData, restoreResource } from '../shared/components.ts'
import { runAs } from '../shared/driver.ts'
import {
  Age, AnyGarrison, Bannered, Burn, ChildOf, Chronicle, Clock, Cooldown, Dead, Equips, FiredBy, Fleeing, GarrisonOf, Ground, Haste,
  Health, Item, ItemKind, ItemTags, KillCount, Kind, LastHitBy, MemberOf, Metrics, Minion, Morale, NextId, Overwhelmed, Position,
  Projectile, Routed, Score, Shrine, Spent, Start, Stats, Stun, Summoner, Targets, Team, Threat, Trail, Unit, Veteran,
} from './components.ts'
import type { Ctx } from './context.ts'
import { summonerOf } from './links.ts'
import { identified, TRACKERS } from './queries.ts'

// Every component an entity can carry. A component missing here is lost by a load, and the replay hashes catch that.
const COMPONENTS: readonly EntityId[] = [
  GameId, Position, Start, Team, Kind, Health, Stats, Cooldown, Age, KillCount, Morale, Chronicle, Trail, Shrine, Summoner, ItemKind,
  Ground, Projectile, Unit, Minion, Item, Dead, Spent, Fleeing, Routed, Veteran, Overwhelmed, Bannered, ...ItemTags, Stun, Burn, Haste,
  Targets, LastHitBy, FiredBy, MemberOf, Threat, Equips,
]
const RESOURCES: Component[] = [Clock, NextId, Metrics, Score]

interface SavedEntity {
  gameId: number
  components: [index: number, value: Data | null][]
  /** The gameId of the summoner (`ChildOf` target), or 0. */
  childOf: number
  /** The gameId of the shrine (`GarrisonOf` target), or 0. */
  garrisonOf: number
}
export interface Saved { resources: Data[]; entities: SavedEntity[] }

export const save = (ctx: Ctx): Saved => {
  const { world } = ctx
  const entities: SavedEntity[] = []
  for (const e of collectEntities(world, identified)) {
    const components: SavedEntity['components'] = []
    COMPONENTS.forEach((c, i) => {
      if (!hasComponent(world, e, c)) return
      components.push([i, dataOf(world, e, c)])
    })
    const summoner = summonerOf(world, e), shrine = getRelationTargets(world, e, GarrisonOf)[0]
    entities.push({
      gameId: getComponentValue(world, e, GameId, 'id'),
      components,
      childOf: summoner === undefined ? 0 : getComponentValue(world, summoner, GameId, 'id')!,
      garrisonOf: shrine === undefined ? 0 : getComponentValue(world, shrine, GameId, 'id')!,
    })
  }
  entities.sort((a, b) => a.gameId - b.gameId)
  return { resources: RESOURCES.map((r) => resourceData(world, r)), entities }
}

/** The respawn raised tracker windows and observer events. Drop them so no event of the discarded ticks reaches the next tick. */
const dropEvents = (ctx: Ctx) => {
  ctx.dirty.clear()
  for (const [system, queries] of Object.entries(TRACKERS)) {
    runAs(ctx.world, system, () => {
      for (const q of queries) collectEntities(ctx.world, q)
    })
  }
}

export const load = (ctx: Ctx, saved: Saved): void => {
  const { world } = ctx
  ctx.units.clear()
  ctx.entityOf.clear()
  resetWorld(world)
  RESOURCES.forEach((r, i) => restoreResource(world, r, saved.resources[i]!))

  const created = new Map<number, EntityId>()
  const entry = ([i, v]: SavedEntity['components'][number]) => (v ? [COMPONENTS[i], copy(v)!] : COMPONENTS[i]) as ComponentEntry
  for (const s of saved.entities) created.set(s.gameId, createEntity(world, s.components.map(entry)))
  for (const s of saved.entities) {
    const e = created.get(s.gameId)!
    if (s.childOf) addComponent(world, e, pair(ChildOf, created.get(s.childOf)!))
    if (s.garrisonOf) addComponent(world, e, pair(GarrisonOf, created.get(s.garrisonOf)!))
  }

  // The kernel grid holds every unit that is not garrisoned (SPEC 3.2). The `componentAdded` observer of the context has refilled the
  // gameId map.
  for (const [gameId, e] of created) {
    if (!hasComponent(world, e, Unit)) continue
    const pos = getComponent(world, e, Position)!
    ctx.units.track(e, gameId, getComponentValue(world, e, Team, 'value')!, pos.x, pos.y)
    if (hasComponent(world, e, AnyGarrison)) ctx.units.leave(e)
  }
  dropEvents(ctx)
}
