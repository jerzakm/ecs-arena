// Hits on mobs and damage to the player. A system queues hits, and `applyHits` turns the queue into damage, clear bits and HIT events
// (SPEC-survivors §6.13).
import { Mob, Player } from './components.ts'
import { GameId } from '../shared/components.ts'
import type { Ctx } from './context.ts'
import { pushEvent } from './events.ts'

/** Queues a hit on the mob `m`. `source` seeds the crit draw and `traits` go to the HIT event. */
export const queueHit = (ctx: Ctx, m: number, dmg: number, source: number, traits: number): void => {
  ctx.events.pending.push({ m, dmg, source, traits })
}

export const hurtPlayer = (ctx: Ctx, dmg: number): void => {
  const p = ctx.player
  Player.hp[p] = ctx.k.damagePlayer(Player.hp[p], dmg)
  ctx.totals.dmgTaken = (ctx.totals.dmgTaken + dmg) | 0
  Player.iframes[p] = ctx.world.tick + ctx.k.IFRAMES_TICKS
}

/** Every hit of a tick sees the same mask, so a batch gives the result of one hit at a time. */
export const applyHits = (ctx: Ctx): void => {
  const { k, scenario, world } = ctx
  const { pending } = ctx.events
  for (let i = 0; i < pending.length; i++) {
    const { m, source, traits } = pending[i]
    const dmg = k.armoredDamage(pending[i].dmg, Mob.affix[m])
    const out = k.hitOutcome(dmg, Mob.flags[m], k.critDraw(scenario.seed, world.tick, source, GameId.id[m]))
    Mob.dmgIn[m] += out.dmg
    Mob.clearIn[m] |= out.clear
    pushEvent(ctx, k.EVENT.HIT, GameId.id[m], traits)
  }
  pending.length = 0
}
