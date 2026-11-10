import type { Ctx } from '../context.ts'
import { makeDrone } from '../entities.ts'
import { Drone, GameId, Mission, Totals } from '../traits.ts'
import { sortedByGameId } from '../../shared/util.ts'

/** SPEC-factory §5.3. Destroying a drone destroys its crates through the ChildOf relation. */
export const shift = (ctx: Ctx) => {
  const { k, scenario, world } = ctx
  const districts = k.districtCount(scenario)
  return () => {
    const totals = world.get(Totals)!
    const tick = totals.tick + 1
    if (tick === 0) {
      for (let d = 0; d < districts; d++) for (let i = 0; i < scenario.dronesPerDistrict; i++) makeDrone(ctx, 0, d)
      return
    }
    if (tick % scenario.shiftEvery !== 0) return
    const drones = sortedByGameId(world, GameId, Drone)
    const r = k.fx.div(drones.length * scenario.shiftPermille, 1000)
    let lost = 0
    for (let i = 0; i < r; i++) {
      lost += drones[i].e.get(Mission)!.cargo
      drones[i].e.destroy()
    }
    totals.lost = k.wrap32(totals.lost, lost)
    // A drone takes the gameId that its district draw uses, so the draw reads the counter before the drone is made.
    for (let i = 0; i < r; i++) makeDrone(ctx, tick, k.depotOf(scenario.seed, tick, totals.nextId, districts))
  }
}
