import { addComponent, entityExists, hasComponent, Not, query } from 'bitecs'
import type { Context } from '../context.ts'
import { Dead, Fleeing, Garrisoned, Morale, Routed, Unit } from '../components.ts'
import { leaveGarrison } from '../garrison.ts'
import { clearLink, clearThreat, MemberOf, Targets } from '../relations.ts'

export const moraleSystem = (ctx: Context) => {
  const { k, world } = ctx
  const leaders = [Morale]
  const unrouted = [Morale, Not(Routed)]
  const members = [Unit, Not(Morale), Not(Fleeing), Not(Dead)]

  return () => {
    const lost = new Map<number, number>()
    const lose = (e: number, n: number) => lost.set(e, (lost.get(e) ?? 0) + n)
    for (const d of query(world, [Dead])) {
      if (hasComponent(world, d, Morale)) lose(d, 1)
      else {
        const parent = MemberOf.to[d]
        if (parent !== -1 && hasComponent(world, parent, Morale)) lose(parent, 1)
      }
    }
    for (const leader of query(world, leaders)) {
      if (MemberOf.to[leader] !== -1 && hasComponent(world, MemberOf.to[leader], Dead)) lose(leader, k.WARLORD_LOSS)
    }
    for (const [e, n] of lost) Morale.lost[e] += n

    const [num, den] = k.ROUT_LOST_PER_SIZE
    const routing: number[] = []
    for (const e of query(world, unrouted)) if (Morale.lost[e] * den >= Morale.size0[e] * num) routing.push(e)
    for (const e of routing) addComponent(world, e, Routed)

    // Rules on Added: the observers in context.ts collect the entities that gained Routed and Fleeing.
    const routed = new Set(ctx.newlyRouted.filter((e) => entityExists(world, e) && hasComponent(world, e, Routed)))
    ctx.newlyRouted.length = 0
    if (routed.size > 0) {
      const flee: number[] = []
      for (const e of routed) if (!hasComponent(world, e, Dead) && !hasComponent(world, e, Fleeing)) flee.push(e)
      for (const m of query(world, members)) if (MemberOf.to[m] !== -1 && routed.has(MemberOf.to[m])) flee.push(m)
      for (const e of flee) addComponent(world, e, Fleeing)
    }

    const fleeing = ctx.newlyFleeing.filter((e) => entityExists(world, e) && hasComponent(world, e, Fleeing))
    ctx.newlyFleeing.length = 0
    for (const e of fleeing) {
      if (hasComponent(world, e, Garrisoned)) leaveGarrison(ctx, e)
      clearLink(e, Targets)
      clearThreat(e)
      if (hasComponent(world, e, Morale)) clearLink(e, MemberOf)
    }
  }
}
