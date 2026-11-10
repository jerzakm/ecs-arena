import {
  collectEntities, defineSystem, type EntityId, getComponentValue, hasComponent, setComponentValue, setResourceValue,
} from 'iris-ecs'
import { sortedByGameId } from '../../shared/util.ts'
import { Fleeing, Position, Score, Shrine, Targets, Team } from '../components.ts'
import type { Ctx } from '../context.ts'
import { enterGarrison, leaveGarrison } from '../garrison.ts'
import { targetOf } from '../links.ts'
import { allShrines, anyTargeting, garrisonOf } from '../queries.ts'

/** Who targets each entity: one scan of the `Targets` component. */
export const targeters = (ctx: Ctx): Map<EntityId, EntityId[]> => {
  const by = new Map<EntityId, EntityId[]>()
  for (const e of collectEntities(ctx.world, anyTargeting)) {
    const t = targetOf(ctx, e, Targets)
    if (t === undefined) continue
    const list = by.get(t)
    if (list) list.push(e)
    else by.set(t, [e])
  }
  return by
}

export const objectivesSystem = (ctx: Ctx) => {
  const { k, world } = ctx
  const cap = ctx.scenario.garrisonCap

  return defineSystem('objectives', () => {
    // The units that target each unit, scanned once, on the first entry of the phase.
    let by: Map<EntityId, EntityId[]> | undefined
    const shrines = sortedByGameId(world, Shrine)
    for (const { e } of shrines) {
      const px = getComponentValue(world, e, Position, 'x')!, py = getComponentValue(world, e, Position, 'y')!
      const count = [0, 0]
      ctx.units.grid.forNear(px, py, k.SHRINE_RADIUS, (h) => {
        if (!hasComponent(world, ctx.units.entityAt[h], Fleeing)) count[ctx.units.tagAt[h]]++
      })
      const garrison = () => collectEntities(world, garrisonOf(e))
      for (const g of garrison()) count[getComponentValue(world, g, Team, 'value')!]++
      const step = Math.max(-k.SHRINE_STEP_MAX, Math.min(k.SHRINE_STEP_MAX, count[0] - count[1]))
      const was = getComponentValue(world, e, Shrine, 'owner')!
      const lead = getComponentValue(world, e, Shrine, 'progress')! + step
      const progress = Math.max(-k.SHRINE_PROGRESS_MAX, Math.min(k.SHRINE_PROGRESS_MAX, lead))
      setComponentValue(world, e, Shrine, 'progress', progress)
      const owner = progress === k.SHRINE_PROGRESS_MAX ? 0 : progress === -k.SHRINE_PROGRESS_MAX ? 1 : was
      setComponentValue(world, e, Shrine, 'owner', owner)
      if (owner !== was) for (const g of garrison()) leaveGarrison(ctx, g)
      const held = garrison().length
      if (owner === -1 || held >= cap) continue
      const near: { u: EntityId; id: number; d2: number }[] = []
      ctx.units.grid.forNear(px, py, k.SHRINE_RADIUS, (h, d2, id) => {
        const u = ctx.units.entityAt[h]
        if (ctx.units.tagAt[h] === owner && !hasComponent(world, u, Fleeing)) near.push({ u, id, d2 })
      })
      near.sort((a, b) => a.d2 - b.d2 || a.id - b.id)
      for (const { u } of near.slice(0, cap - held)) enterGarrison(ctx, u, e, (by ??= targeters(ctx)))
    }
    const owned = [0, 0]
    for (const e of collectEntities(world, allShrines)) {
      const o = getComponentValue(world, e, Shrine, 'owner')!
      if (o >= 0) owned[o]++
    }
    setResourceValue(world, Score, 'shrines0', owned[0])
    setResourceValue(world, Score, 'shrines1', owned[1])
  })
}
