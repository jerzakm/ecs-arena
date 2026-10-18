import { collectEntities, defineSystem, hasComponent, pair, type EntityId } from 'iris-ecs'
import type { Context } from '../context.ts'
import { Fleeing, Position, Score, Shrine, Targets, Team } from '../components.ts'
import { enterGarrison, leaveGarrison } from '../garrison.ts'
import { anyTargeting } from '../queries.ts'
import { GarrisonOf } from '../relations.ts'

/** Who targets each entity: one scan of the `Targets` component. */
export const targeters = (ctx: Context): Map<EntityId, EntityId[]> => {
  const by = new Map<EntityId, EntityId[]>()
  for (const e of collectEntities(ctx.world, anyTargeting)) {
    const t = ctx.targetOf(e, Targets)
    if (t === undefined) continue
    const list = by.get(t)
    if (list) list.push(e)
    else by.set(t, [e])
  }
  return by
}

export const objectivesSystem = (ctx: Context) => {
  const { k, world, get, set } = ctx
  const cap = ctx.scenario.garrisonCap

  return defineSystem('objectives', () => {
    // The units that target each unit, scanned once, on the first entry of the phase.
    let by: Map<EntityId, EntityId[]> | undefined
    const shrines = ctx.sortedByGameId(Shrine)
    for (const { e } of shrines) {
      const px = get(e, Position, 'x'), py = get(e, Position, 'y')
      const count = [0, 0]
      ctx.grid.forNear(px, py, k.SHRINE_RADIUS, (h) => {
        if (!hasComponent(world, ctx.unitAt[h], Fleeing)) count[ctx.teamAt[h]]++
      })
      const garrison = () => collectEntities(world, [pair(GarrisonOf, e)])
      for (const g of garrison()) count[get(g, Team, 'value')]++
      const step = Math.max(-k.SHRINE_STEP_MAX, Math.min(k.SHRINE_STEP_MAX, count[0] - count[1]))
      const was = get(e, Shrine, 'owner')
      const progress = Math.max(-k.SHRINE_PROGRESS_MAX, Math.min(k.SHRINE_PROGRESS_MAX, get(e, Shrine, 'progress') + step))
      set(e, Shrine, 'progress', progress)
      const owner = progress === k.SHRINE_PROGRESS_MAX ? 0 : progress === -k.SHRINE_PROGRESS_MAX ? 1 : was
      set(e, Shrine, 'owner', owner)
      if (owner !== was) for (const g of garrison()) leaveGarrison(ctx, g)
      const held = garrison().length
      if (owner === -1 || held >= cap) continue
      const near: { u: EntityId; id: number; d2: number }[] = []
      ctx.grid.forNear(px, py, k.SHRINE_RADIUS, (h, d2, id) => {
        if (ctx.teamAt[h] === owner && !hasComponent(world, ctx.unitAt[h], Fleeing)) near.push({ u: ctx.unitAt[h], id, d2 })
      })
      near.sort((a, b) => a.d2 - b.d2 || a.id - b.id)
      for (const { u } of near.slice(0, cap - held)) enterGarrison(ctx, u, e, (by ??= targeters(ctx)))
    }
    const owned = [0, 0]
    for (const e of collectEntities(world, [Shrine])) {
      const o = get(e, Shrine, 'owner')
      if (o >= 0) owned[o]++
    }
    ctx.setRes(Score, 'shrines0', owned[0])
    ctx.setRes(Score, 'shrines1', owned[1])
  })
}
