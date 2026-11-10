// Creating mobs, projectiles, pickups, particles and held upgrades, and the grid search around the player. Each factory takes the next
// gameId (SPEC.md §5.6) and writes every component of the entity in one `createEntity` call.
import {
  addComponent, type ComponentEntry, createEntity, getComponentValue, type EntityId, getResourceValue, pair, setResourceValue,
} from 'iris-ecs'
import { survivors } from '@ecs-arena/spec'
import { GameId } from '../shared/components.ts'
import {
  Affix, Aux, BossPhase, Charger, Chase, ChildOf, Elite, Fuses, Heals, Held, Hostile, Hp, Incoming, Kind, Kite, Mob, Orbiter, Particle,
  Phases, Pickup, Position, Projectile, Run, Shielded, Shoots, Spawning, Summoned, Summons, TRAIT_TAGS, Ttl, Velocity, Weave,
} from './components.ts'
import type { Ctx } from './context.ts'

const { STATUS, HAS, MOBS, bit } = survivors.kernel

export interface MobOptions { elite?: boolean; summoner?: EntityId }
export interface ProjSpec {
  weapon: number; owner: number; traits: number; x: number; y: number; vx: number; vy: number; ttl: number
  pierceLeft?: number; bounceLeft?: number; target?: number // 0, 0 and -1 (no target) when left out
}

/** Takes the next gameId. */
export const nextId = (ctx: Ctx): number => {
  const id = getResourceValue(ctx.world, Run, 'nextId')!
  setResourceValue(ctx.world, Run, 'nextId', id + 1)
  return id
}

export const makeMob = (ctx: Ctx, kind: number, x: number, y: number, o: MobOptions = {}): EntityId => {
  const { k, world, scenario, tick } = ctx
  const id = nextId(ctx)
  const def = MOBS[kind]
  const elite = o.elite === true
  const affix = elite ? k.eliteAffixes(scenario.seed, tick, id) : 0
  const shield = affix & k.AFFIX.SHIELDED ? k.SHIELD_VALUE : 0
  const entries: ComponentEntry[] = [
    Mob, [GameId, { id }], [Position, { x, y }], [Velocity, { x: 0, y: 0 }], [Kind, { value: kind }],
    [Hp, { hp: k.mobMaxHp(kind, elite ? bit(STATUS.ELITE) : 0), shield }], [Affix, { bits: affix }],
    [Incoming, { dmg: 0, heal: 0, clear: 0 }],
    [Spawning, { until: tick + k.DUR.SPAWNING }],
  ]
  if (def.move === 'chase') entries.push(Chase)
  else if (def.move === 'weave') entries.push(Weave)
  else if (def.move === 'kite') entries.push(Kite)
  if (def.has & HAS.CHARGE) entries.push(Charger, [Aux, { value: 0 }])
  if (def.has & HAS.AURA) entries.push(Heals)
  if (def.has & HAS.SHOOT) entries.push(Shoots)
  if (def.has & HAS.SUMMON) entries.push(Summons)
  if (def.has & HAS.PHASE) entries.push(Phases)
  if (def.has & HAS.FUSE) entries.push(Fuses)
  if (def.has & HAS.BOSSPHASE) entries.push(BossPhase, [Aux, { value: 0 }])
  if (elite) entries.push(Elite)
  if (shield) entries.push([Shielded, { until: tick + k.DUR.SHIELDED }])
  if (o.summoner !== undefined) entries.push(Summoned)
  const e = createEntity(world, entries)
  if (o.summoner !== undefined) addComponent(world, e, pair(ChildOf, o.summoner))
  ctx.mobs.track(e, id, kind, x, y)
  return e
}

export const makeProj = (ctx: Ctx, s: ProjSpec): EntityId => {
  const { k } = ctx
  const entries: ComponentEntry[] = [
    [GameId, { id: nextId(ctx) }], [Position, { x: s.x, y: s.y }], [Velocity, { x: s.vx, y: s.vy }], [Ttl, { at: s.ttl }],
    [Projectile, {
      weapon: s.weapon, owner: s.owner, pierceLeft: s.pierceLeft ?? 0, bounceLeft: s.bounceLeft ?? 0, hitMask: 0, target: s.target ?? -1,
    }],
  ]
  for (let i = 0; i < TRAIT_TAGS.length; i++) if (s.traits & (1 << i)) entries.push(TRAIT_TAGS[i])
  if (s.weapon === -1) entries.push(Hostile)
  else if (k.aimOf(s.weapon) === 'orbit') entries.push(Orbiter)
  return createEntity(ctx.world, entries)
}

export const makePickup = (ctx: Ctx, kind: number, x: number, y: number, value: number): EntityId =>
  createEntity(ctx.world, [
    [GameId, { id: nextId(ctx) }], [Position, { x, y }], [Pickup, { kind, value }], [Ttl, { at: ctx.tick + ctx.k.PICKUP_LIFE }],
  ])

export const makePart = (ctx: Ctx, kind: number, x: number, y: number, vx: number, vy: number, ttl: number): EntityId =>
  createEntity(ctx.world, [
    [GameId, { id: nextId(ctx) }], [Position, { x, y }], [Velocity, { x: vx, y: vy }], [Particle, { kind }], [Ttl, { at: ttl }],
  ])

/** A held upgrade of the player. It takes no gameId. */
export const makeHeld = (ctx: Ctx, id: number, level: number, cd: number): EntityId => createEntity(ctx.world, [[Held, { id, level, cd }]])

/** Grid handles of the mobs within `r` of a point, ascending gameId. `ctx.mobs.entityAt[h]` is the mob. */
export const near = (ctx: Ctx, x: number, y: number, r: number): number[] => {
  const out: number[] = []
  const { grid, idAt } = ctx.mobs
  grid.forNear(x, y, r, (h) => out.push(h))
  return out.sort((a, b) => idAt[a] - idAt[b])
}

/** The squared distance from an entity with a `Position` to a point. */
export const distSqTo = (ctx: Ctx, e: EntityId, x: number, y: number): number =>
  ctx.k.distSq(getComponentValue(ctx.world, e, Position, 'x')!, getComponentValue(ctx.world, e, Position, 'y')!, x, y)
