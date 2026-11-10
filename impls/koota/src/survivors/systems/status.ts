import type { Entity } from 'koota'
import { survivors } from '@ecs-arena/spec'
import { makePart } from '../entities.ts'
import { pushEvent } from '../events.ts'
import { hurtPlayer } from '../hits.ts'
import {
  Aux, Burning, Clock, Dying, Enraged, Frenzied, Frozen, Hp, Iframes, Kind, Marked, Position, Shielded, Slowed, Totals,
} from '../traits.ts'
import { addTag, immune, markDying, maxHpOf, removeTag } from '../tags.ts'
import { byGameId } from '../../shared/util.ts'
import type { Ctx } from '../context.ts'

const { STATUS, MOB, PARTICLE_KIND, bit } = survivors.kernel

export const statusSystems: Pick<
  survivors.SystemTable<Ctx>,
  'status.apply' | 'status.tick' | 'status.expire' | 'resolve.damage' | 'resolve.changed'
> = {
  'status.apply': (ctx) => () => {
    const { k, scenario, world } = ctx
    const { tick } = world.get(Clock)!
    // Every hit reads the mask from the start of the system, so read all masks before the first add.
    const work = ctx.events.hits.map((h) => ({ e: h.e, traits: h.traits, mask: h.e.has(Slowed) ? bit(STATUS.SLOWED) : 0 }))
    for (const { e, traits, mask } of work) {
      for (const [id, dur, delta] of k.statusFromTraits(traits, mask)) {
        addTag(ctx, e, id, tick + k.tagDuration(dur, scenario.tagScale), delta)
        pushEvent(ctx, k.EVENT.STATUS)
      }
    }
  },
  'status.tick': (ctx) => () => {
    const { k, scenario, world, player } = ctx
    const { tick } = world.get(Clock)!
    const pp = player.get(Position)!
    if (tick % k.BURN_PERIOD === 0) world.query(ctx.q.burning).updateEach(([b, , , inc]) => void (inc.dmg += b.stacks))
    // Fire spread. Each burning mob (its turn is tick + gameId) lights the mobs near it. All queries read the tags of the start
    // of the system.
    const sources: { x: number; y: number }[] = []
    world.query(ctx.q.burning).readEach(([, g, p]) => {
      if ((tick + g.id) % k.FIRE_SPREAD_PERIOD === 0) sources.push({ x: p.x, y: p.y })
    })
    if (sources.length > 0) {
      const lit = new Map<number, Entity>()
      for (const s of sources) {
        ctx.grid.forNear(s.x, s.y, k.FIRE_SPREAD_RANGE, (h, _d2, gameId) => {
          const o = ctx.mobAt[h]
          if (!o.has(Burning) && !lit.has(gameId) && !immune(o)) lit.set(gameId, o)
        })
      }
      const targets = [...lit].map(([gameId, e]) => ({ gameId, e })).sort(byGameId)
      for (const { e } of targets) addTag(ctx, e, STATUS.BURNING, tick + k.tagDuration(k.DUR.BURNING, scenario.tagScale), 1)
    }
    if (tick % k.SCORCH_PERIOD === 0) {
      world.query(ctx.q.scorching).readEach(([p]) => {
        if (k.distSq(p.x, p.y, pp.x, pp.y) <= k.SCORCH_RANGE * k.SCORCH_RANGE && !player.has(Iframes)) hurtPlayer(ctx, 1)
      })
    }
    const ghosts: Entity[] = []
    world.query(ctx.q.ghosts).readEach(([g], e) => { if ((tick + g.id) % k.GHOST_PERIOD === 0) ghosts.push(e) })
    for (const e of ghosts) addTag(ctx, e, STATUS.PHASED, tick + k.DUR.PHASED)
  },
  'status.expire': (ctx) => () => {
    const { world } = ctx
    const { tick } = world.get(Clock)!
    const { expiring } = ctx.q
    for (let id = 0; id < expiring.length; id++) {
      const due: Entity[] = []
      world.query(expiring[id]).readEach(([t], e) => { if (t.until <= tick) due.push(e) })
      for (const e of due) removeTag(e, id)
    }
  },
  'resolve.damage': (ctx) => () => {
    const { world } = ctx
    const totals = world.get(Totals)!
    ctx.events.changed.length = 0
    const dropShield: Entity[] = [], dying: Entity[] = [], unmark: Entity[] = [], thaw: Entity[] = []
    world.query(ctx.q.mobs).updateEach(([g, kind, hp, shield, inc], e) => {
      if (inc.dmg <= 0 && inc.heal <= 0 && inc.clear === 0) return
      const hp0 = hp.hp
      let h = Math.min(maxHpOf(ctx, e, kind.value), hp0 + inc.heal)
      const absorb = Math.min(shield.value, inc.dmg)
      shield.value -= absorb
      if (shield.value === 0 && e.has(Shielded)) dropShield.push(e)
      h = Math.max(0, h - (inc.dmg - absorb))
      if (h === 0) dying.push(e)
      if (inc.clear & bit(STATUS.MARKED) && e.has(Marked)) unmark.push(e)
      if (inc.clear & bit(STATUS.FROZEN) && e.has(Frozen)) thaw.push(e)
      totals.dmgOut = (totals.dmgOut + inc.dmg) | 0
      inc.dmg = inc.heal = inc.clear = 0
      hp.hp = h
      if (h !== hp0) ctx.events.changed.push({ e, gameId: g.id, prev: hp0 })
    })
    for (const e of dropShield) removeTag(e, STATUS.SHIELDED)
    for (const e of dying) markDying(e)
    for (const e of unmark) removeTag(e, STATUS.MARKED)
    for (const e of thaw) removeTag(e, STATUS.FROZEN)
  },
  'resolve.changed': (ctx) => () => {
    const { k, scenario, world } = ctx
    const { tick } = world.get(Clock)!
    const { changed } = ctx.events
    changed.sort(byGameId)
    for (const { e, gameId, prev } of changed) {
      if (e.has(Dying)) continue
      const hp = e.get(Hp)!.hp, kind = e.get(Kind)!.value
      const max = maxHpOf(ctx, e, kind)
      if (e.has(Frenzied) && hp * 2 < max && !e.has(Enraged)) addTag(ctx, e, STATUS.ENRAGED, tick + k.DUR.ENRAGED)
      if (kind === MOB.BOSS) e.set(Aux, { value: k.bossPhase(hp, max, e.get(Aux)!.value) })
      if (hp < prev) {
        const p = e.get(Position)!
        for (let n = 0; n < k.scaleCount(k.SPARK_COUNT, scenario.particleScale); n++) {
          const [vx, vy] = k.sparkVel(scenario.seed, tick, gameId, n)
          makePart(ctx, PARTICLE_KIND.SPARK, p.x, p.y, vx, vy, tick + k.SPARK_LIFE)
        }
      }
    }
  },
}
