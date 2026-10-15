import type { Context } from '../context.ts'
import { dropTargetsTo, enterGarrison, leaveGarrison } from '../garrison.ts'
import type { Unit } from '../types.ts'

export const objectivesSystem = (ctx: Context) => {
  const { k, add, begin, end, world, shrines, inRange } = ctx
  const naive = ctx.isNaive('objectives.capture'), naiveGarrison = ctx.isNaive('garrison')
  const cap = ctx.scenario.garrisonCap

  return () => {
    const { units } = ctx
    const entered: Unit[] = []
    ctx.resendGrid()
    begin('objectives.capture')
    for (let s_i = 0, s = shrines[0]; s_i < shrines.length; s = shrines[++s_i]) {
      const count = [0, 0]
      if (naive) {
        for (let u_i = 0, u = units[0]; u_i < units.length; u = units[++u_i]) if (!u.fleeing && inRange(k.SHRINE_X, s.y, u.x, u.y, k.SHRINE_RADIUS)) count[u.team]++
      } else {
        ctx.grid.forNear(k.SHRINE_X, s.y, k.SHRINE_RADIUS, (h) => {
          const u = ctx.slots[h]
          if (!u.fleeing && !u.garrison) count[u.team]++
        }, 'shrine')
        begin('garrison')
        // The members of a garrison: the normal code reads the shrine's list, the naive code scans every unit for GarrisonOf.
        if (naiveGarrison) { for (let u_i = 0, u = units[0]; u_i < units.length; u = units[++u_i]) if (u.garrison === s) count[u.team]++ }
        else for (let g_i = 0, g = s.garrison[0]; g_i < s.garrison.length; g = s.garrison[++g_i]) count[g.team]++
        end('garrison')
      }
      const step = Math.max(-k.SHRINE_STEP_MAX, Math.min(k.SHRINE_STEP_MAX, count[0] - count[1]))
      s.progress = Math.max(-k.SHRINE_PROGRESS_MAX, Math.min(k.SHRINE_PROGRESS_MAX, s.progress + step))
      const was = s.owner
      if (s.progress === k.SHRINE_PROGRESS_MAX) s.owner = 0
      else if (s.progress === -k.SHRINE_PROGRESS_MAX) s.owner = 1
      if (s.owner !== was) add('shrine.capture')

      begin('garrison')
      if (s.owner !== was) while (s.garrison.length > 0) leaveGarrison(ctx, s.garrison[s.garrison.length - 1])
      if (s.owner !== -1 && s.garrison.length < cap) {
        const near: Unit[] = []
        ctx.grid.forNear(k.SHRINE_X, s.y, k.SHRINE_RADIUS, (h) => {
          const u = ctx.slots[h]
          if (u.team === s.owner && !u.fleeing && !u.garrison) near.push(u)
        }, 'garrison')
        const d2 = (u: Unit) => k.distSq(k.SHRINE_X, s.y, u.x, u.y)
        near.sort((a, b) => d2(a) - d2(b) || a.gameId - b.gameId)
        for (let i = 0; i < near.length && s.garrison.length < cap; i++) { enterGarrison(ctx, near[i], s); entered.push(near[i]) }
      }
      end('garrison')
    }
    world.score = [shrines.filter((s) => s.owner === 0).length, shrines.filter((s) => s.owner === 1).length]
    end('objectives.capture')
    begin('garrison')
    dropTargetsTo(ctx, entered)
    end('garrison')
  }
}
