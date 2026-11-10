import { survivors } from '@ecs-arena/spec'
import type { Ctx } from '../context.ts'
import { makeMob, makePart, makePickup } from '../entities.ts'
import { killFlags, killId, killKind, killX, killY, STRIDE } from '../events.ts'
import { hurtPlayer } from '../hits.ts'
import { ENT, type Ent, type Mob } from '../types.ts'
const { STATUS, MOB, PICKUP_KIND, PARTICLE_KIND, EVENT } = survivors.kernel
export const cleanupSystems: Pick<survivors.SystemTable<Ctx>, 'cleanup.ttl' | 'cleanup.death' | 'cleanup.drops' | 'cleanup.cascade'> = {
  'cleanup.ttl': (ctx) => {
    const { destroy, compact } = ctx.churn
    // The naive code scans every projectile, pickup and particle for each tick. It returns how many it destroyed.
    const expireByScan = (tick: number): number => {
      let n = 0
      const withTtl: Ent[][] = [ctx.lists[ENT.PROJ], ctx.lists[ENT.PICKUP], ctx.lists[ENT.PART]]
      for (const list of withTtl)
        for (let i = 0; i < list.length; i++) if (!list[i].dead && list[i].ttl <= tick) { destroy(list[i]); n++ }
      return n
    }
    const expireByWheel = (tick: number): number => {
      let n = 0
      const due = ctx.ttlWheel.get(tick)
      if (due) {
        ctx.ttlWheel.delete(tick)
        for (let i = 0; i < due.length; i++) if (!due[i].dead) { destroy(due[i]); n++ }
      }
      return n
    }
    const expire = ctx.nv.churn ? expireByScan : expireByWheel
    return () => {
      ctx.begin('churn')
      const n = expire(ctx.tick)
      ctx.end('churn')
      ctx.add('ttl.expire', n)
      compact()
    }
  },
  'cleanup.death': (ctx) => {
    const { k } = ctx
    const { destroy, compact } = ctx.churn
    const { push } = ctx.events
    return () => {
      const dying = ctx.lists[ENT.MOB].filter((m) => m.flags & k.bit(STATUS.DYING))
      if (dying.length === 0) return
      const ids = new Set<number>()
      for (let i = 0; i < dying.length; i++) {
        const m = dying[i]
        push(EVENT.KILL, m.gameId, m.kind, m.x, m.y, m.flags)
        ctx.totals.kills = (ctx.totals.kills + 1) | 0
        destroy(m)
        ids.add(m.gameId)
      }
      const projs = ctx.lists[ENT.PROJ]
      for (let i = 0; i < projs.length; i++) if (ids.has(projs[i].target)) projs[i].target = -1
      compact()
    }
  },
  'cleanup.drops': (ctx) => {
    const { k, scenario } = ctx
    const { eventsOf } = ctx.events
    const blast = k.EXPLODER_BLAST * k.EXPLODER_BLAST
    return () => {
      const { tick, player } = ctx
      const kills = eventsOf(EVENT.KILL)
      for (let i = 0; i < kills.length; i += STRIDE[EVENT.KILL]) {
        const id = killId(kills, i), kind = killKind(kills, i), x = killX(kills, i), y = killY(kills, i)
        const def = k.MOBS[kind]
        const elite = (killFlags(kills, i) & k.bit(STATUS.ELITE)) !== 0
        const xp = def.xp * (elite ? k.ELITE_XP_MULT : 1)
        if (xp > 0) makePickup(ctx, PICKUP_KIND.GEM, x, y, xp)
        if (k.dropsHeart(scenario.seed, tick, id, kind)) makePickup(ctx, PICKUP_KIND.HEART, x, y, k.HEART_HEAL)
        if (kind === MOB.BOSS || elite) makePickup(ctx, PICKUP_KIND.CHEST, x, y, 0)
        if (def.death === 'split') {
          makeMob(ctx, MOB.SWARMLING, k.clampToArena(x - k.SPLIT_OFFSET), y)
          makeMob(ctx, MOB.SWARMLING, k.clampToArena(x + k.SPLIT_OFFSET), y)
        } else if (def.death === 'explode' && k.distSq(x, y, player.x, player.y) <= blast && player.iframes === 0) {
          hurtPlayer(ctx, k.EXPLODER_DAMAGE)
        }
        for (let n = 0; n < k.scaleCount(k.BURST_COUNT, scenario.particleScale); n++) {
          const [vx, vy] = k.burstVel(scenario.seed, tick, id, n)
          makePart(ctx, PARTICLE_KIND.BURST, x, y, vx, vy, tick + k.BURST_LIFE)
        }
      }
    }
  },
  'cleanup.cascade': (ctx) => {
    const { destroy, compact } = ctx.churn
    const { gate } = ctx.gates
    return () => {
      if (!gate('cleanup.cascade', ctx.gone.length > 0, () => ctx.lists[ENT.MOB].some((m) => m.summoner !== -1))) return
      let n = 0
      for (let i = 0; i < ctx.gone.length; i++) {
        const kids: Mob[] = [...(ctx.kids.get(ctx.gone[i]) ?? [])]
        for (let j = 0; j < kids.length; j++) { destroy(kids[j]); n++ }
      }
      ctx.gone.length = 0
      ctx.add('rule.cascade', n)
      compact()
    }
  },
}
