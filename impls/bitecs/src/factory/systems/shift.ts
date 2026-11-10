import { Drone } from '../components.ts'
import type { Ctx } from '../context.ts'
import { destroyDrone, flush, makeDrone } from '../entities.ts'
import { Q } from '../queries.ts'
import { sortedByGameId } from '../../shared/util.ts'

/** SPEC-factory §5.3. */
export const shift = (ctx: Ctx) => {
  const { k, scenario, world, totals } = ctx
  const districts = k.districtCount(scenario)
  return () => {
    const tick = world.tick
    if (tick === 0) {
      for (let d = 0; d < districts; d++) for (let i = 0; i < scenario.dronesPerDistrict; i++) makeDrone(ctx, totals.nextId++, 0, d)
      return
    }
    if (tick % scenario.shiftEvery !== 0) return
    const drones = sortedByGameId(ctx, Q.drones)
    const r = k.fx.div(drones.length * scenario.shiftPermille, 1000)
    for (let i = 0; i < r; i++) {
      totals.lost = k.wrap32(totals.lost, Drone.cargo[drones[i]])
      destroyDrone(ctx, drones[i])
    }
    flush(ctx)
    // A drone takes the gameId that its district draw uses, so the draw reads the counter before the drone is made.
    for (let i = 0; i < r; i++) makeDrone(ctx, totals.nextId, tick, k.depotOf(scenario.seed, tick, totals.nextId++, districts))
  }
}
