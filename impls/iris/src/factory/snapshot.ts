import { EXPERIMENTAL_queryColumns as queryColumns, getComponentValue, getRelationTargets, getResource } from 'iris-ecs'
import type { CanonicalState } from '@ecs-arena/spec'
import { GameId } from '../shared/components.ts'
import { Parent, Totals } from './components.ts'
import type { Ctx } from './context.ts'
import { crateRows, droneRows, working } from './queries.ts'

const count = (ctx: Ctx, terms: typeof working): number => {
  let n = 0
  queryColumns(ctx.world, terms, (entities) => void (n += entities.length))
  return n
}

/** SPEC-factory §8. A query has no order, so the drones and the crates are sorted by gameId here. */
export const snapshot = (ctx: Ctx): CanonicalState => {
  const { k, world, seen, scenario } = ctx
  const drones: number[][] = []
  queryColumns(world, droneRows, (entities, [drone, id, t, vel]) => {
    for (let i = 0; i < entities.length; i++) {
      drones.push([
        id.id[i], t.x[i], t.y[i], vel.x[i], vel.y[i], t.c[i], t.s[i], drone.born[i], drone.goal[i], drone.cargo[i], drone.item[i],
        drone.source[i], drone.sink[i], drone.top[i],
      ])
    }
  })
  drones.sort((a, b) => a[0] - b[0])
  const crates: number[][] = []
  queryColumns(world, crateRows, (entities, [crate, id, t]) => {
    const parent = getComponentValue(world, getRelationTargets(world, entities[0], Parent)[0]!, GameId, 'id')!
    for (let i = 0; i < entities.length; i++) crates.push([id.id[i], parent, crate.item[i], t.x[i], t.y[i], t.c[i], t.s[i]])
  })
  crates.sort((a, b) => a[0] - b[0])

  const s: number[] = k.worldHeader(getResource(world, Totals)!, {
    powered: ctx.up.filter(Boolean).length, working: count(ctx, working), drones: drones.length, crates: crates.length,
  })
  const ids = ctx.changed.sort((a, b) => a - b)
  s.push(ids.length)
  for (const id of ids) {
    const at = (id - 1) * 4
    s.push(id, k.kindOf(scenario, id), seen[at], seen[at + 1], seen[at + 2], seen[at + 3])
  }
  for (const d of drones) s.push(...d)
  for (const c of crates) s.push(...c)
  return s
}
