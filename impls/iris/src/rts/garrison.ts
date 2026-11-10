import { addComponent, type EntityId, getComponentValue, getRelationTargets, pair, removeComponent } from 'iris-ecs'
import { GarrisonOf, Position, Targets } from './components.ts'
import type { Ctx } from './context.ts'
import { setLink } from './links.ts'

// A garrisoned unit leaves the move and target queries through `not(AnyGarrison)`, and it leaves the kernel grid.
export const enterGarrison = (ctx: Ctx, unit: EntityId, shrine: EntityId, by: Map<EntityId, EntityId[]>) => {
  const { world } = ctx
  addComponent(world, unit, pair(GarrisonOf, shrine))
  setLink(ctx, unit, Targets, undefined)
  for (const s of by.get(unit) ?? []) setLink(ctx, s, Targets, undefined)
  ctx.units.leave(unit)
}

export const leaveGarrison = (ctx: Ctx, unit: EntityId) => {
  const { world } = ctx
  removeComponent(world, unit, pair(GarrisonOf, getRelationTargets(world, unit, GarrisonOf)[0]))
  ctx.units.rejoin(unit, getComponentValue(world, unit, Position, 'x')!, getComponentValue(world, unit, Position, 'y')!)
}
