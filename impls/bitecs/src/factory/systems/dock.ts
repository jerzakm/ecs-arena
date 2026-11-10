import { query } from 'bitecs'
import { byGameId } from '../../shared/util.ts'
import { Crate, Drone, Machine, Transform } from '../components.ts'
import type { Ctx } from '../context.ts'
import { destroy, flush, markDirty, pickCrate } from '../entities.ts'
import { Q } from '../queries.ts'

/**
 * SPEC-factory §5.6. Drones go in ascending gameId order, and each sees the machine values that the drones before it wrote.
 * Reach depends only on positions, which this phase does not write, so only the drones in reach are sorted.
 */
export const dock = (ctx: Ctx) => {
  const { k, world, totals } = ctx
  const reach = k.DOCK * k.DOCK
  return () => {
    const docked: number[] = []
    for (const d of query(world, Q.drones)) {
      const m = Drone.goal[d] === 0 ? Drone.source[d] : Drone.sink[d]
      if (k.distSq(Transform.x[d], Transform.y[d], Machine.x[m], Machine.y[m]) <= reach) docked.push(d)
    }
    docked.sort(byGameId)
    for (const d of docked) {
      if (Drone.goal[d] === 0) {
        const m = Drone.source[d]
        const n = Math.min(k.MAX_CARGO - Drone.cargo[d], Machine.output[m])
        if (n > 0) {
          Machine.output[m] -= n
          totals.picked = k.wrap32(totals.picked, n)
          for (let j = 0; j < n; j++) pickCrate(ctx, d)
          markDirty(ctx, m)
        }
        if (Drone.cargo[d] > 0) Drone.goal[d] = 1
      } else {
        const m = Drone.sink[d]
        const n = Math.min(Drone.cargo[d], k.CAP - Machine.input[m])
        if (n > 0) {
          Machine.input[m] += n
          totals.delivered = k.wrap32(totals.delivered, n)
          for (let j = 0; j < n; j++) {
            const top = Drone.top[d]
            Drone.cargo[d]--
            Drone.top[d] = Drone.cargo[d] > 0 ? Crate.parent[top] : -1
            destroy(ctx, top)
          }
          markDirty(ctx, m)
        }
        if (Drone.cargo[d] === 0) Drone.goal[d] = 0
      }
    }
    flush(ctx)
  }
}
