import type { Context } from './context.ts'
import type { Unit } from './types.ts'

export const recomputeStats = (ctx: Context, u: Unit) => {
  const { k } = ctx
  const { fx, BUFF, UNIT_STATS, ITEMS } = k
  const base = UNIT_STATS[u.kind]
  let attack = base.attack, armor = base.armor, speed = base.speed
  for (let it_i = 0, it = u.items[0]; it_i < u.items.length; it = u.items[++it_i]) {
    attack += ITEMS[it.kind].attack * it.quality
    armor += ITEMS[it.kind].armor * it.quality
    speed += ITEMS[it.kind].speed * it.quality
  }
  if (u.veteran) attack += k.VETERAN_ATTACK_STEP * Math.min(k.VETERAN_MAX_STEPS, fx.div(u.killCount, k.VETERAN_KILLS))
  if (u.buffs[BUFF.HASTE] > 0) speed = fx.div(speed * 3, 2)
  u.attack = attack; u.armor = armor; u.speed = speed
}
