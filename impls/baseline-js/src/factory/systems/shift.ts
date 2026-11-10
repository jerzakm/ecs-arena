import type { Ctx } from '../context.ts'
import { newDrone } from '../entities.ts'

/** SPEC-factory §5.3. */
export const shift = (ctx: Ctx) => {
  const { k, scenario, churn } = ctx
  const districts = k.districtCount(scenario)
  return () => {
    const { tick, totals } = ctx
    if (tick === 0) {
      for (let d = 0; d < districts; d++) for (let i = 0; i < scenario.dronesPerDistrict; i++) churn.addDrone(newDrone(ctx, 0, d))
      return
    }
    if (tick % scenario.shiftEvery !== 0) return
    const r = k.fx.div(ctx.drones.length * scenario.shiftPermille, 1000)
    totals.lost = k.wrap32(totals.lost, churn.retire(r))
    // A drone takes the gameId that its district draw uses, so the draw reads the counter before the drone is made.
    for (let i = 0; i < r; i++) churn.addDrone(newDrone(ctx, tick, k.depotOf(scenario.seed, tick, totals.nextId, districts)))
    ctx.add('shift.retire', r)
    ctx.add('shift.spawn', r)
  }
}
