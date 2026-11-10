import { query } from 'bitecs'
import { survivors } from '@ecs-arena/spec'
import { Held, Pickup, Player, Position, Projectile } from '../components.ts'
import { GameId } from '../../shared/components.ts'
import type { Ctx } from '../context.ts'
import { destroy, flush, makeProj, setTraits } from '../entities.ts'
import { levelEvents, pickupEvents, pushEvent } from '../events.ts'
import { heldEntities, heldList, refreshLoadout, setHeld } from '../loadout.ts'
import { Q } from '../queries.ts'
import { byGameId } from '../../shared/util.ts'

const { PICKUP_KIND, EVENT } = survivors.kernel

type ProgressIds = 'pickup.magnet' | 'pickup.collect' | 'progress.pick' | 'progress.apply'
export const progressSystems: Pick<survivors.SystemTable<Ctx>, ProgressIds> = {
  'pickup.magnet': (ctx) => () => {
    const { k, px, py } = ctx
    const r = k.MAGNET_BASE + ctx.loadout.stats.magnet
    for (const p of query(ctx.world, Q.pickups)) {
      if (Pickup.attracted[p] === 0 && k.distSq(Position.x[p], Position.y[p], px, py) <= r * r) Pickup.attracted[p] = 1
      if (Pickup.attracted[p] === 1) [Position.x[p], Position.y[p]] = k.stepTo(Position.x[p], Position.y[p], px, py, k.PICKUP_SPEED)
    }
  },
  'pickup.collect': (ctx) => () => {
    const { k, scenario, player, totals } = ctx
    const { stats } = ctx.loadout
    const px = Position.x[player], py = Position.y[player]
    const range = k.PICKUP_RANGE * k.PICKUP_RANGE
    const near = Array.from(query(ctx.world, Q.pickups)).filter((p) => k.distSq(Position.x[p], Position.y[p], px, py) <= range)
    near.sort(byGameId)
    for (const p of near) {
      pushEvent(ctx, EVENT.PICKUP, GameId.id[p], Pickup.kind[p])
      destroy(ctx, p)
      if (Pickup.kind[p] === PICKUP_KIND.GEM) totals.xp += k.fx.div(Pickup.value[p] * (1000 + stats.greed), 1000)
      else if (Pickup.kind[p] === PICKUP_KIND.HEART) Player.hp[player] = Math.min(k.maxHp(stats.vigor), Player.hp[player] + Pickup.value[p])
    }
    while (totals.xp >= k.xpForLevel(totals.level, scenario.xpScale)) {
      totals.xp -= k.xpForLevel(totals.level, scenario.xpScale)
      totals.level += 1
      pushEvent(ctx, EVENT.LEVELUP, totals.level)
    }
    flush(ctx)
  },
  'progress.pick': (ctx) => () => {
    const { k, scenario, events } = ctx
    const tick = ctx.world.tick
    events.evolved.length = 0
    let held = heldList(ctx)
    const take = (id: number) => {
      if (id < 0) return
      const d = k.UPGRADES[id]
      if (d.kind === 'evolution') events.evolved.push([d.from, id])
      held = k.takeUpgrade(held, id)
      ctx.totals.picks = (ctx.totals.picks + 1) | 0
      events.picked = true
    }
    for (const level of levelEvents(events)) take(k.pickUpgrade(scenario.seed, tick, level, held))
    for (const { gameId, kind } of pickupEvents(events)) {
      if (kind === PICKUP_KIND.CHEST) take(k.chestPick(scenario.seed, tick, k.CHEST_KEY + gameId, held))
    }
    if (events.picked) setHeld(ctx, held)
  },
  'progress.apply': (ctx) => () => {
    const { k, scenario, events, px, py } = ctx
    if (!events.picked) return
    events.picked = false
    refreshLoadout(ctx)
    for (const [from, to] of events.evolved)
      for (const p of query(ctx.world, Q.projs)) {
        if (Projectile.weapon[p] !== from) continue
        Projectile.weapon[p] = to
        setTraits(ctx, p, k.scaleTraits(ctx.loadout.weapons[to]!.traits, scenario.traitScale))
      }
    for (const h of heldEntities(ctx)) {
      const id = Held.id[h]
      if (k.aimOf(id) !== 'orbit') continue
      for (const old of Array.from(query(ctx.world, Q.orbiters)).filter((p) => Projectile.weapon[p] === id)) destroy(ctx, old)
      const st = ctx.loadout.weapons[id]!
      for (let s = 0; s < st.count; s++) {
        makeProj(ctx, {
          weapon: id, owner: k.PLAYER_ID, traits: k.scaleTraits(st.traits, scenario.traitScale), x: px, y: py, vx: 0, vy: 0, ttl: k.INF_TTL,
          pierceLeft: 0, bounceLeft: 0, hitMask: 0, target: -1,
        })
      }
    }
    flush(ctx)
  },
}
