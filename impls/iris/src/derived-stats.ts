import { addComponent, hasComponent, registerObserverCallback, setComponent, type EntityId, type World } from 'iris-ecs'
import type { Context } from './context.ts'
import { Bannered, Haste, ItemKind, ItemTags, KillCount, Kind, Stats, Veteran } from './components.ts'

export const recomputeStats = (ctx: Context, e: EntityId) => {
  const { k, world, get } = ctx
  const base = k.UNIT_STATS[get(e, Kind, 'value')]
  let attack = base.attack, armor = base.armor, speed = base.speed
  const held = ctx.equipsOf(e)
  for (let i = 0; i < held.length; i += 2) {
    const def = k.ITEMS[get(ctx.entityOf.get(held[i])!, ItemKind, 'value')]
    const q = held[i + 1]
    attack += def.attack * q
    armor += def.armor * q
    speed += def.speed * q
  }
  let mask = 0
  ItemTags.forEach((tag, kind) => { if (hasComponent(world, e, tag)) mask |= 1 << kind })
  const set = k.SET_BONUS[mask]
  attack += set.attack; armor += set.armor; speed += set.speed
  if (hasComponent(world, e, Bannered)) armor += k.BANNER_ARMOR
  if (hasComponent(world, e, Veteran)) attack += k.VETERAN_ATTACK_STEP * Math.min(k.VETERAN_MAX_STEPS, k.fx.div(get(e, KillCount, 'value'), k.VETERAN_KILLS))
  if (hasComponent(world, e, Haste)) speed = k.fx.div(speed * 3, 2)
  setComponent(world, e, Stats, { attack, armor, speed })
}

// Units whose derived stats may have changed. Observers also see the removal of a tag, which no query can show.
// A change of the `Equips` list is not visible to iris, so the code that edits it adds the unit to `dirty` itself.
export const observeDirty = (world: World, dirty: Set<EntityId>) => {
  const dependsOn = (c: EntityId) => c === Haste || c === Bannered || c === Veteran
  registerObserverCallback(world, 'componentAdded', (c, e) => { if (dependsOn(c)) dirty.add(e) })
  registerObserverCallback(world, 'componentRemoved', (c, e) => { if (dependsOn(c) && c !== Veteran) dirty.add(e) })
  registerObserverCallback(world, 'componentChanged', (c, e) => { if (c === KillCount) dirty.add(e) })
}

/** A new unit below a warlord or a bannered unit starts bannered, before its first stats recompute. */
export const bannerAtSpawn = (ctx: Context, e: EntityId, parent: EntityId) => {
  const { world } = ctx
  if (ctx.get(parent, Kind, 'value') === ctx.k.KIND.WARLORD || hasComponent(world, parent, Bannered)) addComponent(world, e, Bannered)
  recomputeStats(ctx, e)
}
