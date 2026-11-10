// Hits on mobs and damage to the player. A system queues hits, and `applyHits` turns the queue into damage, clear bits and HIT events
// (SPEC-survivors §6.13).
import { type EntityId, getComponentValue, getResourceValue, hasComponent, setComponentValue, setResourceValue } from 'iris-ecs'
import { survivors } from '@ecs-arena/spec'
import { GameId } from '../shared/components.ts'
import { Affix, Incoming, PlayerHp, Run, STATUS_TAGS } from './components.ts'
import type { Ctx } from './context.ts'
import { pushHit } from './events.ts'
import { addTag } from './tags.ts'

const { STATUS } = survivors.kernel

/** The statuses that `hitOutcome` reads from the mask of the mob. */
const OUTCOME = [STATUS.PHASED, STATUS.SPAWNING, STATUS.DYING, STATUS.IFRAMES, STATUS.MARKED, STATUS.FROZEN] as const

/** Queues a hit on the mob `e`. `source` seeds the crit draw and `traits` go to the HIT event. */
export const queueHit = (ctx: Ctx, e: EntityId, dmg: number, source: number, traits: number): void => {
  ctx.events.pending.push({ e, gameId: getComponentValue(ctx.world, e, GameId, 'id')!, dmg, source, traits })
}

export const hurtPlayer = (ctx: Ctx, dmg: number): void => {
  const { k, world, player } = ctx
  setComponentValue(world, player, PlayerHp, 'hp', k.damagePlayer(getComponentValue(world, player, PlayerHp, 'hp')!, dmg))
  setResourceValue(world, Run, 'dmgTaken', (getResourceValue(world, Run, 'dmgTaken')! + dmg) | 0)
  addTag(ctx, player, STATUS.IFRAMES, ctx.tick + k.IFRAMES_TICKS)
}

/** Every hit of a tick reads the same mask, so a batch gives the result of one hit at a time. */
export const applyHits = (ctx: Ctx): void => {
  const { k, scenario, world } = ctx
  const { pending } = ctx.events
  if (!pending.length) return
  const masks = new Map<number, number>()
  for (let i = 0; i < pending.length; i++) {
    const p = pending[i]
    let mask = masks.get(p.gameId)
    if (mask === undefined) {
      mask = 0
      for (const id of OUTCOME) if (hasComponent(world, p.e, STATUS_TAGS[id])) mask |= 1 << id
      masks.set(p.gameId, mask)
    }
    const dmg = k.armoredDamage(p.dmg, getComponentValue(world, p.e, Affix, 'bits')!)
    const out = k.hitOutcome(dmg, mask, k.critDraw(scenario.seed, ctx.tick, p.source, p.gameId))
    setComponentValue(world, p.e, Incoming, 'dmg', getComponentValue(world, p.e, Incoming, 'dmg')! + out.dmg)
    setComponentValue(world, p.e, Incoming, 'clear', getComponentValue(world, p.e, Incoming, 'clear')! | out.clear)
  }
  for (let i = 0; i < pending.length; i++) pushHit(ctx, pending[i].gameId, pending[i].traits)
  pending.length = 0
}
