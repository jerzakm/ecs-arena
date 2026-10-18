import { addComponent, getRelationTargets, pair, removeComponent, type EntityId } from 'iris-ecs'
import type { Context } from './context.ts'
import { Position, Targets } from './components.ts'
import { GarrisonOf } from './relations.ts'

// A garrisoned unit leaves the move and target queries through `not(AnyGarrison)`, and it leaves the kernel grid.
export const enterGarrison = (ctx: Context, unit: EntityId, shrine: EntityId, by: Map<EntityId, EntityId[]>) => {
  const { world } = ctx
  addComponent(world, unit, pair(GarrisonOf, shrine))
  ctx.setLink(unit, Targets, undefined)
  for (const s of by.get(unit) ?? []) ctx.setLink(s, Targets, undefined)
  ctx.units.leave(unit)
}

export const leaveGarrison = (ctx: Context, unit: EntityId) => {
  const { world, get } = ctx
  removeComponent(world, unit, pair(GarrisonOf, getRelationTargets(world, unit, GarrisonOf)[0]))
  ctx.units.rejoin(unit, get(unit, Position, 'x'), get(unit, Position, 'y'))
}
