import type { Entity } from 'koota'
import type { Ctx } from '../context.ts'
import { Fleeing, GameId, GarrisonOf, Position, Score, Shrine, Team } from '../traits.ts'
import { byNearest, sortedByGameId } from '../../shared/util.ts'
import { enterGarrison, leaveGarrison } from '../garrison.ts'

/** `v` limited to -max..max. */
const clamp = (v: number, max: number) => Math.max(-max, Math.min(max, v))

export const objectivesSystem = (ctx: Ctx) => {
  const { k, world } = ctx
  const cap = ctx.scenario.garrisonCap

  return () => {
    const shrines = sortedByGameId(world, GameId, Shrine)
    for (const { e } of shrines) {
      const pos = e.get(Position)!
      const count = [0, 0]
      ctx.grid.forNear(pos.x, pos.y, k.SHRINE_RADIUS, (h) => {
        if (!ctx.unitAt[h].has(Fleeing)) count[ctx.teamAt[h]]++
      })
      for (const g of world.query(GarrisonOf(e))) count[g.get(Team)!.value]++
      const step = clamp(count[0] - count[1], k.SHRINE_STEP_MAX)
      const was = e.get(Shrine)!.owner
      e.set(Shrine, (s) => {
        const progress = clamp(s.progress + step, k.SHRINE_PROGRESS_MAX)
        return { progress, owner: progress === k.SHRINE_PROGRESS_MAX ? 0 : progress === -k.SHRINE_PROGRESS_MAX ? 1 : s.owner }
      })
      const owner = e.get(Shrine)!.owner
      if (owner !== was) for (const g of Array.from(world.query(GarrisonOf(e)))) leaveGarrison(ctx, g)
      const held = world.query(GarrisonOf(e)).length
      if (owner === -1 || held >= cap) continue
      const near: { u: Entity; gameId: number; d2: number }[] = []
      ctx.grid.forNear(pos.x, pos.y, k.SHRINE_RADIUS, (h, d2, gameId) => {
        if (ctx.teamAt[h] === owner && !ctx.unitAt[h].has(Fleeing)) near.push({ u: ctx.unitAt[h], gameId, d2 })
      })
      near.sort(byNearest)
      for (const { u } of near.slice(0, cap - held)) enterGarrison(ctx, u, e)
    }
    const owned = [0, 0]
    world.query(Shrine).readEach(([s]) => { if (s.owner >= 0) owned[s.owner]++ })
    world.set(Score, { shrines0: owned[0], shrines1: owned[1] })
  }
}
