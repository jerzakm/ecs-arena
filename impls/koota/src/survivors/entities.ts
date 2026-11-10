// Creating mobs, projectiles, pickups and particles, and the grid search around them. Each factory takes the next gameId (SPEC.md §5.6)
// and spawns every trait of the entity in one `world.spawn` call.
import type { ConfigurableTrait, Entity, TagTrait } from 'koota'
import { survivors } from '@ecs-arena/spec'
import type { Ctx } from './context.ts'
import {
  AFFIX_TAGS, Aux, Boss, Chase, Charger, Clock, Elite, Exploder, FiredBy, GameId, Ghost, Healer, Hostile, Hp, Incoming, Kind, Kite, Mob,
  Orbiter, Particle, Pickup, Position, Projectile, Shield, Shoot, Summon, SummonedBy, Targets, TIMED, TRAIT_TAGS, Totals, Ttl,
  Velocity, Weaver,
} from './traits.ts'
import { byGameId, tagsOf } from '../shared/util.ts'

const { STATUS, AFFIX, HAS, MOBS, bit } = survivors.kernel

/** Tags of a kind: the move tag, and one for each `has` bit that a system queries. */
const KIND_TAGS: TagTrait[][] = MOBS.map((d) => {
  const t = [d.move === 'chase' ? Chase : d.move === 'weave' ? Weaver : d.move === 'charge' ? Charger : Kite]
  if (d.has & HAS.SHOOT) t.push(Shoot)
  if (d.has & HAS.SUMMON) t.push(Summon)
  if (d.has & HAS.AURA) t.push(Healer)
  if (d.has & HAS.FUSE) t.push(Exploder)
  if (d.has & HAS.PHASE) t.push(Ghost)
  if (d.has & HAS.BOSSPHASE) t.push(Boss)
  return t
})

export interface MobOptions { elite?: boolean; affix?: (gameId: number) => number; summoner?: Entity }
export interface ProjSpec {
  weapon: number; owner: Entity; traits: number; x: number; y: number; vx: number; vy: number; ttl: number
  pierceLeft: number; bounceLeft: number; target?: Entity; orbiter?: boolean
}

/** Takes the next gameId. */
export const nextId = (ctx: Ctx): number => ctx.world.get(Totals)!.nextId++

/** Puts a mob into the kernel grid and the lookup tables of its handle. */
export const enrollMob = (ctx: Ctx, e: Entity): void => {
  const h = e.id()
  const p = e.get(Position)!
  ctx.mobAt[h] = e
  ctx.kindAt[h] = e.get(Kind)!.value
  ctx.grid.add(h, e.get(GameId)!.id, p.x, p.y)
}

export const makeMob = (ctx: Ctx, kind: number, x: number, y: number, o: MobOptions = {}): Entity => {
  const { k, world } = ctx
  const { tick } = world.get(Clock)!
  const gameId = nextId(ctx)
  const affix = o.affix ? o.affix(gameId) : 0
  const hp = k.mobMaxHp(kind, o.elite ? bit(STATUS.ELITE) : 0)
  const shielded = (affix & AFFIX.SHIELDED) !== 0
  const traits: ConfigurableTrait[] = [
    GameId({ id: gameId }), Mob, Kind({ value: kind }), Position({ x, y }), Velocity, Hp({ hp }),
    Shield({ value: shielded ? k.SHIELD_VALUE : 0 }), Aux, Incoming,
    TIMED[STATUS.SPAWNING]({ until: tick + k.DUR.SPAWNING }), ...KIND_TAGS[kind],
  ]
  if (o.elite) traits.push(Elite)
  for (let i = 0; i < AFFIX_TAGS.length; i++) if (affix & (1 << i)) traits.push(AFFIX_TAGS[i])
  if (shielded) traits.push(TIMED[STATUS.SHIELDED]({ until: tick + k.DUR.SHIELDED }))
  if (o.summoner) traits.push(SummonedBy(o.summoner))
  const e = world.spawn(...traits)
  enrollMob(ctx, e)
  return e
}

export const makeProj = (ctx: Ctx, s: ProjSpec): Entity => {
  const traits: ConfigurableTrait[] = [
    GameId({ id: nextId(ctx) }), Projectile({ weapon: s.weapon, pierceLeft: s.pierceLeft, bounceLeft: s.bounceLeft, hitMask: 0 }),
    Position({ x: s.x, y: s.y }), Velocity({ x: s.vx, y: s.vy }), Ttl({ value: s.ttl }), FiredBy(s.owner), ...tagsOf(TRAIT_TAGS, s.traits),
  ]
  if (s.weapon === -1) traits.push(Hostile)
  if (s.orbiter) traits.push(Orbiter)
  if (s.target) traits.push(Targets(s.target))
  return ctx.world.spawn(...traits)
}

export const makePickup = (ctx: Ctx, kind: number, x: number, y: number, value: number): Entity =>
  ctx.world.spawn(
    GameId({ id: nextId(ctx) }), Pickup({ kind, value, attracted: 0 }), Position({ x, y }),
    Ttl({ value: ctx.world.get(Clock)!.tick + ctx.k.PICKUP_LIFE }),
  )

export const makePart = (ctx: Ctx, kind: number, x: number, y: number, vx: number, vy: number, ttl: number): Entity =>
  ctx.world.spawn(GameId({ id: nextId(ctx) }), Particle({ kind }), Position({ x, y }), Velocity({ x: vx, y: vy }), Ttl({ value: ttl }))

/** The mobs within `r` of a point, in gameId order. */
export const near = (ctx: Ctx, x: number, y: number, r: number): { h: number; d2: number; gameId: number }[] => {
  const out: { h: number; d2: number; gameId: number }[] = []
  ctx.grid.forNear(x, y, r, (h, d2, gameId) => void out.push({ h, d2, gameId }))
  return out.sort(byGameId)
}
