import { survivors } from '@ecs-arena/spec'
import type { Ctx } from '../context.ts'
import { makePart } from '../entities.ts'
import { hitMob, hitTraits, STRIDE } from '../events.ts'
import { hurtPlayer } from '../hits.ts'
import { removeTag, timedOf } from '../tags.ts'
import { ENT, type Mob } from '../types.ts'
const { STATUS, MOB, PARTICLE_KIND, EVENT } = survivors.kernel
type StatusSystem = 'status.apply' | 'status.tick' | 'status.expire' | 'resolve.damage' | 'resolve.changed'
export const statusSystems: Pick<survivors.SystemTable<Ctx>, StatusSystem> = {
  'status.apply': (ctx) => {
    const { k, scenario } = ctx
    const { addTag } = ctx.tags
    const { eventsOf, push } = ctx.events
    return () => {
      const { tick } = ctx
      const hits = eventsOf(k.EVENT.HIT)
      // Every hit reads the mask from the start of the system, so read all masks before the first add.
      const work: { m: Mob; traits: number; mask: number }[] = []
      for (let i = 0; i < hits.length; i += STRIDE[EVENT.HIT]) {
        const m = ctx.mobById.get(hitMob(hits, i))!
        work.push({ m, traits: hitTraits(hits, i), mask: m.flags })
      }
      for (let i = 0; i < work.length; i++) {
        const { m, traits, mask } = work[i]
        for (const [id, dur, delta] of k.statusFromTraits(traits, mask)) {
          addTag(m, id, tick + k.tagDuration(dur, scenario.tagScale), delta)
          push(k.EVENT.STATUS, m.gameId)
        }
      }
    }
  },
  'status.tick': (ctx) => {
    const { k, scenario } = ctx
    const { blocked, hasAffix, addTag } = ctx.tags
    const lit: Mob[] = []
    const seen = new Set<number>()
    const burning = 1 << STATUS.BURNING
    return () => {
      const { tick, player } = ctx
      const mobs = ctx.lists[ENT.MOB]
      if (tick % k.BURN_PERIOD === 0)
        for (let i = 0; i < mobs.length; i++) if (mobs[i].flags & burning) mobs[i].dmgIn += timedOf(mobs[i], STATUS.BURNING)!.stacks
      // Fire spread. Each burning mob (its turn is tick + gameId) lights the mobs near it.
      // All queries read the tags of the start of the system.
      lit.length = 0
      seen.clear()
      let resent = false
      for (let i = 0; i < mobs.length; i++) {
        const m = mobs[i]
        if (!(m.flags & burning) || (tick + m.gameId) % k.FIRE_SPREAD_PERIOD !== 0) continue
        if (!resent) { ctx.resendGrid(); resent = true }
        ctx.add('rule.aoe')
        ctx.grid.forNear(m.x, m.y, k.FIRE_SPREAD_RANGE, (h) => {
          const o = ctx.slots[h]
          if (!(o.flags & burning) && !seen.has(o.gameId) && !blocked(o, k.IMMUNE_HIT)) { seen.add(o.gameId); lit.push(o) }
        })
      }
      lit.sort((x, y) => x.gameId - y.gameId)
      for (let i = 0; i < lit.length; i++) addTag(lit[i], STATUS.BURNING, tick + k.tagDuration(k.DUR.BURNING, scenario.tagScale), 1)
      if (tick % k.SCORCH_PERIOD === 0) {
        ctx.begin('flag.reads')
        const hot: Mob[] = []
        for (let i = 0; i < mobs.length; i++) if (hasAffix(mobs[i], k.AFFIX.SCORCHING)) hot.push(mobs[i])
        ctx.end('flag.reads')
        for (let i = 0; i < hot.length; i++) {
          if (k.distSq(hot[i].x, hot[i].y, player.x, player.y) > k.SCORCH_RANGE * k.SCORCH_RANGE || player.iframes !== 0) continue
          hurtPlayer(ctx, 1)
          ctx.add('rule.affix')
        }
      }
      if (ctx.kindCount[MOB.GHOST] > 0)
        for (let i = 0; i < mobs.length; i++)
          if (mobs[i].kind === MOB.GHOST && (tick + mobs[i].gameId) % k.GHOST_PERIOD === 0) {
            addTag(mobs[i], STATUS.PHASED, tick + k.DUR.PHASED)
          }
    }
  },
  'status.expire': (ctx) => {
    // The naive code tests every mob for every timed tag.
    const expireByScan = (tick: number) => {
      const mobs = ctx.lists[ENT.MOB]
      for (let i = 0; i < mobs.length; i++)
        for (let id = 0; id < STATUS.ELITE; id++) {
          const t = timedOf(mobs[i], id)
          if (t && t.until <= tick) removeTag(ctx, mobs[i], id)
        }
    }
    // The wheel lists the mobs that may have a tag that runs out on this tick.
    const expireByWheel = (tick: number) => {
      const due = ctx.wheel.get(tick)
      if (!due) return
      ctx.wheel.delete(tick)
      for (let i = 0; i < due.length; i++) {
        const m = due[i]
        if (m.dead) continue
        for (let j = m.timed.length - 1; j >= 0; j--) if (m.timed[j].until <= tick) removeTag(ctx, m, m.timed[j].id)
      }
    }
    const expire = ctx.nv['status.expire'] ? expireByScan : expireByWheel
    return () => {
      const { tick, player } = ctx
      if (player.iframes !== 0 && player.iframes <= tick) { player.iframes = 0; ctx.add('tag.remove') }
      ctx.begin('status.expire')
      expire(tick)
      ctx.end('status.expire')
    }
  },
  'resolve.damage': (ctx) => {
    const { k } = ctx
    const { addTag } = ctx.tags
    return () => {
      ctx.changed.length = 0
      const mobs = ctx.lists[ENT.MOB]
      for (let i = 0; i < mobs.length; i++) {
        const m = mobs[i]
        if (m.dmgIn <= 0 && m.healIn <= 0 && m.clearIn === 0) continue
        const hp0 = m.hp
        m.prevHp = hp0
        m.hp = Math.min(k.mobMaxHp(m.kind, m.flags), m.hp + m.healIn)
        const absorb = Math.min(m.shield, m.dmgIn)
        m.shield -= absorb
        if (m.shield === 0 && m.flags & k.bit(STATUS.SHIELDED)) removeTag(ctx, m, STATUS.SHIELDED)
        m.hp = Math.max(0, m.hp - (m.dmgIn - absorb))
        if (m.hp === 0) addTag(m, STATUS.DYING, 0)
        for (const id of [STATUS.MARKED, STATUS.FROZEN]) if (m.clearIn & k.bit(id) && m.flags & k.bit(id)) removeTag(ctx, m, id)
        ctx.totals.dmgOut = (ctx.totals.dmgOut + m.dmgIn) | 0
        m.dmgIn = m.healIn = m.clearIn = 0
        if (m.hp !== hp0) ctx.changed.push(m)
      }
    }
  },
  'resolve.changed': (ctx) => {
    const { k, scenario } = ctx
    const { hasAffix, hasTag, addTag } = ctx.tags
    // The normal code reads the list that resolve.damage kept.
    // The naive code finds the mobs whose hp changed by comparing every mob with its prevHp.
    const changedFromList = () => ctx.changed
    const changedFromScan = () => {
      const list: Mob[] = []
      const mobs = ctx.lists[ENT.MOB]
      for (let i = 0; i < mobs.length; i++) if (mobs[i].hp !== mobs[i].prevHp) list.push(mobs[i])
      return list
    }
    const rememberHp = () => {
      ctx.begin('flag.reads')
      const mobs = ctx.lists[ENT.MOB]
      for (let i = 0; i < mobs.length; i++) mobs[i].prevHp = mobs[i].hp
      ctx.end('flag.reads')
    }
    const keepHp = () => {}
    const naive = ctx.nv['flag.reads']
    const changedMobs = naive ? changedFromScan : changedFromList
    const afterLoop = naive ? rememberHp : keepHp
    return () => {
      const { tick } = ctx
      ctx.begin('flag.reads')
      const list = changedMobs()
      ctx.end('flag.reads')
      ctx.add('hp.changed', list.length)
      for (let i = 0; i < list.length; i++) {
        const m = list[i]
        if (m.flags & k.bit(STATUS.DYING)) continue
        const max = k.mobMaxHp(m.kind, m.flags)
        if (hasAffix(m, k.AFFIX.FRENZIED) && m.hp * 2 < max && !hasTag(m, STATUS.ENRAGED)) {
          addTag(m, STATUS.ENRAGED, tick + k.DUR.ENRAGED)
          ctx.add('rule.enrage')
        }
        if (m.kind === MOB.BOSS) {
          const aux = k.bossPhase(m.hp, max, m.aux)
          if (aux !== m.aux) ctx.add('rule.bossphase')
          m.aux = aux
        }
        if (m.hp < m.prevHp)
          for (let n = 0; n < k.scaleCount(k.SPARK_COUNT, scenario.particleScale); n++) {
            const [vx, vy] = k.sparkVel(scenario.seed, tick, m.gameId, n)
            makePart(ctx, PARTICLE_KIND.SPARK, m.x, m.y, vx, vy, tick + k.SPARK_LIFE)
          }
      }
      afterLoop()
    }
  },
}
