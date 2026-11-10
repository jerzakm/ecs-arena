import { addComponent, query, removeComponent } from 'bitecs'
import type { Ctx } from '../context.ts'
import { Burn, Dead, Haste, Health, Stun } from '../components.ts'
import { Q } from '../queries.ts'
import { removeThreat, Threat, threatCount } from '../relations.ts'

export const effectsSystem = (ctx: Ctx) => {
  const { k, world } = ctx
  const { fx } = k

  return () => {
    const stunned: number[] = [], hasted: number[] = [], burnedOut: number[] = [], dying: number[] = []
    for (const e of query(world, Q.stunned)) if (--Stun.ticksLeft[e] === 0) stunned.push(e)
    for (const e of query(world, Q.hasted)) if (--Haste.ticksLeft[e] === 0) hasted.push(e)
    for (const e of query(world, Q.burning)) {
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
    for (const e of dying) addComponent(world, e, Dead)

    if (world.tick % k.THREAT_DECAY_PERIOD === 0) {
      const gone: number[] = [] // pairs: victim, attacker
      for (const victim of query(world, Q.units)) {
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
