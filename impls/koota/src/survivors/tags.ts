// The status tags of a mob (SPEC-survivors §3.1): add, remove and read. A tag is a trait, so a read is `has`.
// The bit views (`flagsOf`, `traitsOf`) put the tags back into the masks that the kernel and the snapshot use.
import type { Entity } from 'koota'
import { survivors } from '@ecs-arena/spec'
import type { Ctx } from './context.ts'
import {
  AFFIX_TAGS, BLOCKS_MOVE_TAGS, Burning, Dying, Elite, Enraged, IMMUNE_TAGS, Shield, Slowed, Swift, TIMED, TRAIT_TAGS,
} from './traits.ts'
import { hasAny, maskOf } from '../shared/util.ts'

const { STATUS, AFFIX, bit } = survivors.kernel

/** The status mask of a mob: bit i for the timed tag of status i, then ELITE and DYING. */
export const flagsOf = (e: Entity): number =>
  maskOf(e, TIMED) | (e.has(Elite) ? bit(STATUS.ELITE) : 0) | (e.has(Dying) ? bit(STATUS.DYING) : 0)

/** The trait bits of a projectile. */
export const traitsOf = (e: Entity): number => maskOf(e, TRAIT_TAGS)

/** The affix bits of a mob. */
export const affixOf = (e: Entity): number => maskOf(e, AFFIX_TAGS)

/** A mob that takes no hit. */
export const immune = (e: Entity): boolean => hasAny(e, IMMUNE_TAGS)

/** A mob that does not move (BLOCKS_MOVE of the kernel). */
export const blocksMove = (e: Entity): boolean => hasAny(e, BLOCKS_MOVE_TAGS)

export const speedOf = (ctx: Ctx, e: Entity, kind: number): number =>
  ctx.k.mobSpeed(
    kind, e.has(Swift) ? AFFIX.SWIFT : 0, (e.has(Enraged) ? bit(STATUS.ENRAGED) : 0) | (e.has(Slowed) ? bit(STATUS.SLOWED) : 0),
  )

export const maxHpOf = (ctx: Ctx, e: Entity, kind: number): number => ctx.k.mobMaxHp(kind, e.has(Elite) ? bit(STATUS.ELITE) : 0)

/** Adds the timed tag of status `id`, or merges `until` by max when the mob has it. `delta` is the stack count that BURNING gains. */
export const addTag = (ctx: Ctx, e: Entity, id: number, until: number, delta = 0): void => {
  const { k } = ctx
  if (id === STATUS.BURNING) {
    const old = e.get(Burning)
    if (old) e.set(Burning, { until: k.mergeUntil(old.until, until), stacks: Math.min(k.BURN_MAX_STACKS, old.stacks + delta) })
    else e.add(Burning({ until, stacks: delta }))
    return
  }
  const t = TIMED[id]
  const old = e.get(t)
  if (old) e.set(t, { until: k.mergeUntil(old.until, until) })
  else e.add(t({ until }))
}

export const removeTag = (e: Entity, id: number): void => {
  e.remove(TIMED[id])
  if (id === STATUS.SHIELDED) e.set(Shield, { value: 0 })
}

export const markDying = (e: Entity): void => {
  if (!e.has(Dying)) e.add(Dying)
}
