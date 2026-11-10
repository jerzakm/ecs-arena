// Hits on mobs and damage to the player. A system queues hits, and `applyHits` turns the queue into damage, clear bits and HIT events
// (SPEC-survivors §6.13).
import type { Entity } from 'koota'
import { survivors } from '@ecs-arena/spec'
import type { Ctx } from './context.ts'
import { pushEvent } from './events.ts'
import { Armored, Clock, Dying, Frozen, Hp, Iframes, Incoming, Marked, Phased, Spawning, Totals } from './traits.ts'
import { upsert } from '../shared/util.ts'

const { STATUS, bit } = survivors.kernel

/** Queues a hit on the mob `e`. `source` seeds the crit draw and `traits` go to the HIT event. */
export const queueHit = (ctx: Ctx, e: Entity, gameId: number, dmg: number, source: number, traits: number): void => {
  ctx.events.pending.push({ e, gameId, dmg, source, traits })
}

export const hurtPlayer = (ctx: Ctx, dmg: number): void => {
  const { k, world, player } = ctx
  player.set(Hp, { hp: k.damagePlayer(player.get(Hp)!.hp, dmg) })
  const totals = world.get(Totals)!
  totals.dmgTaken = (totals.dmgTaken + dmg) | 0
  upsert(player, Iframes, { until: world.get(Clock)!.tick + k.IFRAMES_TICKS })
}

/** Every hit of a tick sees the same mask, so a batch gives the result of one hit at a time. */
export const applyHits = (ctx: Ctx): void => {
  const { k, scenario, world } = ctx
  const { pending, hits } = ctx.events
  const { tick } = world.get(Clock)!
  for (let i = 0; i < pending.length; i++) {
    const { e, gameId, dmg, source, traits } = pending[i]
    const mask =
      (e.has(Phased) ? bit(STATUS.PHASED) : 0) | (e.has(Spawning) ? bit(STATUS.SPAWNING) : 0) | (e.has(Dying) ? bit(STATUS.DYING) : 0) |
      (e.has(Marked) ? bit(STATUS.MARKED) : 0) | (e.has(Frozen) ? bit(STATUS.FROZEN) : 0)
    const base = k.armoredDamage(dmg, e.has(Armored) ? k.AFFIX.ARMORED : 0)
    const out = k.hitOutcome(base, mask, k.critDraw(scenario.seed, tick, source, gameId))
    const inc = e.get(Incoming)!
    e.set(Incoming, { dmg: inc.dmg + out.dmg, clear: inc.clear | out.clear })
    hits.push({ e, traits })
    pushEvent(ctx, k.EVENT.HIT)
  }
  pending.length = 0
}
