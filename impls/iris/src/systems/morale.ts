import { addComponent, collectEntities, defineSystem, hasComponent, not, removeComponent, type EntityId } from 'iris-ecs'
import type { Context } from '../context.ts'
import { Dead, Fleeing, MemberOf, Morale, Routed, Targets } from '../components.ts'
import { AnyGarrison } from '../relations.ts'
import { leaveGarrison } from '../garrison.ts'
import { followers, leadersOfMembers, newlyFleeing, newlyRouted } from '../queries.ts'

export const moraleSystem = (ctx: Context) => {
  const { k, world, get, set } = ctx
  const has = (e: EntityId, c: EntityId) => hasComponent(world, e, c)

  return defineSystem('morale', () => {
    const lost = new Map<EntityId, number>()
    const lose = (e: EntityId, n: number) => lost.set(e, (lost.get(e) ?? 0) + n)
    for (const d of collectEntities(world, [Dead])) {
      if (has(d, Morale)) lose(d, 1)
      else {
        const parent = ctx.targetOf(d, MemberOf)
        if (parent !== undefined && has(parent, Morale)) lose(parent, 1)
      }
    }
    for (const leader of collectEntities(world, leadersOfMembers)) {
      const parent = ctx.targetOf(leader, MemberOf)
      if (parent !== undefined && has(parent, Dead)) lose(leader, k.WARLORD_LOSS)
    }
    for (const [e, n] of lost) set(e, Morale, 'lost', get(e, Morale, 'lost') + n)

    const [num, den] = k.ROUT_LOST_PER_SIZE
    const routing: EntityId[] = []
    for (const e of collectEntities(world, [Morale, not(Routed)])) {
      if (get(e, Morale, 'lost') * den >= get(e, Morale, 'size0') * num) routing.push(e)
    }
    for (const e of routing) addComponent(world, e, Routed)

    const routed = new Set(collectEntities(world, newlyRouted))
    if (routed.size > 0) {
      const flee: EntityId[] = []
      for (const e of routed) if (!has(e, Dead) && !has(e, Fleeing)) flee.push(e)
      for (const m of collectEntities(world, followers)) {
        const parent = ctx.targetOf(m, MemberOf)
        if (parent !== undefined && routed.has(parent as never)) flee.push(m)
      }
      for (const e of flee) addComponent(world, e, Fleeing)
    }

    for (const e of collectEntities(world, newlyFleeing)) {
      if (has(e, AnyGarrison)) leaveGarrison(ctx, e)
      ctx.setLink(e, Targets, undefined)
      ctx.threatOf(e).length = 0
      if (has(e, Morale) && has(e, MemberOf)) removeComponent(world, e, MemberOf)
    }
  })
}
