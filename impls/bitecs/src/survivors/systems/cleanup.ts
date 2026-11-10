import { query } from 'bitecs'
import { survivors } from '@ecs-arena/spec'
import { Mob, Particle, Pickup, Player, Position, Projectile } from '../components.ts'
import { GameId } from '../../shared/components.ts'
import type { Ctx } from '../context.ts'
import { destroy, flush, makeMob, makePart, makePickup } from '../entities.ts'
import { killEvents, pushEvent } from '../events.ts'
import { hurtPlayer } from '../hits.ts'
import { Q } from '../queries.ts'
import { sortedByGameId } from '../../shared/util.ts'
const { STATUS, MOB, PICKUP_KIND, PARTICLE_KIND, EVENT } = survivors.kernel
type CleanupIds = 'cleanup.ttl' | 'cleanup.death' | 'cleanup.drops' | 'cleanup.cascade'
export const cleanupSystems: Pick<survivors.SystemTable<Ctx>, CleanupIds> = {
  'cleanup.ttl': (ctx) => () => {
    const tick = ctx.world.tick
    for (const p of query(ctx.world, Q.projs)) if (Projectile.ttl[p] <= tick) destroy(ctx, p)
    for (const p of query(ctx.world, Q.pickups)) if (Pickup.ttl[p] <= tick) destroy(ctx, p)
    for (const p of query(ctx.world, Q.parts)) if (Particle.ttl[p] <= tick) destroy(ctx, p)
    flush(ctx)
  },
  'cleanup.death': (ctx) => () => {
    const dying = sortedByGameId(ctx, Q.dying)
    if (dying.length === 0) return
    const ids = new Set<number>()
    // The KILL events come first. A summoner that is removed takes its minions with it,
    // so a minion that is also dying must have its event by then.
    for (const m of dying) {
      pushEvent(ctx, EVENT.KILL, GameId.id[m], Mob.kind[m], Position.x[m], Position.y[m], Mob.flags[m])
      ctx.totals.kills = (ctx.totals.kills + 1) | 0
      destroy(ctx, m)
      ids.add(GameId.id[m])
    }
    for (const p of query(ctx.world, Q.projs)) if (ids.has(Projectile.target[p])) Projectile.target[p] = -1
    flush(ctx)
  },
  'cleanup.drops': (ctx) => () => {
    const { k, scenario, player } = ctx
    const tick = ctx.world.tick
    for (const { gameId: id, kind, x, y, flags } of killEvents(ctx.events)) {
      const def = k.MOBS[kind]
      const elite = (flags & k.bit(STATUS.ELITE)) !== 0
      const xp = def.xp * (elite ? k.ELITE_XP_MULT : 1)
      if (xp > 0) makePickup(ctx, PICKUP_KIND.GEM, x, y, xp)
      if (k.dropsHeart(scenario.seed, tick, id, kind)) makePickup(ctx, PICKUP_KIND.HEART, x, y, k.HEART_HEAL)
      if (kind === MOB.BOSS || elite) makePickup(ctx, PICKUP_KIND.CHEST, x, y, 0)
      if (def.death === 'split') {
        makeMob(ctx, MOB.SWARMLING, k.clampToArena(x - k.SPLIT_OFFSET), y)
        makeMob(ctx, MOB.SWARMLING, k.clampToArena(x + k.SPLIT_OFFSET), y)
      } else if (def.death === 'explode') {
        const inBlast = k.distSq(x, y, Position.x[player], Position.y[player]) <= k.EXPLODER_BLAST * k.EXPLODER_BLAST
        if (inBlast && Player.iframes[player] === 0) hurtPlayer(ctx, k.EXPLODER_DAMAGE)
      }
      for (let n = 0; n < k.scaleCount(k.BURST_COUNT, scenario.particleScale); n++) {
        const [vx, vy] = k.burstVel(scenario.seed, tick, id, n)
        makePart(ctx, PARTICLE_KIND.BURST, x, y, vx, vy, tick + k.BURST_LIFE)
      }
    }
  },
  // The `SummonedBy` relation removes a minion with its summoner (autoRemoveSubject), already in cleanup.death. Nothing is left here.
  'cleanup.cascade': () => () => {},
}
