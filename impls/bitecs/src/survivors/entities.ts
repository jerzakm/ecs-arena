// Creating the player, mobs, projectiles, pickups and particles, destroying them, and the grid search around them.
// Each `make*` takes the next gameId (SPEC.md §5.6). `load` calls the `add*` functions with a saved gameId.
import { addComponent, addComponents, addEntity, entityExists, removeComponent, removeEntity } from 'bitecs'
import { survivors } from '@ecs-arena/spec'
import {
  Boss, CAP, Charger, Chase, Exploder, Explosive, Ghost, Healer, Homing, Hostile, Kite, Mob, Orbiter, Particle, Pickup, Player, Position,
  Projectile, Returning, Shooter, Summoner, Velocity, Weave,
} from './components.ts'
import { GameId } from '../shared/components.ts'
import type { Ctx } from './context.ts'
import { addTag } from './tags.ts'

const { STATUS, TRAIT, HAS, MOB } = survivors.kernel

/** The trait bits that have a tag on the projectile. */
const TRAIT_TAGS = [[TRAIT.HOMING, Homing], [TRAIT.RETURN, Returning], [TRAIT.EXPLODE, Explosive]] as const

export const nextId = (ctx: Ctx): number => ctx.totals.nextId++

export const newEntity = (ctx: Ctx): number => {
  const e = addEntity(ctx.world)
  if (e >= CAP) throw new Error(`entity id ${e} is over the store capacity ${CAP}`)
  return e
}

export const spawnPlayer = (ctx: Ctx, x: number, y: number): number => {
  const e = newEntity(ctx)
  addComponents(ctx.world, e, [Player, GameId, Position])
  GameId.id[e] = ctx.k.PLAYER_ID
  Position.x[e] = x; Position.y[e] = y
  Player.hp[e] = ctx.k.PLAYER_HP; Player.iframes[e] = 0
  ctx.player = e
  return e
}

/** Allocates a mob with a known gameId and no spawn tag. `makeMob` and `load` use it. */
export const addMob = (ctx: Ctx, gameId: number, kind: number, x: number, y: number, flags: number): number => {
  const { world, k } = ctx
  const e = newEntity(ctx)
  addComponents(world, e, [Mob, GameId, Position, Velocity])
  GameId.id[e] = gameId
  Position.x[e] = x; Position.y[e] = y; Velocity.x[e] = 0; Velocity.y[e] = 0
  Mob.kind[e] = kind; Mob.hp[e] = Mob.prevHp[e] = k.mobMaxHp(kind, flags)
  Mob.shield[e] = 0; Mob.flags[e] = 0; Mob.affix[e] = 0; Mob.aux[e] = 0
  Mob.dmgIn[e] = Mob.healIn[e] = Mob.clearIn[e] = 0
  const def = k.MOBS[kind]
  if (def.move === 'chase') addComponent(world, e, Chase)
  else if (def.move === 'weave') addComponent(world, e, Weave)
  else if (def.move === 'charge') addComponent(world, e, Charger)
  else addComponent(world, e, Kite)
  if (def.has & HAS.SHOOT) addComponent(world, e, Shooter)
  if (def.has & HAS.SUMMON) addComponent(world, e, Summoner)
  if (def.has & HAS.AURA) addComponent(world, e, Healer)
  if (def.has & HAS.FUSE) addComponent(world, e, Exploder)
  if (def.has & HAS.PHASE) addComponent(world, e, Ghost)
  if (kind === MOB.BOSS) addComponent(world, e, Boss)
  ctx.mobById.set(gameId, e)
  ctx.grid.add(e, gameId, x, y)
  if (flags & k.bit(STATUS.ELITE)) addTag(ctx, e, STATUS.ELITE, 0)
  return e
}
export const makeMob = (ctx: Ctx, kind: number, x: number, y: number, flags = 0): number => {
  const e = addMob(ctx, nextId(ctx), kind, x, y, flags)
  addTag(ctx, e, STATUS.SPAWNING, ctx.world.tick + ctx.k.DUR.SPAWNING)
  return e
}

