import type { Entity } from 'koota'
import type { Ctx } from './context.ts'
import { GameId, Garrisoned, Position, GarrisonOf, Targets } from './traits.ts'

// A garrisoned unit leaves the move and target queries through `Not(Garrisoned)`, and it leaves the kernel grid.
export const enterGarrison = (ctx: Ctx, unit: Entity, shrine: Entity) => {
  unit.add(Garrisoned, GarrisonOf(shrine))
  unit.remove(Targets('*'))
  for (const s of Array.from(ctx.world.query(Targets(unit)))) s.remove(Targets('*'))
  ctx.grid.remove(unit.id())
  ctx.inGrid[unit.id()] = false
}

export const leaveGarrison = (ctx: Ctx, unit: Entity) => {
  unit.remove(Garrisoned, GarrisonOf('*'))
  const p = unit.get(Position)!
  ctx.grid.add(unit.id(), unit.get(GameId)!.id, p.x, p.y)
  ctx.inGrid[unit.id()] = true
}
