// SPEC-survivors §10 save and load, emulated as in the RTS impl: iris 0.0.14 has no snapshot or serialize API.
// A query over `GameId` lists the entities, `hasComponent` and `getComponent` read each component, `getRelationTargets` reads the
// ChildOf target as a gameId. `resetWorld` empties the world and keeps every definition and observer, then `load` creates the entities
// again.
import {
  addComponent, collectEntities, type ComponentEntry, createEntity, type EntityId, getComponentValue, getRelationTargets, hasComponent,
  pair, resetWorld,
} from 'iris-ecs'
import { copy, type Data, dataOf, GameId, resourceData, restoreResource } from '../shared/components.ts'
import {
  Affix, Attracted, Aux, BossPhase, Charger, Chase, ChildOf, Fuses, Heals, Hostile, Hp, Incoming, Kind, Kite, Mob, Orbiter, Particle,
  Phases, Pickup, Player, PlayerHp, Position, Projectile, Run, Shoots, STATUS_TAGS, Summoned, Summons, TRAIT_TAGS, Ttl, Velocity, Weave,
} from './components.ts'
import type { Ctx } from './context.ts'
import { makeHeld } from './entities.ts'
import { discardEvents } from './events.ts'
import { heldList, refreshLoadout } from './loadout.ts'
import { identified } from './queries.ts'

// Every component an entity can carry. A component missing here is lost by a load, and the replay hashes catch that.
const COMPONENTS: readonly EntityId[] = [
  GameId, Position, Velocity, Player, Mob, Projectile, Pickup, Particle, Ttl, Kind, Hp, Affix, Aux, Incoming, PlayerHp,
  Chase, Weave, Charger, Kite, Shoots, Summons, Heals, Fuses, Phases, BossPhase, Summoned, ...STATUS_TAGS, ...TRAIT_TAGS, Orbiter, Hostile,
  Attracted,
]

interface SavedEntity {
  gameId: number
  components: [index: number, value: Data | null][]
  /** The gameId of the summoner (`ChildOf` target), or 0. */
  childOf: number
}
export interface Saved { tick: number; run: Data; held: [id: number, level: number, cd: number][]; entities: SavedEntity[] }

export const save = (ctx: Ctx): Saved => {
  const { world } = ctx
  const entities: SavedEntity[] = []
  for (const e of collectEntities(world, identified)) {
    const components: SavedEntity['components'] = []
    COMPONENTS.forEach((c, i) => {
      if (hasComponent(world, e, c)) components.push([i, dataOf(world, e, c)])
    })
    const summoner = getRelationTargets(world, e, ChildOf)[0]
    entities.push({
      gameId: getComponentValue(world, e, GameId, 'id'),
      components,
      childOf: summoner === undefined ? 0 : getComponentValue(world, summoner, GameId, 'id')!,
    })
  }
  entities.sort((a, b) => a.gameId - b.gameId)
  return { tick: ctx.tick, run: resourceData(world, Run), held: heldList(ctx).map((h) => [h.id, h.level, h.cd]), entities }
}

export const load = (ctx: Ctx, saved: Saved): void => {
  const { world } = ctx
  ctx.mobs.clear()
  ctx.entityOf.clear()
  resetWorld(world)
  ctx.tick = saved.tick
  restoreResource(world, Run, saved.run)
  const created = new Map<number, EntityId>()
  const entry = ([i, v]: SavedEntity['components'][number]) => (v ? [COMPONENTS[i], copy(v)!] : COMPONENTS[i]) as ComponentEntry
  for (const s of saved.entities) {
    const e = createEntity(world, s.components.map(entry))
    created.set(s.gameId, e)
    if (hasComponent(world, e, Player)) ctx.player = e
    if (hasComponent(world, e, Mob)) {
      const kind = getComponentValue(world, e, Kind, 'value')!
      const x = getComponentValue(world, e, Position, 'x')!, y = getComponentValue(world, e, Position, 'y')!
      ctx.mobs.track(e, s.gameId, kind, x, y)
    }
  }
  for (const s of saved.entities) if (s.childOf) addComponent(world, created.get(s.gameId)!, pair(ChildOf, created.get(s.childOf)!))
  for (const [id, level, cd] of saved.held) makeHeld(ctx, id, level, cd)
  refreshLoadout(ctx)
  discardEvents(ctx.events)
}
