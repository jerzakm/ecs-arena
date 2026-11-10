// SPEC §10 save and load. koota 0.6.6 has no snapshot or serialize API, so the save is emulated: a query over `GameId` lists
// the entities, `has` and `get` read each trait, `targetsFor` reads each relation. Relations in the save name a gameId, never a native id.
// The restore empties the world with `destroyAll` and respawns each entity (workarounds.ts explains why not `world.reset()`).
import type { Entity, Relation, Trait } from 'koota'
import type { Ctx } from './context.ts'
import {
  Age, Bannered, Burn, ChildOf, Chronicle, Clock, Cooldown, Dead, Equips, FiredBy, Fleeing, GameId, GarrisonOf, Garrisoned, Ground, Haste,
  Health, Item, ITEM_TAGS, ItemKind, KillCount, Kind, LastHitBy, MemberOf, Metrics, Minion, Morale, NextId, Overwhelmed, Position,
  Projectile, Routed, Score, Shrine, Spent, Start, Stats, Stun, Summoner, Targets, Team, Threat, Trail, Unit, Veteran,
} from './traits.ts'
import { byGameId, copy, dataOf, type Data } from '../shared/util.ts'
import { destroyAll } from '../shared/workarounds.ts'

// Every trait an entity can carry. A trait missing here is lost by a load, and the replay hashes catch that.
const TRAITS: Trait[] = [
  GameId, Position, Start, Team, Kind, Health, Stats, Cooldown, Age, KillCount, Morale, Chronicle, Trail, Shrine, Summoner, ItemKind,
  Ground, Projectile, Unit, Minion, Item, Dead, Spent, Fleeing, Routed, Veteran, Overwhelmed, Bannered, Garrisoned, ...ITEM_TAGS,
  Stun, Burn, Haste,
]
const WORLD_TRAITS: Trait[] = [Clock, NextId, Metrics, Score]
const RELATIONS: Relation[] = [Targets, ChildOf, MemberOf, Equips, Threat, GarrisonOf, LastHitBy, FiredBy]

interface SavedEntity {
  gameId: number
  traits: [index: number, value: Data | null][]
  relations: [index: number, targetGameId: number, value: Data | null][]
}
export interface Saved { world: Data[]; entities: SavedEntity[] }

export const save = (ctx: Ctx): Saved => {
  const { world } = ctx
  const entities: SavedEntity[] = []
  world.query(GameId).readEach(([g], e) => {
    const traits: SavedEntity['traits'] = []
    TRAITS.forEach((t, i) => { if (e.has(t)) traits.push([i, dataOf(e, t)]) })
    const relations: SavedEntity['relations'] = []
    RELATIONS.forEach((r, i) => {
      for (const target of e.targetsFor(r)) relations.push([i, target.get(GameId)!.id, dataOf(e, r(target))])
    })
    entities.push({ gameId: g.id, traits, relations })
  })
  entities.sort(byGameId)
  return { world: WORLD_TRAITS.map((t) => copy(world.get(t)!)), entities }
}

/** Empties the same world and respawns every entity, then links the relations by gameId. */
export const load = (ctx: Ctx, saved: Saved): void => {
  const { world } = ctx
  destroyAll(world, GameId) // the onRemove(Unit) observer takes the units out of the grid and the gameId map
  ctx.unitAt.length = ctx.teamAt.length = ctx.inGrid.length = ctx.idAt.length = 0
  WORLD_TRAITS.forEach((t, i) => world.set(t, copy(saved.world[i])))

  const byId = new Map<number, Entity>()
  for (const s of saved.entities) {
    byId.set(s.gameId, world.spawn(...s.traits.map(([i, v]) => (v ? TRAITS[i](copy(v)) : TRAITS[i]))))
  }
  for (const s of saved.entities) {
    const e = byId.get(s.gameId)!
    for (const [i, target, v] of s.relations) e.add(v ? RELATIONS[i](byId.get(target)!, copy(v)) : RELATIONS[i](byId.get(target)!))
  }

  // The kernel grid and the gameId lookup hold every unit that is not garrisoned (SPEC 3.2).
  world.query(Unit, GameId, Team, Position).readEach(([g, t, p], e) => {
    const h = e.id()
    ctx.unitAt[h] = e; ctx.teamAt[h] = t.value; ctx.idAt[h] = g.id
    ctx.unitById.set(g.id, e)
    ctx.inGrid[h] = !e.has(Garrisoned)
    if (ctx.inGrid[h]) ctx.grid.add(h, g.id, p.x, p.y)
  })

  // The respawn raised observer and tracker events. Drop them so no event of the discarded ticks reaches the next tick.
  ctx.dirty.clear()
  for (const tracker of ctx.q.trackers) world.query(tracker)
}
