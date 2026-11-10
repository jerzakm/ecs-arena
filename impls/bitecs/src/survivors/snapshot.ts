import { getRelationTargets, hasComponent, query } from 'bitecs'
import { survivors, type CanonicalState } from '@ecs-arena/spec'
import { BurnStacks, Mob, Particle, Pickup, Player, Position, Projectile, SummonedBy, TIMED, Velocity } from './components.ts'
import { GameId } from '../shared/components.ts'
import type { Ctx } from './context.ts'
import { heldList } from './loadout.ts'
import { Q } from './queries.ts'
import { sortedByGameId } from '../shared/util.ts'

const { STATUS } = survivors.kernel

/** SPEC-survivors §8. A link to an entity that does not exist is -1. */
export const snapshot = (ctx: Ctx): CanonicalState => {
  const { world, totals, player, mobById, k } = ctx
  const live = (id: number) => (id === k.PLAYER_ID || mobById.has(id) ? id : -1)
  const held = heldList(ctx)
  const s: number[] = [
    ...survivors.kernel.worldHeader(totals),
    Position.x[player], Position.y[player], Player.hp[player], Player.iframes[player] ? k.bit(STATUS.IFRAMES) : 0, Player.iframes[player],
    held.length,
  ]
  for (const h of held) s.push(h.id, h.level, h.cd)
  const summoner = new Map<number, number>()
  for (const m of query(world, Q.minions)) summoner.set(m, GameId.id[getRelationTargets(world, m, SummonedBy)[0]])
  const mobs = sortedByGameId(ctx, Q.mobs)
  s.push(mobs.length)
  for (const m of mobs) {
    const timed: number[] = []
    for (let id = 0; id < TIMED.length; id++) {
      if (hasComponent(world, m, TIMED[id])) timed.push(id, TIMED[id].until[m], id === STATUS.BURNING ? BurnStacks.n[m] : 0)
    }
    s.push(
      GameId.id[m], Mob.kind[m], Position.x[m], Position.y[m], Velocity.x[m], Velocity.y[m], Mob.hp[m], Mob.shield[m],
      Mob.flags[m], Mob.affix[m], Mob.aux[m], timed.length / 3, ...timed, summoner.get(m) ?? -1,
    )
  }
  const projs = sortedByGameId(ctx, Q.projs)
  s.push(projs.length)
  for (const p of projs) {
    const owner = Projectile.owner[p], target = Projectile.target[p]
    s.push(
      GameId.id[p], Projectile.weapon[p], owner === -1 ? -1 : live(owner), Projectile.traits[p], Position.x[p], Position.y[p],
      Velocity.x[p], Velocity.y[p], Projectile.ttl[p], Projectile.pierceLeft[p], Projectile.bounceLeft[p], Projectile.hitMask[p],
      target === -1 ? -1 : live(target),
    )
  }
  const pickups = sortedByGameId(ctx, Q.pickups)
  s.push(pickups.length)
  for (const p of pickups) {
    s.push(GameId.id[p], Pickup.kind[p], Position.x[p], Position.y[p], Pickup.value[p], Pickup.ttl[p], Pickup.attracted[p])
  }
  const parts = sortedByGameId(ctx, Q.parts)
  s.push(parts.length)
  for (const p of parts) s.push(GameId.id[p], Particle.kind[p], Position.x[p], Position.y[p], Velocity.x[p], Velocity.y[p], Particle.ttl[p])
  return s
}
