import type { Ctx } from '../context.ts'
import { makeMachine, markDirty } from '../entities.ts'

/** SPEC-factory §5.1. Every district starts with power, and `state` gives each machine its Working tag at the end of tick 0. */
export const build = (ctx: Ctx) => () => {
  if (ctx.world.tick !== 0) return
  const total = ctx.k.machineCount(ctx.scenario)
  for (let id = 1; id <= total; id++) markDirty(ctx, makeMachine(ctx, id))
  ctx.totals.nextId = total + 1
  ctx.up = ctx.districts.map(() => true)
}
