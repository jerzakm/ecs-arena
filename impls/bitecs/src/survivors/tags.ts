// The status tags of a mob (SPEC-survivors §3.1): add, remove and read. A tag is a component: it holds presence for the queries
// and `until`. `Mob.flags` caches the tags as bits, because `hasTag` and `blocked` run in the per-mob loops and a bit test is cheaper
// than `hasComponent`. Only `addTag` and `removeTag` write `Mob.flags`.
import { addComponent, hasComponent, removeComponent } from 'bitecs'
import { survivors } from '@ecs-arena/spec'
import { BurnStacks, Mob, PLAIN, TIMED } from './components.ts'
import type { Ctx } from './context.ts'

const { STATUS } = survivors.kernel

export const hasTag = (e: number, id: number): boolean => ((Mob.flags[e] >> id) & 1) === 1
export const blocked = (e: number, mask: number): boolean => (Mob.flags[e] & mask) !== 0

/** Adds the tag of status `id`, or merges `until` by max when the mob has it. `delta` is the stack count that BURNING gains. */
export const addTag = (ctx: Ctx, e: number, id: number, until: number, delta = 0): void => {
  Mob.flags[e] |= 1 << id
  if (id >= STATUS.ELITE) { addComponent(ctx.world, e, PLAIN[id - STATUS.ELITE]); return }
  const tag = TIMED[id]
  if (hasComponent(ctx.world, e, tag)) {
    tag.until[e] = ctx.k.mergeUntil(tag.until[e], until)
    if (id === STATUS.BURNING) BurnStacks.n[e] = Math.min(ctx.k.BURN_MAX_STACKS, BurnStacks.n[e] + delta)
  } else {
    addComponent(ctx.world, e, tag)
    tag.until[e] = until
    if (id === STATUS.BURNING) BurnStacks.n[e] = delta
  }
}

export const removeTag = (ctx: Ctx, e: number, id: number): void => {
  Mob.flags[e] &= ~(1 << id)
  removeComponent(ctx.world, e, id >= STATUS.ELITE ? PLAIN[id - STATUS.ELITE] : TIMED[id])
  if (id === STATUS.SHIELDED) Mob.shield[e] = 0
  if (id === STATUS.BURNING) BurnStacks.n[e] = 0
}
