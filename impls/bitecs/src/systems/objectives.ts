import { hasComponent, query } from 'bitecs'
import type { Context } from '../context.ts'
import { Fleeing, Position, Projectile, Shrine, Team, Unit } from '../components.ts'
import { enterGarrison, leaveGarrison } from '../garrison.ts'
import { clearLink, GarrisonOf, Targets } from '../relations.ts'

export const objectivesSystem = (ctx: Context) => {
  const { k, world } = ctx
  const cap = ctx.scenario.garrisonCap
  const targeting = [[Unit], [Projectile]] // the holders of a Targets link: units and projectiles

  return () => {
    const entered = new Set<number>()
    for (const e of ctx.sortedByGameId(Shrine)) {
      const garrison = GarrisonOf.from![e] ??= [] // the members of this shrine, from the reverse index
      const x = Position.x[e], y = Position.y[e]
      const count = [0, 0]
      ctx.grid.forNear(x, y, k.SHRINE_RADIUS, (h) => {
        if (!hasComponent(world, h, Fleeing)) count[Team.value[h]]++
      })
      for (const g of garrison) count[Team.value[g]]++
      const step = Math.max(-k.SHRINE_STEP_MAX, Math.min(k.SHRINE_STEP_MAX, count[0] - count[1]))
      const was = Shrine.owner[e]
      const progress = Math.max(-k.SHRINE_PROGRESS_MAX, Math.min(k.SHRINE_PROGRESS_MAX, Shrine.progress[e] + step))
      Shrine.progress[e] = progress
      if (progress === k.SHRINE_PROGRESS_MAX) Shrine.owner[e] = 0
      else if (progress === -k.SHRINE_PROGRESS_MAX) Shrine.owner[e] = 1
      const owner = Shrine.owner[e]
      if (owner !== was) for (const g of garrison.slice()) leaveGarrison(ctx, g)
      const held = garrison.length
      if (owner === -1 || held >= cap) continue
      const near: { u: number; id: number; d2: number }[] = []
      ctx.grid.forNear(x, y, k.SHRINE_RADIUS, (h, d2, id) => {
        if (Team.value[h] === owner && !hasComponent(world, h, Fleeing)) near.push({ u: h, id, d2 })
      })
      near.sort((a, b) => a.d2 - b.d2 || a.id - b.id)
      for (const { u } of near.slice(0, cap - held)) { enterGarrison(ctx, u, e); entered.add(u) }
    }
    // Units that targeted a garrisoned unit lose the target. One pass over all targeters, not one query for each entering unit.
    if (entered.size > 0) for (const terms of targeting) for (const a of query(world, terms)) if (entered.has(Targets.to[a])) clearLink(a, Targets)

    const owned = [0, 0]
    for (const e of query(world, [Shrine])) if (Shrine.owner[e] >= 0) owned[Shrine.owner[e]]++
    world.score.shrines0 = owned[0]; world.score.shrines1 = owned[1]
  }
}
