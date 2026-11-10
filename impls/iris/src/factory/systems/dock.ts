import {
  EXPERIMENTAL_queryColumns as queryColumns, type EntityId, getComponentValue, getResourceValue, setComponentValue, setResourceValue,
} from 'iris-ecs'
import { GameId } from '../../shared/components.ts'
import { byGameId } from '../../shared/util.ts'
import { Crate, Drone, Machine, Place, Totals } from '../components.ts'
import type { Ctx } from '../context.ts'
import { dropTop, makeCrate, nextId } from '../entities.ts'
import { fliers } from '../queries.ts'

/** SPEC-factory §5.6. Drones go in ascending gameId order, and each sees the machine values that the drones before it wrote. */
export const dock = (ctx: Ctx) => {
  const { k, world, machines, entityOf } = ctx
  const reach = k.DOCK * k.DOCK
  const total = (name: 'picked' | 'delivered', n: number) => setResourceValue(world, Totals, name, k.wrap32(getResourceValue(world, Totals, name)!, n))
  return () => {
    // Most drones are out of reach. Only those in reach are sorted and handled.
    const due: { id: number; e: EntityId }[] = []
    queryColumns(world, fliers, (entities, [drone, pos]) => {
      for (let i = 0; i < entities.length; i++) {
        const m = machines[(drone.goal[i] === 0 ? drone.source[i] : drone.sink[i]) - 1]
        const mx = getComponentValue(world, m, Place, 'x')!, my = getComponentValue(world, m, Place, 'y')!
        if (k.distSq(pos.x[i], pos.y[i], mx, my) <= reach) due.push({ id: 0, e: entities[i] })
      }
    })
    for (const d of due) d.id = getComponentValue(world, d.e, GameId, 'id')!
    due.sort(byGameId)
    for (const { e } of due) {
      const goal = getComponentValue(world, e, Drone, 'goal')!
      let cargo = getComponentValue(world, e, Drone, 'cargo')!
      if (goal === 0) {
        const m = machines[getComponentValue(world, e, Drone, 'source')! - 1]
        const n = Math.min(k.MAX_CARGO - cargo, getComponentValue(world, m, Machine, 'output')!)
        if (n > 0) {
          setComponentValue(world, m, Machine, 'output', getComponentValue(world, m, Machine, 'output')! - n)
          total('picked', n)
          const item = getComponentValue(world, e, Drone, 'item')!
          let top = getComponentValue(world, e, Drone, 'top')!
          for (let j = 0; j < n; j++) {
            const below = top === -1 ? e : entityOf.get(top)!
            const depth = top === -1 ? 1 : getComponentValue(world, below, Crate, 'depth')! + 1
            top = nextId(ctx)
            makeCrate(ctx, top, item, depth, below)
          }
          setComponentValue(world, e, Drone, 'top', top)
          cargo += n
          setComponentValue(world, e, Drone, 'cargo', cargo)
        }
        if (cargo > 0) setComponentValue(world, e, Drone, 'goal', 1)
      } else {
        const m = machines[getComponentValue(world, e, Drone, 'sink')! - 1]
        const input = getComponentValue(world, m, Machine, 'input')!
        const n = Math.min(cargo, k.CAP - input)
        if (n > 0) {
          setComponentValue(world, m, Machine, 'input', input + n)
          total('delivered', n)
          let top = getComponentValue(world, e, Drone, 'top')!
          for (let j = 0; j < n; j++) top = dropTop(ctx, entityOf.get(top)!)
          setComponentValue(world, e, Drone, 'top', top)
          cargo -= n
          setComponentValue(world, e, Drone, 'cargo', cargo)
        }
        if (cargo === 0) setComponentValue(world, e, Drone, 'goal', 0)
      }
    }
  }
}
