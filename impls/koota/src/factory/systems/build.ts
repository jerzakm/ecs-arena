import type { Ctx } from '../context.ts'
import { makeMachine } from '../entities.ts'
import { Totals } from '../traits.ts'

/** SPEC-factory §5.1. `state` gives each machine its Working tag at the end of tick 0. */
export const build = (ctx: Ctx) => () => {
  const { k, scenario, world, machines } = ctx
  const totals = world.get(Totals)!
  if (totals.tick + 1 !== 0) return
  const total = k.machineCount(scenario)
  for (let id = 1; id <= total; id++) machines.push(makeMachine(ctx, id))
  totals.nextId = total + 1
}
