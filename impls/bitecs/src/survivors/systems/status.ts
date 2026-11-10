import { query } from 'bitecs'
import { survivors } from '@ecs-arena/spec'
import { BurnStacks, Mob, Player, Position, TIMED } from '../components.ts'
import { GameId } from '../../shared/components.ts'
import type { Ctx } from '../context.ts'
import { makePart } from '../entities.ts'
import { hitEvents, pushEvent } from '../events.ts'
import { hurtPlayer } from '../hits.ts'
import { Q, TIMED_QUERIES } from '../queries.ts'
import { addTag, blocked, hasTag, removeTag } from '../tags.ts'
import { byGameId } from '../../shared/util.ts'

const { STATUS, MOB, PARTICLE_KIND } = survivors.kernel

/** The statuses that a hit clears when its outcome says so. */
const CLEARED_BY_HIT = [STATUS.MARKED, STATUS.FROZEN] as const

type StatusIds = 'status.apply' | 'status.tick' | 'status.expire' | 'resolve.damage' | 'resolve.changed'
export const statusSystems: Pick<survivors.SystemTable<Ctx>, StatusIds> = {
  'status.apply': (ctx) => () => {
    const { k, scenario, mobById } = ctx
    const tick = ctx.world.tick
    // Every hit reads the mask from the start of the system, so read all masks before the first add.
    const work: { m: number; traits: number; mask: number }[] = []
    for (const { gameId, traits } of hitEvents(ctx.events)) {
      const m = mobById.get(gameId)!
      work.push({ m, traits, mask: Mob.flags[m] })
    }
    for (const { m, traits, mask } of work) {
      for (const [id, dur, delta] of k.statusFromTraits(traits, mask)) {
        addTag(ctx, m, id, tick + k.tagDuration(dur, scenario.tagScale), delta)
        pushEvent(ctx, k.EVENT.STATUS, GameId.id[m])
      }
    }
  },
  'status.tick': (ctx) => () => {
    const { k } = ctx
    const tick = ctx.world.tick
    if (tick % k.BURN_PERIOD === 0) for (const m of query(ctx.world, Q.burning)) Mob.dmgIn[m] += BurnStacks.n[m]
    // Fire spread. Each burning mob (its turn is tick + gameId) lights the mobs near it.
    // All queries read the tags of the start of the step.
    const lit = new Set<number>()
    for (const m of query(ctx.world, Q.burning)) {
      if ((tick + GameId.id[m]) % k.FIRE_SPREAD_PERIOD !== 0) continue
      ctx.grid.forNear(Position.x[m], Position.y[m], k.FIRE_SPREAD_RANGE, (o) => {
        if (!hasTag(o, STATUS.BURNING) && !blocked(o, k.IMMUNE_HIT)) lit.add(o)
      })
    }
    for (const o of Array.from(lit).sort(byGameId)) {
      addTag(ctx, o, STATUS.BURNING, tick + k.tagDuration(k.DUR.BURNING, ctx.scenario.tagScale), 1)
    }
    if (tick % k.SCORCH_PERIOD === 0) {
      for (const m of query(ctx.world, Q.mobs)) {
        if (!(Mob.affix[m] & k.AFFIX.SCORCHING)) continue
        if (Player.iframes[ctx.player] !== 0) continue
        if (k.distSq(Position.x[m], Position.y[m], ctx.px, ctx.py) > k.SCORCH_RANGE * k.SCORCH_RANGE) continue
        hurtPlayer(ctx, 1)
      }
    }
    for (const m of query(ctx.world, Q.ghosts)) {
      if ((tick + GameId.id[m]) % k.GHOST_PERIOD === 0) addTag(ctx, m, STATUS.PHASED, tick + k.DUR.PHASED)
    }
  },
  'status.expire': (ctx) => () => {
    const tick = ctx.world.tick
    const { player } = ctx
    if (Player.iframes[player] !== 0 && Player.iframes[player] <= tick) Player.iframes[player] = 0
    for (let id = 0; id < TIMED.length; id++) {
      if (id === STATUS.IFRAMES) continue
      const tag = TIMED[id]
      for (const m of Array.from(query(ctx.world, TIMED_QUERIES[id]))) if (tag.until[m] <= tick) removeTag(ctx, m, id)
    }
  },
  'resolve.damage': (ctx) => () => {
    const { k, totals } = ctx
    ctx.events.changed.length = 0
    for (const m of query(ctx.world, Q.mobs)) {
      if (Mob.dmgIn[m] <= 0 && Mob.healIn[m] <= 0 && Mob.clearIn[m] === 0) continue
      const hp0 = Mob.hp[m]
      Mob.prevHp[m] = hp0
      Mob.hp[m] = Math.min(k.mobMaxHp(Mob.kind[m], Mob.flags[m]), hp0 + Mob.healIn[m])
      const absorb = Math.min(Mob.shield[m], Mob.dmgIn[m])
      Mob.shield[m] -= absorb
      if (Mob.shield[m] === 0 && hasTag(m, STATUS.SHIELDED)) removeTag(ctx, m, STATUS.SHIELDED)
      Mob.hp[m] = Math.max(0, Mob.hp[m] - (Mob.dmgIn[m] - absorb))
      if (Mob.hp[m] === 0) addTag(ctx, m, STATUS.DYING, 0)
      for (const id of CLEARED_BY_HIT) if (Mob.clearIn[m] & k.bit(id) && hasTag(m, id)) removeTag(ctx, m, id)
      totals.dmgOut = (totals.dmgOut + Mob.dmgIn[m]) | 0
      Mob.dmgIn[m] = Mob.healIn[m] = Mob.clearIn[m] = 0
      if (Mob.hp[m] !== hp0) ctx.events.changed.push(m)
    }
  },
  'resolve.changed': (ctx) => () => {
    const { k, scenario } = ctx
    const tick = ctx.world.tick
    const changed = ctx.events.changed.sort(byGameId)
    for (const m of changed) {
      if (hasTag(m, STATUS.DYING)) continue
      const max = k.mobMaxHp(Mob.kind[m], Mob.flags[m])
      if (Mob.affix[m] & k.AFFIX.FRENZIED && Mob.hp[m] * 2 < max && !hasTag(m, STATUS.ENRAGED)) {
        addTag(ctx, m, STATUS.ENRAGED, tick + k.DUR.ENRAGED)
      }
      if (Mob.kind[m] === MOB.BOSS) Mob.aux[m] = k.bossPhase(Mob.hp[m], max, Mob.aux[m])
      if (Mob.hp[m] < Mob.prevHp[m])
        for (let n = 0; n < k.scaleCount(k.SPARK_COUNT, scenario.particleScale); n++) {
          const [vx, vy] = k.sparkVel(scenario.seed, tick, GameId.id[m], n)
          makePart(ctx, PARTICLE_KIND.SPARK, Position.x[m], Position.y[m], vx, vy, tick + k.SPARK_LIFE)
        }
    }
  },
}
