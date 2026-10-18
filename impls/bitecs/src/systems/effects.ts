import { addComponent, hasComponent, query, removeComponent } from 'bitecs'
import type { Context } from '../context.ts'
import { Burn, Dead, Haste, Health, Stun, Unit } from '../components.ts'
import { removeThreat, Threat, threatCount } from '../relations.ts'

export const effectsSystem = (ctx: Context) => {
  const { k, world } = ctx
  const { fx } = k
  const units = [Unit]

  return () => {
    const stunned: number[] = [], hasted: number[] = [], burnedOut: number[] = [], dying: number[] = []
    for (const e of query(world, [Stun])) if (--Stun.ticksLeft[e] === 0) stunned.push(e)
    for (const e of query(world, [Haste])) if (--Haste.ticksLeft[e] === 0) hasted.push(e)
    for (const e of query(world, [Burn, Health])) {
      Burn.ticksLeft[e]--
      if (Burn.ticksLeft[e] % k.BURN_INTERVAL === 0) {
        Health.hp[e] -= k.BURN_DAMAGE
        if (Health.hp[e] <= 0) dying.push(e)
      }
      if (Burn.ticksLeft[e] === 0) burnedOut.push(e)
    }
    for (const e of stunned) removeComponent(world, e, Stun)
    for (const e of hasted) removeComponent(world, e, Haste)
    for (const e of burnedOut) removeComponent(world, e, Burn)
    for (const e of dying) if (!hasComponent(world, e, Dead)) addComponent(world, e, Dead)

    if (world.clock % k.THREAT_DECAY_PERIOD === 0) {
      const gone: number[] = [] // pairs: victim, attacker
      for (const victim of query(world, units)) {
        if (threatCount(victim) === 0) continue
        const attackers = Threat.attackers[victim], amounts = Threat.amount[victim]
        for (let i = 0; i < attackers.length; i++) {
          const amount = amounts[i]
          const left = amount - Math.max(1, fx.div(amount, 4))
          if (left <= 0) gone.push(victim, attackers[i])
          else amounts[i] = left
        }
      }
      for (let i = 0; i < gone.length; i += 2) removeThreat(gone[i], gone[i + 1])
    }
  }
}
