// SPEC-survivors §10. koota 0.6.6 has no snapshot API, so the save is emulated like the RTS one: a query over `GameId` lists the entities,
// `has` and `get` read each trait, `targetFor` reads each relation. Relations in the save name a gameId, never a native id.
// The restore empties the world with `destroyAll` and respawns each entity (workarounds.ts explains why not `world.reset()`).
// The Held entities have no gameId, so the save lists them apart.
import type { Entity, Relation, Trait } from 'koota'
import { survivors } from '@ecs-arena/spec'
import type { Ctx } from './context.ts'
import { discardEvents } from './events.ts'
import { heldList, refreshLoadout } from './loadout.ts'
import { enrollMob } from './entities.ts'
import {
  AFFIX_TAGS, Aux, Boss, Charger, Chase, Clock, Dying, Elite, Exploder, FiredBy, GameId, Ghost, Healer, Held, Hostile, Hp, Incoming, Kind,
  Kite, Mob, Orbiter, Particle, Pickup, Player, Position, Projectile, Shield, Shoot, Summon, SummonedBy, TIMED, TRAIT_TAGS, Targets, Totals,
  Ttl, Velocity, Weaver,
} from './traits.ts'
import { byGameId, copy, dataOf, type Data } from '../shared/util.ts'
import { destroyAll } from '../shared/workarounds.ts'

// The traits that each class of entity can carry. A trait missing here is lost by a load, and the replay hashes catch that.
const MOB: Trait[] = [
  GameId, Mob, Kind, Position, Velocity, Hp, Shield, Aux, Incoming, Elite, Dying, Chase, Weaver, Charger, Kite, Shoot, Summon, Healer,
  Exploder, Ghost, Boss, ...AFFIX_TAGS, ...TIMED,
]
const PROJECTILE: Trait[] = [GameId, Projectile, Position, Velocity, Ttl, Hostile, Orbiter, ...TRAIT_TAGS]
const PICKUP: Trait[] = [GameId, Pickup, Position, Ttl]
const PARTICLE: Trait[] = [GameId, Particle, Position, Velocity, Ttl]
const PLAYER: Trait[] = [GameId, Player, Position, Hp, TIMED[survivors.kernel.STATUS.IFRAMES]]
const TRAITS: Trait[] = [...new Set([...MOB, ...PROJECTILE, ...PICKUP, ...PARTICLE, ...PLAYER])]
const INDEX = new Map(TRAITS.map((t, i) => [t, i]))
const WORLD_TRAITS: Trait[] = [Clock, Totals]
const RELATIONS: Relation[] = [FiredBy, Targets, SummonedBy]

interface SavedEntity {
  gameId: number
  traits: [index: number, value: Data | null][]
  relations: [index: number, targetGameId: number][]
}
export interface Saved { world: Data[]; entities: SavedEntity[]; held: { id: number; level: number; cd: number }[] }

export const save = (ctx: Ctx): Saved => {
  const { world } = ctx
  const entities: SavedEntity[] = []
  world.query(GameId).readEach(([g], e) => {
    const list = e.has(Mob) ? MOB : e.has(Projectile) ? PROJECTILE : e.has(Pickup) ? PICKUP : e.has(Particle) ? PARTICLE : PLAYER
    const traits: SavedEntity['traits'] = []
    for (const t of list) if (e.has(t)) traits.push([INDEX.get(t)!, dataOf(e, t)])
    const relations: SavedEntity['relations'] = []
    RELATIONS.forEach((r, i) => {
      const target = e.targetFor(r)
      if (target) relations.push([i, target.get(GameId)!.id])
    })
    entities.push({ gameId: g.id, traits, relations })
  })
  entities.sort(byGameId)
  return {
    world: WORLD_TRAITS.map((t) => copy(world.get(t)!)),
    entities,
    held: heldList(ctx).map(({ id, level, cd }) => ({ id, level, cd })),
  }
}

/** Empties the same world, respawns every entity, links the relations by gameId, and sends every mob to the grid again. */
export const load = (ctx: Ctx, saved: Saved): void => {
  const { k, world } = ctx
  destroyAll(world, GameId) // the onRemove(Mob) observer takes the mobs out of the grid
  destroyAll(world, Held)
  ctx.mobAt.length = ctx.kindAt.length = 0
  WORLD_TRAITS.forEach((t, i) => world.set(t, copy(saved.world[i])))

  const byId = new Map<number, Entity>()
  for (const s of saved.entities) {
    byId.set(s.gameId, world.spawn(...s.traits.map(([i, v]) => (v ? TRAITS[i](copy(v)) : TRAITS[i]))))
  }
  for (const s of saved.entities) {
    const e = byId.get(s.gameId)!
    for (const [i, target] of s.relations) e.add(RELATIONS[i](byId.get(target)!))
  }
  for (const h of saved.held) world.spawn(Held({ ...h }))
  ctx.player = byId.get(k.PLAYER_ID)!
  world.query(ctx.q.renderMobs).readEach((_, e) => enrollMob(ctx, e))

  // No event, pending hit or change flag of the discarded ticks reaches the next tick.
  discardEvents(ctx.events)
  for (const tracker of ctx.q.trackers) world.query(tracker)
  refreshLoadout(ctx)
}
