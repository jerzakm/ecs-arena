import type { Entity } from 'koota'
import type { Context } from '../context.ts'
import { Fleeing, Position, Score, Shrine, Team } from '../components.ts'
import { enterGarrison, leaveGarrison } from '../garrison.ts'
import { GarrisonOf } from '../relations.ts'

export const objectivesSystem = (ctx: Context) => {
  const { k, world } = ctx
  const cap = ctx.scenario.garrisonCap

  return () => {
    const shrines = ctx.sortedByGameId(Shrine)
    for (const { e } of shrines) {
      const pos = e.get(Position)!
      const count = [0, 0]
      ctx.grid.forNear(pos.x, pos.y, k.SHRINE_RADIUS, (h) => {
        if (!ctx.unitAt[h].has(Fleeing)) count[ctx.teamAt[h]]++
      })
      for (const g of world.query(GarrisonOf(e))) count[g.get(Team)!.value]++
      const step = Math.max(-k.SHRINE_STEP_MAX, Math.min(k.SHRINE_STEP_MAX, count[0] - count[1]))
      const was = e.get(Shrine)!.owner
      e.set(Shrine, (s) => {
        const progress = Math.max(-k.SHRINE_PROGRESS_MAX, Math.min(k.SHRINE_PROGRESS_MAX, s.progress + step))
        return { progress, owner: progress === k.SHRINE_PROGRESS_MAX ? 0 : progress === -k.SHRINE_PROGRESS_MAX ? 1 : s.owner }
      })
      const owner = e.get(Shrine)!.owner
      if (owner !== was) for (const g of Array.from(world.query(GarrisonOf(e)))) leaveGarrison(ctx, g)
      const held = world.query(GarrisonOf(e)).length
      if (owner === -1 || held >= cap) continue
      const near: { u: Entity; id: number; d2: number }[] = []
      ctx.grid.forNear(pos.x, pos.y, k.SHRINE_RADIUS, (h, d2, id) => {
        if (ctx.teamAt[h] === owner && !ctx.unitAt[h].has(Fleeing)) near.push({ u: ctx.unitAt[h], id, d2 })
      })
      near.sort((a, b) => a.d2 - b.d2 || a.id - b.id)
      for (const { u } of near.slice(0, cap - held)) enterGarrison(ctx, u, e)
    }
    const owned = [0, 0]
    world.query(Shrine).readEach(([s]) => { if (s.owner >= 0) owned[s.owner]++ })
    world.set(Score, { shrines0: owned[0], shrines1: owned[1] })
  }
}
