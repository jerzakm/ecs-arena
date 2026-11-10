import { setResourceValue } from 'iris-ecs'
import type { Ctx } from '../context.ts'
import { Totals } from '../components.ts'
import { makeMachine } from '../entities.ts'

/** SPEC-factory §5.1. Every district starts with power, and `state` gives each machine its Working tag at the end of tick 0. */
export const build = (ctx: Ctx) => () => {
  if (ctx.tick !== 0) return
  const { k, scenario, world } = ctx
  for (let id = 1; id <= ctx.machineCount; id++) {
    makeMachine(ctx, id, { input: 0, output: k.startOutput(k.kindOf(scenario, id)), progress: 0, powered: true, working: false })
  }
  setResourceValue(world, Totals, 'nextId', ctx.machineCount + 1)
  ctx.up = ctx.districts.map(() => true)
}
