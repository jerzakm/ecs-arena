import type { Entity, World } from 'koota'
import type { Context } from './context.ts'
import { Haste, ItemKind, ItemTags, KillCount, Kind, Stats, Veteran } from './components.ts'
import { Equips } from './relations.ts'

export const recomputeStats = (ctx: Context, e: Entity) => {
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
  let mask = 0
  ItemTags.forEach((tag, kind) => { if (e.has(tag)) mask |= 1 << kind })
  const set = k.SET_BONUS[mask]
  attack += set.attack; armor += set.armor; speed += set.speed
  if (e.has(Veteran)) attack += k.VETERAN_ATTACK_STEP * Math.min(k.VETERAN_MAX_STEPS, k.fx.div(e.get(KillCount)!.value, k.VETERAN_KILLS))
  if (e.has(Haste)) speed = k.fx.div(speed * 3, 2)
  e.set(Stats, { attack, armor, speed })
}

// Units whose derived stats may have changed. Added(Equips) reports only the first pair of an entity in koota 0.6.6, so observers.
export const observeDirty = (world: World, dirty: Set<Entity>) => {
  const markDirty = (e: Entity) => void dirty.add(e)
  for (const t of [Equips, Haste]) {
    world.onAdd(t, markDirty)
    world.onRemove(t, markDirty)
  }
  world.onAdd(Veteran, markDirty)
  world.onChange(KillCount, markDirty)
}
