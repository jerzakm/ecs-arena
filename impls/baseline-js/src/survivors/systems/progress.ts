import { survivors } from '@ecs-arena/spec'
import type { Ctx } from '../context.ts'
import { makeProj } from '../entities.ts'
import { levelUpLevel, pickupId, pickupKind, STRIDE } from '../events.ts'
import { refreshLoadout } from '../loadout.ts'
import { ENT } from '../types.ts'
const { PICKUP_KIND, EVENT } = survivors.kernel
export const progressSystems: Pick<survivors.SystemTable<Ctx>, 'pickup.magnet' | 'pickup.collect' | 'progress.pick' | 'progress.apply'> = {
  'pickup.magnet': (ctx) => () => {
    const { k, px, py } = ctx
    const r = k.MAGNET_BASE + ctx.pstat.magnet
    const ps = ctx.lists[ENT.PICKUP]
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i]
      if (p.attracted === 0 && k.distSq(p.x, p.y, px, py) <= r * r) p.attracted = 1
      if (p.attracted === 1) [p.x, p.y] = k.stepTo(p.x, p.y, px, py, k.PICKUP_SPEED)
    }
  },
  'pickup.collect': (ctx) => {
    const { k, scenario, totals } = ctx
    const { push } = ctx.events
    const { destroy, compact } = ctx.churn
    return () => {
      const { player } = ctx
      const ps = ctx.lists[ENT.PICKUP]
      for (let i = 0; i < ps.length; i++) {
        const p = ps[i]
        if (k.distSq(p.x, p.y, player.x, player.y) > k.PICKUP_RANGE * k.PICKUP_RANGE) continue
        push(EVENT.PICKUP, p.gameId, p.kind)
        destroy(p)
        if (p.kind === PICKUP_KIND.GEM) totals.xp += k.fx.div(p.value * (1000 + ctx.pstat.greed), 1000)
        else if (p.kind === PICKUP_KIND.HEART) player.hp = Math.min(k.maxHp(ctx.pstat.vigor), player.hp + p.value)
      }
      while (totals.xp >= k.xpForLevel(totals.level, scenario.xpScale)) {
        totals.xp -= k.xpForLevel(totals.level, scenario.xpScale)
        totals.level += 1
        push(EVENT.LEVELUP, totals.level)
      }
      compact()
    }
  },
  'progress.pick': (ctx) => {
    const { k, scenario } = ctx
    const { eventsOf } = ctx.events
    return () => {
      const { tick } = ctx
      ctx.evolved.length = 0
      let held = ctx.held
      const take = (id: number) => {
        if (id < 0) return
        const d = k.UPGRADES[id]
        if (d.kind === 'evolution') ctx.evolved.push([d.from, id])
        held = k.takeUpgrade(held, id)
        ctx.totals.picks = (ctx.totals.picks + 1) | 0
        ctx.picked = true
      }
      const levels = eventsOf(EVENT.LEVELUP)
      for (let i = 0; i < levels.length; i += STRIDE[EVENT.LEVELUP]) take(k.pickUpgrade(scenario.seed, tick, levelUpLevel(levels, i), held))
      const pickups = eventsOf(EVENT.PICKUP)
      for (let i = 0; i < pickups.length; i += STRIDE[EVENT.PICKUP]) {
        if (pickupKind(pickups, i) === PICKUP_KIND.CHEST) take(k.chestPick(scenario.seed, tick, k.CHEST_KEY + pickupId(pickups, i), held))
      }
      ctx.held = held
    }
  },
  'progress.apply': (ctx) => {
    const { k, scenario } = ctx
    const { destroy, compact } = ctx.churn
    return () => {
      const { px, py } = ctx
      if (!ctx.picked) return
      ctx.picked = false
      refreshLoadout(ctx, true)
      for (let i = 0; i < ctx.evolved.length; i++) {
        const [from, to] = ctx.evolved[i]
        ctx.add('rule.evolve')
        for (let j = 0; j < ctx.lists[ENT.PROJ].length; j++) {
          const p = ctx.lists[ENT.PROJ][j]
          if (p.dead || p.weapon !== from) continue
          p.weapon = to
          p.traits = k.scaleTraits(ctx.wstat[to]!.traits, scenario.traitScale)
          ctx.add('rule.evolve')
        }
      }
      for (let i = 0; i < ctx.held.length; i++) {
        const id = ctx.held[i].id
        if (k.aimOf(id) !== 'orbit') continue
        for (const old of ctx.lists[ENT.PROJ].filter((p) => p.weapon === id && !p.dead)) destroy(old)
        const st = ctx.wstat[id]!
        for (let s = 0; s < st.count; s++)
          makeProj(ctx, {
            weapon: id, owner: k.PLAYER_ID, traits: k.scaleTraits(st.traits, scenario.traitScale), x: px, y: py, vx: 0, vy: 0,
            ttl: k.INF_TTL, pierceLeft: 0, bounceLeft: 0, hitMask: 0, target: -1,
          })
      }
      compact()
    }
  },
}
