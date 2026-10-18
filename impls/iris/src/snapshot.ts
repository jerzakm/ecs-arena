import { collectEntities, hasComponent, pair, type EntityId } from 'iris-ecs'
import type { CanonicalState } from '@ecs-arena/spec'
import { byGameId, type Context } from './context.ts'
import {
  Age, Bannered, Burn, Chronicle, Trail, Cooldown, Fleeing, Ground, Haste, Health, ItemKind, KillCount, Kind, LastHitBy, MemberOf, Metrics, Morale, Overwhelmed, Position, Projectile,
  Routed, Score, Shrine, Stats, Stun, Targets, Team, Unit, Veteran,
} from './components.ts'
import { AnyGarrison, GarrisonOf } from './relations.ts'

type MetricField = 'alive0' | 'alive1' | 'kills0' | 'kills1' | 'damage0' | 'damage1' | 'orders0' | 'orders1' | 'renderChain' | 'winner'

/** SPEC §8 flags: Fleeing, Veteran, Routed, Overwhelmed, Bannered and in bits 0 to 5. */
export const flagsOf = (ctx: Context, e: EntityId): number => {
  const has = (c: EntityId) => hasComponent(ctx.world, e, c)
  return (has(Fleeing) ? 1 : 0) | (has(Veteran) ? 2 : 0) | (has(Routed) ? 4 : 0) | (has(Overwhelmed) ? 8 : 0) | (has(Bannered) ? 16 : 0) | (has(AnyGarrison) ? 32 : 0)
}

export const snapshot = (ctx: Context): CanonicalState => {
  const { world, gid, get, sortedByGameId, targetOf } = ctx
  const { BUFF } = ctx.k
  const has = (e: EntityId, c: EntityId) => hasComponent(world, e, c)
  const metric = (f: MetricField) => ctx.res(Metrics, f)
  const s: number[] = [
    ctx.tickNow(), metric('alive0'), metric('alive1'), metric('kills0'), metric('kills1'), metric('damage0'), metric('damage1'), metric('winner'),
    ctx.res(Score, 'shrines0'), ctx.res(Score, 'shrines1'), metric('orders0'), metric('orders1'), metric('renderChain'),
  ]

  const shrines = sortedByGameId(Shrine)
  s.push(shrines.length)
  for (const { id, e } of shrines) {
    const held = collectEntities(world, [pair(GarrisonOf, e)]).map(gid).sort((a, b) => a - b)
    s.push(id, get(e, Shrine, 'owner'), get(e, Shrine, 'progress'), held.length, ...held)
  }

  const units = sortedByGameId(Unit)
  s.push(units.length)
  for (const { id, e } of units) {
    const target = targetOf(e, Targets), leader = targetOf(e, MemberOf), parent = ctx.summonerOf(e)
    s.push(
      id, get(e, Team, 'value'), get(e, Kind, 'value'), get(e, Position, 'x'), get(e, Position, 'y'), get(e, Health, 'hp'), get(e, Health, 'maxHp'),
      get(e, Stats, 'attack'), get(e, Stats, 'armor'), get(e, Stats, 'speed'), get(e, Cooldown, 'value'),
      target !== undefined ? gid(target) : -1, leader !== undefined ? gid(leader) : -1, parent !== undefined ? gid(parent) : -1
    )
    const buffs: [number, number][] = []
    if (has(e, Stun)) buffs.push([BUFF.STUN, get(e, Stun, 'ticksLeft')])
    if (has(e, Burn)) buffs.push([BUFF.BURN, get(e, Burn, 'ticksLeft')])
    if (has(e, Haste)) buffs.push([BUFF.HASTE, get(e, Haste, 'ticksLeft')])
    s.push(buffs.length)
    for (const [b, t] of buffs) s.push(b, t)
    const held = ctx.equipsOf(e)
    const items = Array.from({ length: held.length / 2 }, (_, i) => ({ id: held[2 * i], e: ctx.entityOf.get(held[2 * i])!, quality: held[2 * i + 1] })).sort(byGameId)
    s.push(items.length)
    for (const it of items) s.push(it.id, get(it.e, ItemKind, 'value'), it.quality)
    const hitBy = targetOf(e, LastHitBy)
    s.push(flagsOf(ctx, e), get(e, KillCount, 'value'), hitBy !== undefined ? gid(hitBy) : -1)
    s.push(has(e, Morale) ? get(e, Morale, 'size0') : -1, has(e, Morale) ? get(e, Morale, 'lost') : -1)
    const flat = ctx.threatOf(e)
    const edges = Array.from({ length: flat.length / 2 }, (_, i) => ({ id: flat[2 * i], amount: flat[2 * i + 1] })).filter((edge) => ctx.entityOf.has(edge.id)).sort(byGameId)
    s.push(edges.length)
    for (const edge of edges) s.push(edge.id, edge.amount)
    const chronicle = has(e, Chronicle) ? get(e, Chronicle, 'kinds') : []
    s.push(chronicle.length, ...chronicle)
    const trail = has(e, Trail) ? get(e, Trail, 'pts') : []
    s.push(trail.length >> 1, ...trail)
  }

  const projectiles = sortedByGameId(Projectile)
  s.push(projectiles.length)
  for (const { id, e } of projectiles) {
    const t = targetOf(e, Targets)
    s.push(id, get(e, Projectile, 'owner'), t !== undefined ? gid(t) : -1, get(e, Position, 'x'), get(e, Position, 'y'), get(e, Age, 'value'), get(e, Projectile, 'speed'), get(e, Projectile, 'volley'))
  }

  const ground = sortedByGameId(Ground)
  s.push(ground.length)
  for (const { id, e } of ground) {
    s.push(id, get(e, ItemKind, 'value'), get(e, Ground, 'quality'), get(e, Position, 'x'), get(e, Position, 'y'), get(e, Age, 'value'))
  }
  return s
}
