import {
  addComponent, collectEntities, defineSystem, type EntityId, getComponentValue, hasComponent, removeComponent, setComponentValue,
} from 'iris-ecs'
import { AnyGarrison, Dead, Fleeing, MemberOf, Morale, Routed, Targets, Threat } from '../components.ts'
import type { Ctx } from '../context.ts'
import { leaveGarrison } from '../garrison.ts'
import { setLink, targetOf } from '../links.ts'
import { dead, followers, leadersOfMembers, newlyFleeing, newlyRouted, unroutedLeaders } from '../queries.ts'

export const moraleSystem = (ctx: Ctx) => {
  const { k, world } = ctx

  return defineSystem('morale', () => {
    const lost = new Map<EntityId, number>()
    const lose = (e: EntityId, n: number) => lost.set(e, (lost.get(e) ?? 0) + n)
    for (const d of collectEntities(world, dead)) {
      if (hasComponent(world, d, Morale)) lose(d, 1)
      else {
        const parent = targetOf(ctx, d, MemberOf)
        if (parent !== undefined && hasComponent(world, parent, Morale)) lose(parent, 1)
      }
    }
    for (const leader of collectEntities(world, leadersOfMembers)) {
      const parent = targetOf(ctx, leader, MemberOf)
      if (parent !== undefined && hasComponent(world, parent, Dead)) lose(leader, k.WARLORD_LOSS)
    }
    for (const [e, n] of lost) setComponentValue(world, e, Morale, 'lost', getComponentValue(world, e, Morale, 'lost')! + n)

    const [num, den] = k.ROUT_LOST_PER_SIZE
    const routing: EntityId[] = []
    for (const e of collectEntities(world, unroutedLeaders)) {
      if (getComponentValue(world, e, Morale, 'lost') * den >= getComponentValue(world, e, Morale, 'size0') * num) routing.push(e)
    }
    for (const e of routing) addComponent(world, e, Routed)

    const routed = new Set<EntityId>(collectEntities(world, newlyRouted))
    if (routed.size > 0) {
      const flee: EntityId[] = []
      for (const e of routed) if (!hasComponent(world, e, Dead) && !hasComponent(world, e, Fleeing)) flee.push(e)
      for (const m of collectEntities(world, followers)) {
        const parent = targetOf(ctx, m, MemberOf)
        if (parent !== undefined && routed.has(parent)) flee.push(m)
      }
      for (const e of flee) addComponent(world, e, Fleeing)
    }

    for (const e of collectEntities(world, newlyFleeing)) {
      if (hasComponent(world, e, AnyGarrison)) leaveGarrison(ctx, e)
      setLink(ctx, e, Targets, undefined)
      getComponentValue(world, e, Threat, 'edges')!.length = 0
      if (hasComponent(world, e, Morale) && hasComponent(world, e, MemberOf)) removeComponent(world, e, MemberOf)
    }
  })
}
