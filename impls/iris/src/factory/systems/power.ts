import { addComponent, hasComponent, markComponentChanged, removeComponent } from 'iris-ecs'
import { Machine, Manual, Powered } from '../components.ts'
import type { Ctx } from '../context.ts'

/** SPEC-factory §5.2. A Manual machine never has Powered, so a toggle skips it. A toggle marks the machine changed for `state`. */
export const power = (ctx: Ctx) => () => {
  const { k, scenario, world, tick } = ctx
  if (tick === 0 || tick % scenario.powerEvery !== 0) return
  for (let d = 0; d < ctx.districts.length; d++) {
    const down = k.districtDown(scenario.seed, tick, d, scenario.outagePermille)
    if (down !== ctx.up[d]) continue
    ctx.up[d] = !down
    const list = ctx.districts[d]
    for (let i = 0; i < list.length; i++) {
      const e = list[i]
      if (hasComponent(world, e, Manual)) continue
      if (down) removeComponent(world, e, Powered)
      else addComponent(world, e, Powered)
      markComponentChanged(world, e, Machine)
    }
  }
}
