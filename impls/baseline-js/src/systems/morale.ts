import type { Context } from '../context.ts'
import { memberIndex } from '../hierarchy.ts'
import type { Unit } from '../types.ts'

export const moraleSystem = (ctx: Context) => {
  const { k, add, begin, end, unitById } = ctx
  const naiveLinks = ctx.isNaive('links'), naiveRout = ctx.isNaive('morale.rout'), naiveFlee = ctx.isNaive('morale.onFlee')

  return () => {
    const units = ctx.units
    begin('links')
    const members = memberIndex(ctx)
    const membersOf = (id: number): Unit[] => (naiveLinks ? units.filter((m) => m.memberOf === id) : members.get(id) ?? [])
    const dead = units.filter((u) => u.dead)
    for (let d_i = 0, d = dead[0]; d_i < dead.length; d = dead[++d_i]) {
      if (d.morale) d.morale.lost += 1
      else {
        const parent = d.memberOf === -1 ? undefined : unitById.get(d.memberOf)
        if (parent?.morale) parent.morale.lost += 1
      }
      for (const m of membersOf(d.gameId)) if (m.morale) m.morale.lost += k.WARLORD_LOSS
    }
    end('links')

    begin('morale.rout')
    const [num, den] = k.ROUT_LOST_PER_SIZE
    const newlyRouted = units.filter((u) => u.morale && !u.routed && u.morale.lost * den >= u.morale.size0 * num)
    const newlyFleeing: Unit[] = []
    const flee = (u: Unit) => {
      if (u.dead || u.fleeing) return
      u.fleeing = true
      newlyFleeing.push(u)
      add('tag.add.fleeing')
    }
    for (let leader_i = 0, leader = newlyRouted[0]; leader_i < newlyRouted.length; leader = newlyRouted[++leader_i]) {
      leader.routed = true
      add('tag.add.routed')
      flee(leader)
      for (const m of naiveRout ? units.filter((x) => x.memberOf === leader.gameId) : members.get(leader.gameId) ?? []) if (!m.morale) flee(m)
    }
    end('morale.rout')

    begin('morale.onFlee')
    let fresh = newlyFleeing
    if (naiveFlee) {
      fresh = units.filter((u) => u.fleeing && !ctx.prevFleeing.has(u))
      ctx.prevFleeing = new Set(units.filter((u) => u.fleeing))
    }
    for (let u_i = 0, u = fresh[0]; u_i < fresh.length; u = fresh[++u_i]) {
      if (u.target !== -1) { ctx.retarget(u, -1); add('rel.Targets.remove') }
      add('rel.Threat.dropOnFlee', u.threat.length)
      u.threat = []
      if (u.morale && u.memberOf !== -1) { u.memberOf = -1; u.offX = 0; u.offY = 0; add('rel.MemberOf.remove') }
    }
    end('morale.onFlee')
  }
}
