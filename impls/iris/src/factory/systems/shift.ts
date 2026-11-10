import { destroyEntity, getComponentValue, getResourceValue, setResourceValue } from 'iris-ecs'
import { sortedByGameId } from '../../shared/util.ts'
import { Drone, Totals } from '../components.ts'
import type { Ctx } from '../context.ts'
import { spawnDrone } from '../entities.ts'

/** SPEC-factory §5.3. */
export const shift = (ctx: Ctx) => () => {
  const { k, scenario, world, tick } = ctx
  const districts = ctx.districts.length
  if (tick === 0) {
    for (let d = 0; d < districts; d++) for (let i = 0; i < scenario.dronesPerDistrict; i++) spawnDrone(ctx, 0, d)
    return
  }
  if (tick % scenario.shiftEvery !== 0) return
  const all = sortedByGameId(world, Drone)
  const r = k.fx.div(all.length * scenario.shiftPermille, 1000)
  let lost = 0
  for (const { e } of all.slice(0, r)) {
    lost += getComponentValue(world, e, Drone, 'cargo')!
    destroyEntity(world, e) // the crates go with the drone
  }
  setResourceValue(world, Totals, 'lost', k.wrap32(getResourceValue(world, Totals, 'lost')!, lost))
  // A drone takes the gameId that its district draw uses, so the draw reads the counter before the drone is made.
  for (let i = 0; i < r; i++) {
    spawnDrone(ctx, tick, k.depotOf(scenario.seed, tick, getResourceValue(world, Totals, 'nextId')!, districts))
  }
}
