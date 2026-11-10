// Hits and damage to the player. A system queues hits, and `applyHits` turns the queue into damage, clear bits and HIT events
// (SPEC-survivors §6.13).
import { survivors } from '@ecs-arena/spec'
import type { Ctx } from './context.ts'
import { near } from './entities.ts'
import { scanHasTag } from './tags.ts'
import type { Mob } from './types.ts'

const { STATUS } = survivors.kernel
const OUTCOME_TAGS = [STATUS.PHASED, STATUS.SPAWNING, STATUS.DYING, STATUS.IFRAMES, STATUS.MARKED, STATUS.FROZEN]

/** Queues a hit on `m`. `source` seeds the crit draw and `traits` go to the HIT event. */
export const hit = (ctx: Ctx, m: Mob, dmg: number, source: number, traits: number) => void ctx.pending.push({ m, dmg, source, traits })

export const hurtPlayer = (ctx: Ctx, dmg: number) => {
  const { k, player } = ctx
  const hp = k.damagePlayer(player.hp, dmg)
  if (hp !== player.hp - dmg) ctx.add('rule.playerFloor')
  player.hp = hp
  ctx.totals.dmgTaken = (ctx.totals.dmgTaken + dmg) | 0
  player.iframes = ctx.tick + k.IFRAMES_TICKS
}

/** The mobs within `r` of a point, in gameId order unless `sorted` is false. */
export const aoe = (ctx: Ctx, x: number, y: number, r: number, sorted = true): Mob[] => {
  ctx.add('rule.aoe')
  return near(ctx, x, y, r, sorted)
}

const flagsOf = (m: Mob) => m.flags
// The naive code reads each of the six tags the outcome depends on through its own lookup.
const scanFlagsOf = (m: Mob) => {
  let mask = 0
  for (let j = 0; j < OUTCOME_TAGS.length; j++) if (scanHasTag(m, OUTCOME_TAGS[j])) mask |= 1 << OUTCOME_TAGS[j]
  return mask
}

/**
 * The function that applies the queued hits. Every hit of a tick sees the same mask, so a batch gives the result of one hit at a time.
 * Region `flag.reads` decides how the affix and the tag mask are read.
 */
export const applyHitsFor = (ctx: Ctx): (() => void) => {
  const { k, scenario, pending } = ctx
  const { hasAffix } = ctx.tags
  const { push } = ctx.events
  const maskOf = ctx.nv['flag.reads'] ? scanFlagsOf : flagsOf
  return () => {
    if (!pending.length) return
    ctx.begin('flag.reads')
    for (let i = 0; i < pending.length; i++) {
      const p = pending[i]
      const armored = hasAffix(p.m, k.AFFIX.ARMORED)
      if (armored) { p.dmg = k.armoredDamage(p.dmg, p.m.affix); ctx.add('rule.affix') }
    }
    ctx.end('flag.reads')
    ctx.begin('flag.reads')
    for (let i = 0; i < pending.length; i++) {
      const { m, dmg, source } = pending[i]
      const out = k.hitOutcome(dmg, maskOf(m), k.critDraw(scenario.seed, ctx.tick, source, m.gameId))
      m.dmgIn += out.dmg
      m.clearIn |= out.clear
      if (out.clear & k.bit(STATUS.FROZEN)) ctx.add('rule.shatter')
    }
    ctx.end('flag.reads')
    for (let i = 0; i < pending.length; i++) push(k.EVENT.HIT, pending[i].m.gameId, pending[i].traits)
    pending.length = 0
  }
}
