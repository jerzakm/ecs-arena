import type { Ctx } from '../context.ts'
import { leaveGarrison } from '../garrison.ts'
import { dropMember } from '../hierarchy.ts'
import type { Unit } from '../types.ts'
import { retarget } from '../targets.ts'
import { byGameId } from '../../shared/util.ts'

export const moraleSystem = (ctx: Ctx) => {
  const { k, add, begin, end, unitById } = ctx
  const naiveLinks = ctx.isNaive('links'), naiveRout = ctx.isNaive('morale.rout'), naiveFlee = ctx.isNaive('morale.onFlee')

  return () => {
    const units = ctx.units
    const dead = units.filter((u) => u.dead)
    const touched = new Set<Unit>() // units whose `lost` changed in this tick, the only ones that can newly rout
    begin('links')
    const membersOf = (id: number): Unit[] => (naiveLinks ? units.filter((m) => m.memberOf === id) : ctx.members.get(id) ?? [])
    for (let d_i = 0, d = dead[0]; d_i < dead.length; d = dead[++d_i]) {
      if (d.morale) { d.morale.lost += 1; touched.add(d) }
      else {
        const parent = d.memberOf === -1 ? undefined : unitById.get(d.memberOf)
        if (parent?.morale) { parent.morale.lost += 1; touched.add(parent) }
      }
      for (const m of membersOf(d.gameId)) if (m.morale) { m.morale.lost += k.WARLORD_LOSS; touched.add(m) }
    }
    end('links')

    begin('morale.rout')
    const [num, den] = k.ROUT_LOST_PER_SIZE
    const wouldRout = (u: Unit) => u.morale && !u.routed && u.morale.lost * den >= u.morale.size0 * num
    // Normal code reads the units whose loss changed. The naive code polls every unit each tick.
    const newlyRouted = naiveRout ? units.filter(wouldRout) : [...touched].filter(wouldRout).sort(byGameId)
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
      for (const m of naiveRout || naiveLinks ? units.filter((x) => x.memberOf === leader.gameId) : ctx.members.get(leader.gameId) ?? []) if (!m.morale) flee(m)
    }
    end('morale.rout')

    begin('morale.onFlee')
    let fresh = newlyFleeing
    if (naiveFlee) {
      fresh = units.filter((u) => u.fleeing && !ctx.prevFleeing.has(u))
      ctx.prevFleeing = new Set(units.filter((u) => u.fleeing))
    }
    for (let u_i = 0, u = fresh[0]; u_i < fresh.length; u = fresh[++u_i]) {
      if (u.target !== -1) { retarget(ctx, u, -1); add('rel.Targets.remove') }
      add('rel.Threat.dropOnFlee', u.threat.length)
      u.threat = []
      if (u.morale && u.memberOf !== -1) { dropMember(ctx, u); u.memberOf = -1; u.pref = undefined; u.offX = 0; u.offY = 0; add('rel.MemberOf.remove') }
      if (u.garrison) { begin('garrison'); leaveGarrison(ctx, u); end('garrison') }
    }
    end('morale.onFlee')
  }
}
