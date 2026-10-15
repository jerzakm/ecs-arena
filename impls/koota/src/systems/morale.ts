import { Not, type Entity } from 'koota'
import type { Context } from '../context.ts'
import { Dead, Fleeing, Garrisoned, Morale, Routed } from '../components.ts'
import { leaveGarrison } from '../garrison.ts'
import { MemberOf, Targets, Threat } from '../relations.ts'

export const moraleSystem = (ctx: Context) => {
  const { k, world, q } = ctx

  return () => {
    const lost = new Map<Entity, number>()
    const lose = (e: Entity, n: number) => lost.set(e, (lost.get(e) ?? 0) + n)
    for (const d of world.query(Dead)) {
      if (d.has(Morale)) lose(d, 1)
      else {
        const parent = d.targetFor(MemberOf)
        if (parent?.has(Morale)) lose(parent, 1)
      }
    }
    for (const leader of world.query(Morale, MemberOf('*'))) {
      if (leader.targetFor(MemberOf)!.has(Dead)) lose(leader, k.WARLORD_LOSS)
    }
    for (const [e, n] of lost) e.set(Morale, (m) => ({ lost: m.lost + n }))

    const [num, den] = k.ROUT_LOST_PER_SIZE
    const routing: Entity[] = []
    world.query(Morale, Not(Routed)).readEach(([m], e) => { if (m.lost * den >= m.size0 * num) routing.push(e) })
    for (const e of routing) e.add(Routed)

    const routed = new Set(world.query(q.newlyRouted))
    if (routed.size > 0) {
      const flee: Entity[] = []
      for (const e of routed) if (!e.has(Dead) && !e.has(Fleeing)) flee.push(e)
      for (const m of world.query(MemberOf('*'), Not(Morale), Not(Fleeing), Not(Dead))) {
        if (routed.has(m.targetFor(MemberOf)!)) flee.push(m)
      }
      for (const e of flee) e.add(Fleeing)
    }

    for (const e of world.query(q.newlyFleeing)) {
      if (e.has(Garrisoned)) leaveGarrison(ctx, e)
      e.remove(Targets('*'))
      e.remove(Threat('*'))
      if (e.has(Morale)) e.remove(MemberOf('*'))
    }
  }
}
