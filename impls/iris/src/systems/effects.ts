import { addComponent, collectEntities, defineSystem, hasComponent, removeComponent, type EntityId } from 'iris-ecs'
import type { Context } from '../context.ts'
import { Burn, Dead, Haste, Health, Stun } from '../components.ts'
import { threatened } from '../queries.ts'

export const effectsSystem = (ctx: Context) => {
  const { k, world, get, set } = ctx
  const { fx } = k

  return defineSystem('effects', () => {
    const expired: [EntityId, typeof Stun | typeof Haste][] = []
    const dying: EntityId[] = []
    for (const e of collectEntities(world, [Stun])) {
      const left = get(e, Stun, 'ticksLeft') - 1
      set(e, Stun, 'ticksLeft', left)
      if (left === 0) expired.push([e, Stun])
    }
    for (const e of collectEntities(world, [Haste])) {
      const left = get(e, Haste, 'ticksLeft') - 1
      set(e, Haste, 'ticksLeft', left)
      if (left === 0) expired.push([e, Haste])
    }
    const burnedOut: EntityId[] = []
    for (const e of collectEntities(world, [Burn, Health])) {
      const left = get(e, Burn, 'ticksLeft') - 1
      set(e, Burn, 'ticksLeft', left)
      if (left % k.BURN_INTERVAL === 0) {
        const hp = get(e, Health, 'hp') - k.BURN_DAMAGE
        set(e, Health, 'hp', hp)
        if (hp <= 0) dying.push(e)
      }
      if (left === 0) burnedOut.push(e)
    }
    for (const [e, buff] of expired) removeComponent(world, e, buff)
    for (const e of burnedOut) removeComponent(world, e, Burn)
    for (const e of dying) if (!hasComponent(world, e, Dead)) addComponent(world, e, Dead)

    if (ctx.tickNow() % k.THREAT_DECAY_PERIOD === 0) {
      for (const victim of collectEntities(world, threatened)) {
        const edges = ctx.threatOf(victim)
        for (let i = edges.length - 2; i >= 0; i -= 2) {
          const left = edges[i + 1] - Math.max(1, fx.div(edges[i + 1], 4))
          if (left <= 0) edges.splice(i, 2)
          else edges[i + 1] = left
        }
      }
    }
  })
}
