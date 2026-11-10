import type { Entity, World } from 'koota'
import type { Ctx } from './context.ts'
import { Bannered, Equips, Haste, ItemKind, ITEM_TAGS, KillCount, Kind, Stats, Veteran } from './traits.ts'
import { maskOf } from '../shared/util.ts'
import { observePairs } from '../shared/workarounds.ts'

export const recomputeStats = (ctx: Ctx, e: Entity) => {
  const { k } = ctx
  const base = k.UNIT_STATS[e.get(Kind)!.value]
  let attack = base.attack, armor = base.armor, speed = base.speed
  for (const item of e.targetsFor(Equips)) {
    const def = k.ITEMS[item.get(ItemKind)!.value]
    const q = e.get(Equips(item))!.quality
    attack += def.attack * q
    armor += def.armor * q
    speed += def.speed * q
  }
  const set = k.SET_BONUS[maskOf(e, ITEM_TAGS)]
  attack += set.attack; armor += set.armor; speed += set.speed
  if (e.has(Bannered)) armor += k.BANNER_ARMOR
  if (e.has(Veteran)) attack += k.VETERAN_ATTACK_STEP * Math.min(k.VETERAN_MAX_STEPS, k.fx.div(e.get(KillCount)!.value, k.VETERAN_KILLS))
  if (e.has(Haste)) speed = k.fx.div(speed * 3, 2)
  e.set(Stats, { attack, armor, speed })
}

/** Marks the units whose derived stats may have changed. The stats phase recomputes them. */
export const observeDirty = (world: World, dirty: Set<Entity>) => {
  const markDirty = (e: Entity) => void dirty.add(e)
  observePairs(world, Equips, markDirty)
  for (const t of [Haste, Bannered]) {
    world.onAdd(t, markDirty)
    world.onRemove(t, markDirty)
  }
  world.onAdd(Veteran, markDirty)
  world.onChange(KillCount, markDirty)
}

/** A new unit below a warlord or a bannered unit starts bannered, before its first stats recompute. */
export const bannerAtSpawn = (ctx: Ctx, e: Entity, parent: Entity) => {
  if (parent.get(Kind)!.value === ctx.k.KIND.WARLORD || parent.has(Bannered)) e.add(Bannered)
  recomputeStats(ctx, e)
}
