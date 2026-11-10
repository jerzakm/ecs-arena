import { addComponent, hasComponent, removeComponent } from 'bitecs'
import { Manual, Powered } from '../components.ts'
import type { Ctx } from '../context.ts'
import { markDirty } from '../entities.ts'

/** SPEC-factory §5.2. A machine with Manual never has Powered, so a toggle skips it. */
export const power = (ctx: Ctx) => {
  const { k, scenario, world, districts } = ctx
  return () => {
    const tick = world.tick
    if (tick === 0 || tick % scenario.powerEvery !== 0) return
    for (let d = 0; d < districts.length; d++) {
      const down = k.districtDown(scenario.seed, tick, d, scenario.outagePermille)
      if (down !== ctx.up[d]) continue
      ctx.up[d] = !down
      for (const m of districts[d]) {
        if (hasComponent(world, m, Manual)) continue
        if (down) removeComponent(world, m, Powered)
        else addComponent(world, m, Powered)
        markDirty(ctx, m)
      }
    }
  }
}
