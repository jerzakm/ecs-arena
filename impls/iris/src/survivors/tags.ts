// The status tags of a mob (SPEC-survivors §3.1): add, remove and read. A tag is a component, so a read is `hasComponent`.
// The bit views (`flagsOf`, `traitsOf`) put the tags back into the masks that the kernel and the snapshot use.
import { addComponent, type EntityId, getComponentValue, hasComponent, removeComponent, setComponentValue, type World } from 'iris-ecs'
import { survivors } from '@ecs-arena/spec'
import {
  BLOCKS_MOVE_TAGS, Burning, Dying, Elite, Enraged, Hp, IMMUNE_TAGS, Slowed, STATUS_TAGS, TIMED, TRAIT_TAGS,
} from './components.ts'
import type { Ctx } from './context.ts'

const { STATUS, bit } = survivors.kernel

/** True when the entity has any of the tags. */
export const hasAny = (world: World, e: EntityId, tags: readonly EntityId[]): boolean => {
  for (let i = 0; i < tags.length; i++) if (hasComponent(world, e, tags[i])) return true
  return false
}

/** The status mask of a mob: bit i is set when the mob has the tag of status i. */
export const flagsOf = (world: World, e: EntityId): number => {
  let flags = 0
  for (let id = 0; id < STATUS_TAGS.length; id++) if (hasComponent(world, e, STATUS_TAGS[id])) flags |= 1 << id
  return flags
}

/** The trait bits of a projectile. */
export const traitsOf = (world: World, e: EntityId): number => {
  let traits = 0
  for (let i = 0; i < TRAIT_TAGS.length; i++) if (hasComponent(world, e, TRAIT_TAGS[i])) traits |= 1 << i
  return traits
}

/** A mob that takes no hit. */
export const immune = (world: World, e: EntityId): boolean => hasAny(world, e, IMMUNE_TAGS)

/** A mob that does not move (BLOCKS_MOVE of the kernel). */
export const blocksMove = (world: World, e: EntityId): boolean => hasAny(world, e, BLOCKS_MOVE_TAGS)

/** The bits of the two statuses that change `mobSpeed`. */
export const speedFlags = (world: World, e: EntityId): number =>
  (hasComponent(world, e, Enraged) ? bit(STATUS.ENRAGED) : 0) | (hasComponent(world, e, Slowed) ? bit(STATUS.SLOWED) : 0)

/** The max hp of a mob of `kind`: ELITE is the only status that `mobMaxHp` reads. */
export const maxHpOf = (ctx: Ctx, e: EntityId, kind: number): number =>
  ctx.k.mobMaxHp(kind, hasComponent(ctx.world, e, Elite) ? bit(STATUS.ELITE) : 0)

/** Adds the timed tag of status `id`, or merges `until` by max when the mob has it. `delta` is the stack count that BURNING gains. */
export const addTag = (ctx: Ctx, e: EntityId, id: number, until: number, delta = 0): void => {
  const { k, world } = ctx
  const tag = TIMED[id]
  if (hasComponent(world, e, tag)) {
    setComponentValue(world, e, tag, 'until', k.mergeUntil(getComponentValue(world, e, tag, 'until'), until))
    if (id === STATUS.BURNING) {
      setComponentValue(world, e, Burning, 'stacks', Math.min(k.BURN_MAX_STACKS, getComponentValue(world, e, Burning, 'stacks') + delta))
    }
  } else if (id === STATUS.BURNING) addComponent(world, e, Burning, { until, stacks: delta })
  else addComponent(world, e, tag, { until })
}

export const removeTag = (world: World, e: EntityId, id: number): void => {
  if (!hasComponent(world, e, TIMED[id])) return
  removeComponent(world, e, TIMED[id])
  if (id === STATUS.SHIELDED) setComponentValue(world, e, Hp, 'shield', 0)
}

export const markDying = (world: World, e: EntityId): void => {
  if (!hasComponent(world, e, Dying)) addComponent(world, e, Dying)
}

/** Sets the trait tags of a projectile to the bits of `traits`, touching only the tags that change. */
export const setTraits = (world: World, e: EntityId, traits: number): void => {
  for (let i = 0; i < TRAIT_TAGS.length; i++) {
    const want = (traits & (1 << i)) !== 0, have = hasComponent(world, e, TRAIT_TAGS[i])
    if (want && !have) addComponent(world, e, TRAIT_TAGS[i])
    else if (!want && have) removeComponent(world, e, TRAIT_TAGS[i])
  }
}
