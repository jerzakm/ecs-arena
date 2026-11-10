import type { Entity } from 'koota'
import { survivors } from '@ecs-arena/spec'
import { makeProj } from '../entities.ts'
import { pushEvent } from '../events.ts'
import { heldList, refreshLoadout } from '../loadout.ts'
import { Clock, Held, Hp, Loadout, Position, Projectile, TRAIT_TAGS, Totals } from '../traits.ts'
import { byGameId, syncTags } from '../../shared/util.ts'
import type { Ctx } from '../context.ts'

const { PICKUP_KIND, EVENT } = survivors.kernel

export const progressSystems: Pick<survivors.SystemTable<Ctx>, 'pickup.magnet' | 'pickup.collect' | 'progress.pick' | 'progress.apply'> = {
  'pickup.magnet': (ctx) => () => {
    const { k, world } = ctx
    const { x: px, y: py } = ctx.player.get(Position)!
    const r = k.MAGNET_BASE + world.get(Loadout)!.stats.magnet
    world.query(ctx.q.pickups).updateEach(([pk, , p]) => {
      if (pk.attracted === 0 && k.distSq(p.x, p.y, px, py) <= r * r) pk.attracted = 1
      if (pk.attracted === 1) [p.x, p.y] = k.stepTo(p.x, p.y, px, py, k.PICKUP_SPEED)
    })
  },
  'pickup.collect': (ctx) => () => {
    const { k, scenario, world, player } = ctx
    const { x: px, y: py } = player.get(Position)!
    const { stats } = world.get(Loadout)!
    const totals = world.get(Totals)!
    const got: { e: Entity; gameId: number; kind: number; value: number }[] = []
    world.query(ctx.q.pickups).readEach(([pk, g, p], e) => {
      if (k.distSq(p.x, p.y, px, py) <= k.PICKUP_RANGE * k.PICKUP_RANGE) got.push({ e, gameId: g.id, kind: pk.kind, value: pk.value })
    })
    got.sort(byGameId)
    let hp = player.get(Hp)!.hp
    for (const p of got) {
      ctx.events.pickedUp.push({ gameId: p.gameId, kind: p.kind })
      pushEvent(ctx, EVENT.PICKUP)
      p.e.destroy()
      if (p.kind === PICKUP_KIND.GEM) totals.xp += k.fx.div(p.value * (1000 + stats.greed), 1000)
      else if (p.kind === PICKUP_KIND.HEART) hp = Math.min(k.maxHp(stats.vigor), hp + p.value)
    }
    player.set(Hp, { hp })
    while (totals.xp >= k.xpForLevel(totals.level, scenario.xpScale)) {
      totals.xp -= k.xpForLevel(totals.level, scenario.xpScale)
      totals.level += 1
      ctx.events.levels.push(totals.level)
      pushEvent(ctx, EVENT.LEVELUP)
    }
  },
  'progress.pick': (ctx) => () => {
    const { k, scenario, world, events } = ctx
    const { tick } = world.get(Clock)!
    const totals = world.get(Totals)!
    events.evolved.length = 0
    const take = (id: number) => {
      if (id < 0) return
      const d = k.UPGRADES[id]
      const held = heldList(ctx)
      if (d.kind === 'evolution') {
        events.evolved.push([d.from, id])
        held.find((h) => h.id === d.from)?.e.destroy()
      }
      const cur = held.find((h) => h.id === id)
      if (cur) cur.e.set(Held, { level: cur.level + 1 })
      else world.spawn(Held({ id, level: 1, cd: 0 }))
      totals.picks = (totals.picks + 1) | 0
      events.picked = true
    }
    for (const level of events.levels) take(k.pickUpgrade(scenario.seed, tick, level, heldList(ctx)))
    for (const p of events.pickedUp) {
      if (p.kind === PICKUP_KIND.CHEST) take(k.chestPick(scenario.seed, tick, k.CHEST_KEY + p.gameId, heldList(ctx)))
    }
  },
  'progress.apply': (ctx) => () => {
    const { k, scenario, world, events } = ctx
    const { x: px, y: py } = ctx.player.get(Position)!
    if (!events.picked) return
    events.picked = false
    refreshLoadout(ctx)
    const { weapons } = world.get(Loadout)!
    // An evolution retags each live projectile of the weapon that it replaces.
    for (const [from, to] of events.evolved) {
      const mask = k.scaleTraits(weapons[to]!.traits, scenario.traitScale)
      const live: Entity[] = []
      world.query(ctx.q.allProjectiles).readEach(([pr], e) => { if (pr.weapon === from) live.push(e) })
      for (const e of live) {
        e.set(Projectile, { weapon: to })
        syncTags(e, TRAIT_TAGS, mask)
      }
    }
    for (const h of heldList(ctx)) {
      if (k.aimOf(h.id) !== 'orbit') continue
      const old: Entity[] = []
      world.query(ctx.q.allProjectiles).readEach(([pr], e) => { if (pr.weapon === h.id) old.push(e) })
      for (const e of old) e.destroy()
      const st = weapons[h.id]!
      for (let s = 0; s < st.count; s++) {
        makeProj(ctx, {
          weapon: h.id, owner: ctx.player, traits: k.scaleTraits(st.traits, scenario.traitScale), x: px, y: py, vx: 0, vy: 0,
          ttl: k.INF_TTL, pierceLeft: 0, bounceLeft: 0, orbiter: true,
        })
      }
    }
  },
}
