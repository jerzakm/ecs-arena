import { addComponent, removeComponent } from 'bitecs'
import type { Context } from './context.ts'
import { GameId, Garrisoned, Position } from './components.ts'
import { clearLink, GarrisonOf, setLink, Targets } from './relations.ts'

// A garrisoned unit leaves the move and target queries through `Not(Garrisoned)`, and it leaves the kernel grid.
// The Targets links that point at it are cleared by the caller in one pass, because Targets has no reverse index (objectives.ts).
export const enterGarrison = (ctx: Context, unit: number, shrine: number) => {
  addComponent(ctx.world, unit, Garrisoned)
  setLink(unit, GarrisonOf, shrine)
  clearLink(unit, Targets)
  ctx.grid.remove(unit)
  ctx.inGrid[unit] = 0
}

export const leaveGarrison = (ctx: Context, unit: number) => {
  removeComponent(ctx.world, unit, Garrisoned)
  clearLink(unit, GarrisonOf)
  ctx.grid.add(unit, GameId.id[unit], Position.x[unit], Position.y[unit])
  ctx.inGrid[unit] = 1
}
