import {
  collectEntities, type EntityId, getComponent, getComponentValue, getResource, getResourceValue, hasComponent, type World,
} from 'iris-ecs'
import type { CanonicalState } from '@ecs-arena/spec'
import { GameId } from '../shared/components.ts'
import { byGameId, sortedByGameId } from '../shared/util.ts'
import {
  Age, AnyGarrison, Bannered, Burn, Chronicle, Clock, Cooldown, Equips, Fleeing, Ground, Haste, Health, ItemKind, KillCount, Kind,
  LastHitBy, MemberOf, Metrics, Morale, Overwhelmed, Position, Projectile, Routed, Score, Shrine, Stats, Stun, Targets, Team, Threat,
  Trail, Unit, Veteran,
} from './components.ts'
import type { Ctx } from './context.ts'
import { summonerOf, targetOf } from './links.ts'
import { garrisonOf } from './queries.ts'

/** SPEC §8 flags: Fleeing, Veteran, Routed, Overwhelmed, Bannered and in bits 0 to 5. */
export const flagsOf = (ctx: Ctx, e: EntityId): number => {
  const { world } = ctx
  return (hasComponent(world, e, Fleeing) ? 1 : 0) | (hasComponent(world, e, Veteran) ? 2 : 0) | (hasComponent(world, e, Routed) ? 4 : 0) |
    (hasComponent(world, e, Overwhelmed) ? 8 : 0) | (hasComponent(world, e, Bannered) ? 16 : 0) |
    (hasComponent(world, e, AnyGarrison) ? 32 : 0)
}

/** The gameId of an entity, or -1 for none. */
const idOrNone = (world: World, e: EntityId | undefined): number => (e === undefined ? -1 : getComponentValue(world, e, GameId, 'id')!)

export const snapshot = (ctx: Ctx): CanonicalState => {
  const { k, world } = ctx
  const { BUFF } = k
  const metrics = getResource(world, Metrics)!
  const score = getResource(world, Score)!
  const s: number[] = [
    getResourceValue(world, Clock, 'tick')!, metrics.alive0, metrics.alive1, metrics.kills0, metrics.kills1, metrics.damage0,
    metrics.damage1, metrics.winner, score.shrines0, score.shrines1, metrics.orders0, metrics.orders1, metrics.renderChain,
  ]

  const shrines = sortedByGameId(world, Shrine)
  s.push(shrines.length)
  for (const { id, e } of shrines) {
    const shrine = getComponent(world, e, Shrine)!
    const held = collectEntities(world, garrisonOf(e)).map((g) => getComponentValue(world, g, GameId, 'id')!).sort((a, b) => a - b)
    s.push(id, shrine.owner, shrine.progress, held.length, ...held)
  }

  const units = sortedByGameId(world, Unit)
  s.push(units.length)
  for (const { id, e } of units) {
    const pos = getComponent(world, e, Position)!, health = getComponent(world, e, Health)!, stats = getComponent(world, e, Stats)!
    s.push(
      id, getComponentValue(world, e, Team, 'value')!, getComponentValue(world, e, Kind, 'value')!, pos.x, pos.y, health.hp, health.maxHp,
      stats.attack, stats.armor, stats.speed, getComponentValue(world, e, Cooldown, 'value')!,
      idOrNone(world, targetOf(ctx, e, Targets)), idOrNone(world, targetOf(ctx, e, MemberOf)), idOrNone(world, summonerOf(world, e)),
    )
    const buffs: [number, number][] = []
    if (hasComponent(world, e, Stun)) buffs.push([BUFF.STUN, getComponentValue(world, e, Stun, 'ticksLeft')])
    if (hasComponent(world, e, Burn)) buffs.push([BUFF.BURN, getComponentValue(world, e, Burn, 'ticksLeft')])
    if (hasComponent(world, e, Haste)) buffs.push([BUFF.HASTE, getComponentValue(world, e, Haste, 'ticksLeft')])
    s.push(buffs.length)
    for (const [b, t] of buffs) s.push(b, t)
    const held = getComponentValue(world, e, Equips, 'items')!
    const items = Array.from({ length: held.length / 2 }, (_, i) => ({
      id: held[2 * i], e: ctx.entityOf.get(held[2 * i])!, quality: held[2 * i + 1],
    })).sort(byGameId)
    s.push(items.length)
    for (const it of items) s.push(it.id, getComponentValue(world, it.e, ItemKind, 'value')!, it.quality)
    s.push(flagsOf(ctx, e), getComponentValue(world, e, KillCount, 'value')!, idOrNone(world, targetOf(ctx, e, LastHitBy)))
    const morale = hasComponent(world, e, Morale) ? getComponent(world, e, Morale) : undefined
    s.push(morale?.size0 ?? -1, morale?.lost ?? -1)
    const flat = getComponentValue(world, e, Threat, 'edges')!
    const edges = Array.from({ length: flat.length / 2 }, (_, i) => ({ id: flat[2 * i], amount: flat[2 * i + 1] }))
      .filter((edge) => ctx.entityOf.has(edge.id))
      .sort(byGameId)
    s.push(edges.length)
    for (const edge of edges) s.push(edge.id, edge.amount)
    const chronicle = hasComponent(world, e, Chronicle) ? getComponentValue(world, e, Chronicle, 'kinds') : []
    s.push(chronicle.length, ...chronicle)
    const trail = hasComponent(world, e, Trail) ? getComponentValue(world, e, Trail, 'pts') : []
    s.push(trail.length >> 1, ...trail)
  }

  const projectiles = sortedByGameId(world, Projectile)
  s.push(projectiles.length)
  for (const { id, e } of projectiles) {
    const pos = getComponent(world, e, Position)!, shot = getComponent(world, e, Projectile)!
    const age = getComponentValue(world, e, Age, 'value')!
    s.push(id, shot.owner, idOrNone(world, targetOf(ctx, e, Targets)), pos.x, pos.y, age, shot.speed, shot.volley)
  }

  const ground = sortedByGameId(world, Ground)
  s.push(ground.length)
  for (const { id, e } of ground) {
    const pos = getComponent(world, e, Position)!
    const item = getComponentValue(world, e, ItemKind, 'value')!, quality = getComponentValue(world, e, Ground, 'quality')!
    s.push(id, item, quality, pos.x, pos.y, getComponentValue(world, e, Age, 'value')!)
  }
  return s
}
