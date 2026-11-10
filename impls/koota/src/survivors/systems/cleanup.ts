import type { Entity } from 'koota'
import { survivors } from '@ecs-arena/spec'
import { makeMob, makePart, makePickup } from '../entities.ts'
import { pushEvent } from '../events.ts'
import { hurtPlayer } from '../hits.ts'
import { Clock, Iframes, Kind, Position, SummonedBy, Totals } from '../traits.ts'
import { flagsOf } from '../tags.ts'
import { byGameId } from '../../shared/util.ts'
import type { Ctx } from '../context.ts'

const { STATUS, MOB, PICKUP_KIND, PARTICLE_KIND, EVENT } = survivors.kernel

export const cleanupSystems: Pick<survivors.SystemTable<Ctx>, 'cleanup.ttl' | 'cleanup.death' | 'cleanup.drops' | 'cleanup.cascade'> = {
  'cleanup.ttl': (ctx) => () => {
    const { world } = ctx
    const { tick } = world.get(Clock)!
    const due: Entity[] = []
    world.query(ctx.q.ttl).readEach(([t], e) => { if (t.value <= tick) due.push(e) })
    for (const e of due) e.destroy()
  },
  'cleanup.death': (ctx) => () => {
    const { world, events } = ctx
    const totals = world.get(Totals)!
    const dying: { e: Entity; gameId: number }[] = []
    world.query(ctx.q.dying).readEach(([g], e) => void dying.push({ e, gameId: g.id }))
    dying.sort(byGameId)
    for (const { e, gameId } of dying) {
      const p = e.get(Position)!
      events.kills.push({ gameId, kind: e.get(Kind)!.value, x: p.x, y: p.y, flags: flagsOf(e) })
      pushEvent(ctx, EVENT.KILL)
      totals.kills = (totals.kills + 1) | 0
      // koota drops the SummonedBy pairs of the children when the summoner is destroyed, so list the children first.
      for (const child of world.query(SummonedBy(e))) events.orphans.push(child)
      // The projectiles that targeted it lose their Targets pair, and the shots that it fired lose their FiredBy pair.
      e.destroy()
    }
  },
  'cleanup.drops': (ctx) => () => {
    const { k, scenario, world, player } = ctx
    const { tick } = world.get(Clock)!
    const { x: px, y: py } = player.get(Position)!
    for (const { gameId, kind, x, y, flags } of ctx.events.kills) {
      const def = k.MOBS[kind]
      const elite = (flags & k.bit(STATUS.ELITE)) !== 0
      const xp = def.xp * (elite ? k.ELITE_XP_MULT : 1)
      if (xp > 0) makePickup(ctx, PICKUP_KIND.GEM, x, y, xp)
      if (k.dropsHeart(scenario.seed, tick, gameId, kind)) makePickup(ctx, PICKUP_KIND.HEART, x, y, k.HEART_HEAL)
      if (kind === MOB.BOSS || elite) makePickup(ctx, PICKUP_KIND.CHEST, x, y, 0)
      if (def.death === 'split') {
        makeMob(ctx, MOB.SWARMLING, k.clampToArena(x - k.SPLIT_OFFSET), y)
        makeMob(ctx, MOB.SWARMLING, k.clampToArena(x + k.SPLIT_OFFSET), y)
      } else if (def.death === 'explode' && k.distSq(x, y, px, py) <= k.EXPLODER_BLAST * k.EXPLODER_BLAST && !player.has(Iframes)) {
        hurtPlayer(ctx, k.EXPLODER_DAMAGE)
      }
      for (let n = 0; n < k.scaleCount(k.BURST_COUNT, scenario.particleScale); n++) {
        const [vx, vy] = k.burstVel(scenario.seed, tick, gameId, n)
        makePart(ctx, PARTICLE_KIND.BURST, x, y, vx, vy, tick + k.BURST_LIFE)
      }
    }
  },
  'cleanup.cascade': (ctx) => () => {
    // Silent: no KILL event, no drop and no kills.
    for (const e of ctx.events.orphans) if (e.isAlive()) e.destroy()
    ctx.events.orphans.length = 0
  },
}
