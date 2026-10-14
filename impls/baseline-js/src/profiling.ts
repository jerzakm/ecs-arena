import type { Context } from './context.ts'

export const sampleEntities = (ctx: Context) => {
  const { counters, units, projectiles, groundItems, shrines, k } = ctx
  if (!counters) return
  const { KIND } = k
  let equipped = 0, minions = 0, warlords = 0
  for (let u_i = 0, u = units[0]; u_i < units.length; u = units[++u_i]) {
    equipped += u.items.length
    if (u.kind === KIND.MINION) minions++
    else if (u.kind === KIND.WARLORD) warlords++
  }
  counters.set('alive.unit', units.length - minions - warlords)
  counters.set('alive.warlord', warlords)
  counters.set('alive.minion', minions)
  counters.set('alive.projectile', projectiles.length)
  counters.set('alive.groundItem', groundItems.length)
  counters.set('alive.equippedItem', equipped)
  counters.set('alive.shrine', shrines.length)
  counters.set('alive.total', units.length + projectiles.length + groundItems.length + equipped + shrines.length)
}
