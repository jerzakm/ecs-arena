// SPEC-survivors §10. The save is a plain data tree. Links are gameIds, so nothing in it points into the live world.
// bitECS 0.4 has a snapshot serializer, but it writes native ids and cannot carry the relation, so the save is emulated like the RTS one:
// each entity kind is read through a query and written as its fields.
// `load` empties the world with `resetWorld` and spawns every entity again.
import type { survivors } from '@ecs-arena/spec'
import { addComponent, getRelationTargets, hasComponent, resetWorld } from 'bitecs'
import { BurnStacks, Dying, Elite, Mob, Particle, Pickup, Player, Position, Projectile, SummonedBy, TIMED, Velocity } from './components.ts'
import { GameId } from '../shared/components.ts'
import { observeWorld, type Ctx, type Resources } from './context.ts'
import { addMob, addPart, addPickup, addProj, spawnPlayer } from './entities.ts'
import { discardEvents } from './events.ts'
import { heldList, refreshLoadout, setHeld, type HeldEntry } from './loadout.ts'
import { Q } from './queries.ts'
import { addTag } from './tags.ts'
import { sortedByGameId } from '../shared/util.ts'

interface SavedMob {
  gameId: number; kind: number; x: number; y: number; vx: number; vy: number; hp: number; shield: number; affix: number; aux: number
  timed: [id: number, until: number, stacks: number][]; elite: boolean; dying: boolean; summoner: number
}
export interface Saved {
  world: Resources; totals: survivors.kernel.Totals; player: { x: number; y: number; hp: number; iframes: number }; held: HeldEntry[]
  mobs: SavedMob[]
  projs: (Parameters<typeof addProj>[2] & { gameId: number })[]
  pickups: { gameId: number; kind: number; x: number; y: number; value: number; ttl: number; attracted: number }[]
  parts: { gameId: number; kind: number; x: number; y: number; vx: number; vy: number; ttl: number }[]
}

export const save = (ctx: Ctx): Saved => {
  const { world, player, k } = ctx
  return {
    world: structuredClone({ ...world }),
    totals: structuredClone(ctx.totals),
    player: { x: Position.x[player], y: Position.y[player], hp: Player.hp[player], iframes: Player.iframes[player] },
    held: heldList(ctx),
    mobs: sortedByGameId(ctx, Q.mobs).map((m) => {
      const timed: SavedMob['timed'] = []
      for (let id = 0; id < TIMED.length; id++)
        if (hasComponent(world, m, TIMED[id])) timed.push([id, TIMED[id].until[m], id === k.STATUS.BURNING ? BurnStacks.n[m] : 0])
      const by = getRelationTargets(world, m, SummonedBy)[0]
      return {
        gameId: GameId.id[m], kind: Mob.kind[m], x: Position.x[m], y: Position.y[m], vx: Velocity.x[m], vy: Velocity.y[m], hp: Mob.hp[m],
        shield: Mob.shield[m], affix: Mob.affix[m], aux: Mob.aux[m], timed, elite: hasComponent(world, m, Elite),
        dying: hasComponent(world, m, Dying),
        summoner: by === undefined ? -1 : GameId.id[by],
      }
    }),
    projs: sortedByGameId(ctx, Q.projs).map((p) => ({
      gameId: GameId.id[p], weapon: Projectile.weapon[p], owner: Projectile.owner[p], traits: Projectile.traits[p], x: Position.x[p],
      y: Position.y[p], vx: Velocity.x[p], vy: Velocity.y[p], ttl: Projectile.ttl[p], pierceLeft: Projectile.pierceLeft[p],
      bounceLeft: Projectile.bounceLeft[p], hitMask: Projectile.hitMask[p], target: Projectile.target[p],
    })),
    pickups: sortedByGameId(ctx, Q.pickups).map((p) => ({
      gameId: GameId.id[p], kind: Pickup.kind[p], x: Position.x[p], y: Position.y[p], value: Pickup.value[p], ttl: Pickup.ttl[p],
      attracted: Pickup.attracted[p],
    })),
    parts: sortedByGameId(ctx, Q.parts).map((p) => ({
      gameId: GameId.id[p], kind: Particle.kind[p], x: Position.x[p], y: Position.y[p], vx: Velocity.x[p], vy: Velocity.y[p],
      ttl: Particle.ttl[p],
    })),
  }
}

/** Empties the same world and spawns every entity again, in gameId order.
 * The new observers have seen only the respawn, and the event lists are empty. */
export const load = (ctx: Ctx, d: Saved): void => {
  const { world, k } = ctx
  for (const e of ctx.mobById.values()) ctx.grid.remove(e)
  resetWorld(world)
  ctx.mobById.clear()
  ctx.doomed.length = 0
  observeWorld(ctx)
  Object.assign(world, structuredClone(d.world))
  ctx.totals = structuredClone(d.totals)
  spawnPlayer(ctx, d.player.x, d.player.y)
  Player.hp[ctx.player] = d.player.hp; Player.iframes[ctx.player] = d.player.iframes
  setHeld(ctx, d.held)
  const loaded = new Map<number, number>()
  for (const s of d.mobs) {
    const e = addMob(ctx, s.gameId, s.kind, s.x, s.y, 0)
    loaded.set(s.gameId, e)
    Velocity.x[e] = s.vx; Velocity.y[e] = s.vy; Mob.hp[e] = Mob.prevHp[e] = s.hp
    Mob.shield[e] = s.shield; Mob.affix[e] = s.affix; Mob.aux[e] = s.aux
    for (const [id, until, stacks] of s.timed) addTag(ctx, e, id, until, stacks)
    if (s.elite) addTag(ctx, e, k.STATUS.ELITE, 0)
    if (s.dying) addTag(ctx, e, k.STATUS.DYING, 0)
  }
  for (const s of d.mobs) if (s.summoner !== -1) addComponent(world, loaded.get(s.gameId)!, SummonedBy(loaded.get(s.summoner)!))
  for (const s of d.projs) addProj(ctx, s.gameId, s)
  for (const s of d.pickups) addPickup(ctx, s.gameId, s.kind, s.x, s.y, s.value, s.ttl, s.attracted)
  for (const s of d.parts) addPart(ctx, s.gameId, s.kind, s.x, s.y, s.vx, s.vy, s.ttl)
  ctx.px = Position.x[ctx.player]; ctx.py = Position.y[ctx.player]
  discardEvents(ctx.events)
  refreshLoadout(ctx)
}
