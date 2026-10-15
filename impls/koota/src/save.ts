// SPEC §10 save and load. koota 0.6.6 has no snapshot or serialize API, so the save is emulated: a query over `GameId` lists
// the entities, `has` and `get` read each trait, `targetsFor` reads each relation. Relations in the save name a gameId, never a native id.
// koota teaches `world.reset()` for emptying a world, but 0.6.6 breaks the trackers with it, so the restore destroys each entity and respawns it.
import type { Entity, Relation, Trait } from 'koota'
import type { Context } from './context.ts'
import {
  Age, Bannered, Burn, Chronicle, Trail, Clock, Cooldown, Dead, Fleeing, GameId, Garrisoned, Ground, Haste, Health, Item, ItemKind, ItemTags, KillCount, Kind, Metrics, Minion, Morale,
  NextId, Overwhelmed, Position, Projectile, Routed, Score, Shrine, Spent, Start, Stats, Stun, Summoner, Team, Unit, Veteran,
} from './components.ts'
import { ChildOf, Equips, FiredBy, GarrisonOf, LastHitBy, MemberOf, Targets, Threat } from './relations.ts'

// Every trait an entity can carry. A trait missing here is lost by a load, and the replay hashes catch that.
const TRAITS: Trait[] = [
  GameId, Position, Start, Team, Kind, Health, Stats, Cooldown, Age, KillCount, Morale, Chronicle, Trail, Shrine, Summoner, ItemKind, Ground, Projectile,
  Unit, Minion, Item, Dead, Spent, Fleeing, Routed, Veteran, Overwhelmed, Bannered, Garrisoned, ...ItemTags, Stun, Burn, Haste,
]
const WORLD_TRAITS: Trait[] = [Clock, NextId, Metrics, Score]
// The relations differ in their data type, and the save treats the data as an opaque record.
const RELATIONS: Relation<any>[] = [Targets, ChildOf, MemberOf, Equips, Threat, GarrisonOf, LastHitBy, FiredBy]

type Data = Record<string, unknown>
/** A trait value without the trait: `null` for a tag. Arrays are copied, so the save shares nothing with the world. */
const copy = (v: Data | undefined): Data | null => {
  if (!v) return null
  const out: Data = { ...v }
  for (const key in out) if (Array.isArray(out[key])) out[key] = [...(out[key] as unknown[])]
  return out
}

interface SavedEntity {
  gameId: number
  traits: [index: number, value: Data | null][]
  relations: [index: number, targetGameId: number, value: Data | null][]
}
export interface Saved { world: (Data | null)[]; entities: SavedEntity[] }

export const save = (ctx: Context): Saved => {
  const { world, gid } = ctx
  const entities: SavedEntity[] = []
  world.query(GameId).readEach(([g], e) => {
    const traits: SavedEntity['traits'] = []
    TRAITS.forEach((t, i) => { if (e.has(t)) traits.push([i, copy(e.get(t) as Data | undefined)]) })
    const relations: SavedEntity['relations'] = []
    RELATIONS.forEach((r, i) => {
      for (const target of e.targetsFor(r)) relations.push([i, gid(target), copy(e.get(r(target)) as Data | undefined)])
    })
    entities.push({ gameId: g.id, traits, relations })
  })
  entities.sort((a, b) => a.gameId - b.gameId)
  return { world: WORLD_TRAITS.map((t) => copy(world.get(t) as Data)), entities }
}

/**
 * Empties the same world and respawns every entity, then links the relations by gameId. `world.reset()` is not used: in 0.6.6 it drops
 * the observers and the tracker masks, and the next query that holds `Added` or `Changed` throws. Destroying each entity keeps both.
 */
export const load = (ctx: Context, saved: Saved): void => {
  const { world } = ctx
  const live: Entity[] = []
  world.query(GameId).readEach((_, e) => void live.push(e))
  for (const e of live) if (e.isAlive()) e.destroy() // the onRemove(Unit) observer takes the units out of the grid and the gameId map
  ctx.unitAt.length = ctx.teamAt.length = ctx.inGrid.length = ctx.idAt.length = 0
  world.set(Clock, saved.world[0] as Data); world.set(NextId, saved.world[1] as Data); world.set(Metrics, saved.world[2] as Data); world.set(Score, saved.world[3] as Data)

  const byGameId = new Map<number, Entity>()
  for (const s of saved.entities) {
    byGameId.set(s.gameId, world.spawn(...s.traits.map(([i, v]) => (v ? TRAITS[i](copy(v) as Data) : TRAITS[i]))))
  }
  for (const s of saved.entities) {
    const e = byGameId.get(s.gameId)!
    for (const [i, target, v] of s.relations) e.add(v ? RELATIONS[i](byGameId.get(target)!, copy(v) as Data) : RELATIONS[i](byGameId.get(target)!))
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
  world.query(ctx.q.newlyRouted); world.query(ctx.q.newlyFleeing); world.query(ctx.q.newlyVeteran); world.query(ctx.q.killsChanged) // a tracker resets when it is read
}
