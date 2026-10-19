import { addComponent, hasComponent, observe, onAdd, onRemove, onSet } from 'bitecs'
import type { Context } from './context.ts'
import { Bannered, Haste, ItemKind, ItemTags, KillCount, Kind, Stats, Veteran } from './components.ts'
import { Equips } from './relations.ts'

export const recomputeStats = (ctx: Context, e: number) => {
  const { k, world } = ctx
  const base = k.UNIT_STATS[Kind.value[e]]
  let attack = base.attack, armor = base.armor, speed = base.speed
  const items = Equips.items[e] ?? []
  for (let i = 0; i < items.length; i++) {
    const def = k.ITEMS[ItemKind.value[items[i]]]
    const q = Equips.quality[e][i]
    attack += def.attack * q
    armor += def.armor * q
    speed += def.speed * q
  }
  let mask = 0
  ItemTags.forEach((tag, kind) => { if (hasComponent(world, e, tag)) mask |= 1 << kind })
  const set = k.SET_BONUS[mask]
  attack += set.attack; armor += set.armor; speed += set.speed
  if (hasComponent(world, e, Bannered)) armor += k.BANNER_ARMOR
  if (hasComponent(world, e, Veteran)) attack += k.VETERAN_ATTACK_STEP * Math.min(k.VETERAN_MAX_STEPS, k.fx.div(KillCount.value[e], k.VETERAN_KILLS))
  if (hasComponent(world, e, Haste)) speed = k.fx.div(speed * 3, 2)
  Stats.attack[e] = attack; Stats.armor[e] = armor; Stats.speed[e] = speed
}

// Units whose derived stats may have changed. Haste, Bannered and Veteran are tags, so onAdd and onRemove see each change.
// KillCount is a plain store, so a kill goes through setComponent and the onSet hook writes the value and marks the unit.
// Equips is a plain store of arrays, so no observer sees it and the pickup in cleanup marks the unit itself.
export const observeDirty = (ctx: Context) => {
  const { world, dirty } = ctx
  const markDirty = (e: number) => void dirty.add(e)
  for (const t of [Haste, Bannered]) {
    observe(world, onAdd(t), markDirty)
    observe(world, onRemove(t), markDirty)
  }
  observe(world, onAdd(Veteran), markDirty)
  observe(world, onSet(KillCount), (e, data: { value: number }) => {
    KillCount.value[e] = data.value
    ctx.killsChanged.add(e)
    dirty.add(e)
  })
}

/** A new unit below a warlord or a bannered unit starts bannered, before its first stats recompute. */
export const bannerAtSpawn = (ctx: Context, e: number, parent: number) => {
  if (Kind.value[parent] === ctx.k.KIND.WARLORD || hasComponent(ctx.world, parent, Bannered)) addComponent(ctx.world, e, Bannered)
  recomputeStats(ctx, e)
}
