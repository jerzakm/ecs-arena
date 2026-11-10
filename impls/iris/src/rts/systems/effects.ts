import {
  addComponent, collectEntities, defineSystem, type EntityId, getComponentValue, getResourceValue, hasComponent, removeComponent,
  setComponentValue,
} from 'iris-ecs'
import { Burn, Clock, Dead, Haste, Health, Stun, Threat } from '../components.ts'
import type { Ctx } from '../context.ts'
import { burning, hasted, stunned, threatened } from '../queries.ts'

export const effectsSystem = (ctx: Ctx) => {
  const { k, world } = ctx
  const { fx } = k

  return defineSystem('effects', () => {
    const expired: [EntityId, typeof Stun | typeof Haste][] = []
    const dying: EntityId[] = []
    for (const e of collectEntities(world, stunned)) {
      const left = getComponentValue(world, e, Stun, 'ticksLeft') - 1
      setComponentValue(world, e, Stun, 'ticksLeft', left)
      if (left === 0) expired.push([e, Stun])
    }
    for (const e of collectEntities(world, hasted)) {
      const left = getComponentValue(world, e, Haste, 'ticksLeft') - 1
      setComponentValue(world, e, Haste, 'ticksLeft', left)
      if (left === 0) expired.push([e, Haste])
    }
    const burnedOut: EntityId[] = []
    for (const e of collectEntities(world, burning)) {
      const left = getComponentValue(world, e, Burn, 'ticksLeft') - 1
      setComponentValue(world, e, Burn, 'ticksLeft', left)
      if (left % k.BURN_INTERVAL === 0) {
        const hp = getComponentValue(world, e, Health, 'hp') - k.BURN_DAMAGE
        setComponentValue(world, e, Health, 'hp', hp)
        if (hp <= 0) dying.push(e)
      }
      if (left === 0) burnedOut.push(e)
    }
    for (const [e, buff] of expired) removeComponent(world, e, buff)
    for (const e of burnedOut) removeComponent(world, e, Burn)
    for (const e of dying) if (!hasComponent(world, e, Dead)) addComponent(world, e, Dead)

    if (getResourceValue(world, Clock, 'tick')! % k.THREAT_DECAY_PERIOD === 0) {
      for (const victim of collectEntities(world, threatened)) {
        const edges = getComponentValue(world, victim, Threat, 'edges')
        for (let i = edges.length - 2; i >= 0; i -= 2) {
          const left = edges[i + 1] - Math.max(1, fx.div(edges[i + 1], 4))
          if (left <= 0) edges.splice(i, 2)
          else edges[i + 1] = left
        }
      }
    }
  })
}