export interface ProjInit {
  weapon: number; owner: number; traits: number; x: number; y: number; vx: number; vy: number
  ttl: number; pierceLeft: number; bounceLeft: number; hitMask: number; target: number
}
/** Writes the traits and the tags that follow the trait bits. */
export const setTraits = (ctx: Ctx, e: number, traits: number): void => {
  Projectile.traits[e] = traits
  for (const [bit, tag] of TRAIT_TAGS) {
    if (traits & bit) addComponent(ctx.world, e, tag)
    else removeComponent(ctx.world, e, tag)
  }
}
export const addProj = (ctx: Ctx, gameId: number, f: ProjInit): number => {
  const e = newEntity(ctx)
  addComponents(ctx.world, e, [Projectile, GameId, Position, Velocity])
  GameId.id[e] = gameId
  Position.x[e] = f.x; Position.y[e] = f.y; Velocity.x[e] = f.vx; Velocity.y[e] = f.vy
  Projectile.weapon[e] = f.weapon; Projectile.owner[e] = f.owner; Projectile.ttl[e] = f.ttl
  Projectile.pierceLeft[e] = f.pierceLeft; Projectile.bounceLeft[e] = f.bounceLeft
  Projectile.hitMask[e] = f.hitMask; Projectile.target[e] = f.target
  setTraits(ctx, e, f.traits)
  if (f.weapon === -1) addComponent(ctx.world, e, Hostile)
  else if (ctx.k.aimOf(f.weapon) === 'orbit') addComponent(ctx.world, e, Orbiter)
  return e
}
export const makeProj = (ctx: Ctx, f: ProjInit): number => addProj(ctx, nextId(ctx), f)

export const addPickup = (
  ctx: Ctx, gameId: number, kind: number, x: number, y: number, value: number, ttl: number, attracted: number,
): number => {
  const e = newEntity(ctx)
  addComponents(ctx.world, e, [Pickup, GameId, Position])
  GameId.id[e] = gameId; Position.x[e] = x; Position.y[e] = y
  Pickup.kind[e] = kind; Pickup.value[e] = value; Pickup.ttl[e] = ttl; Pickup.attracted[e] = attracted
  return e
}
export const makePickup = (ctx: Ctx, kind: number, x: number, y: number, value: number): number =>
  addPickup(ctx, nextId(ctx), kind, x, y, value, ctx.world.tick + ctx.k.PICKUP_LIFE, 0)

export const addPart = (ctx: Ctx, gameId: number, kind: number, x: number, y: number, vx: number, vy: number, ttl: number): number => {
  const e = newEntity(ctx)
  addComponents(ctx.world, e, [Particle, GameId, Position, Velocity])
  GameId.id[e] = gameId; Position.x[e] = x; Position.y[e] = y; Velocity.x[e] = vx; Velocity.y[e] = vy
  Particle.kind[e] = kind; Particle.ttl[e] = ttl
  return e
}
export const makePart = (ctx: Ctx, kind: number, x: number, y: number, vx: number, vy: number, ttl: number): number =>
  addPart(ctx, nextId(ctx), kind, x, y, vx, vy, ttl)

/** The entity is removed by the next `flush`. A destroy of a mob also removes its minions (the `SummonedBy` relation). */
export const destroy = (ctx: Ctx, e: number): void => void ctx.doomed.push(e)
export const flush = (ctx: Ctx): void => {
  const { doomed, world } = ctx
  for (let i = 0; i < doomed.length; i++) if (entityExists(world, doomed[i])) removeEntity(world, doomed[i])
  doomed.length = 0
}

/** The mobs within `r` of a point, as entities. */
export const near = (ctx: Ctx, x: number, y: number, r: number): number[] => {
  const out: number[] = []
  ctx.grid.forNear(x, y, r, (h) => out.push(h))
  return out
}
