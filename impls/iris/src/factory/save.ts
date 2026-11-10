// SPEC-factory §10, emulated as in the other games: iris 0.0.14 has no snapshot or serialize API. Queries list the entities, a
// `Parent` lookup reads each crate link as a gameId, and `resetWorld` empties the world before `load` creates the entities again.
import {
  EXPERIMENTAL_queryColumns as queryColumns, getComponentValue, getRelationTargets, getResource, resetWorld, addResource,
} from 'iris-ecs'
import type { factory } from '@ecs-arena/spec'
import { runAs } from '../shared/driver.ts'
import { GameId } from '../shared/components.ts'
import { Parent, Totals } from './components.ts'
import type { Ctx } from './context.ts'
import { makeCrate, makeDrone, makeMachine } from './entities.ts'
import { crateRows, droneRows, machines } from './queries.ts'
import { STATE, takeTouched } from './systems/machines.ts'
import { flagsOf } from './systems/machines.ts'

interface SavedDrone {
  gameId: number; x: number; y: number; c: number; s: number; vx: number; vy: number; ax: number; ay: number
  born: number; goal: number; cargo: number; item: number; source: number; sink: number; top: number
}
interface SavedCrate { gameId: number; parent: number; item: number; depth: number; x: number; y: number; c: number; s: number }
interface Saved {
  tick: number; totals: factory.kernel.Totals; up: boolean[]
  input: Int32Array; output: Int32Array; progress: Int32Array; flags: Uint8Array
  drones: SavedDrone[]; crates: SavedCrate[]
}

export const save = (ctx: Ctx): Saved => {
  const { world, k } = ctx
  const n = ctx.machineCount
  const input = new Int32Array(n), output = new Int32Array(n), progress = new Int32Array(n), flags = new Uint8Array(n)
  queryColumns(world, machines, (entities, [id, m]) => {
    for (let i = 0; i < entities.length; i++) {
      const at = id.id[i] - 1
      input[at] = m.input[i]; output[at] = m.output[i]; progress[at] = m.progress[i]
    }
    const f = flagsOf(ctx, entities[0]) // the tags are the same for the whole archetype
    for (let i = 0; i < entities.length; i++) flags[id.id[i] - 1] = f
  })
  const drones: SavedDrone[] = []
  queryColumns(world, droneRows, (entities, [d, id, t, v, a]) => {
    for (let i = 0; i < entities.length; i++) {
      drones.push({
        gameId: id.id[i], x: t.x[i], y: t.y[i], c: t.c[i], s: t.s[i], vx: v.x[i], vy: v.y[i], ax: a.x[i], ay: a.y[i], born: d.born[i],
        goal: d.goal[i], cargo: d.cargo[i], item: d.item[i], source: d.source[i], sink: d.sink[i], top: d.top[i],
      })
    }
  })
  const crates: SavedCrate[] = []
  queryColumns(world, crateRows, (entities, [c, id, t]) => {
    const parent = getComponentValue(world, getRelationTargets(world, entities[0], Parent)[0]!, GameId, 'id')!
    for (let i = 0; i < entities.length; i++) {
      crates.push({ gameId: id.id[i], parent, item: c.item[i], depth: c.depth[i], x: t.x[i], y: t.y[i], c: t.c[i], s: t.s[i] })
    }
  })
  void k
  return { tick: ctx.tick, totals: { ...getResource(world, Totals)! }, up: [...ctx.up], input, output, progress, flags, drones, crates }
}

export const load = (ctx: Ctx, saved: Saved): void => {
  const { world, k } = ctx
  resetWorld(world)
  ctx.tick = saved.tick
  addResource(world, Totals, saved.totals)
  ctx.up = [...saved.up]
  ctx.entityOf.clear()
  ctx.machines.length = 0
  for (const list of ctx.districts) list.length = 0
  for (let id = 1; id <= ctx.machineCount; id++) {
    const at = id - 1, f = saved.flags[at]
    makeMachine(ctx, id, {
      input: saved.input[at], output: saved.output[at], progress: saved.progress[at],
      powered: (f & k.FLAG.POWERED) !== 0, working: (f & k.FLAG.WORKING) !== 0,
    })
    ctx.seen[at * 4] = saved.input[at]; ctx.seen[at * 4 + 1] = saved.output[at]; ctx.seen[at * 4 + 2] = saved.progress[at]
    ctx.seen[at * 4 + 3] = f
  }
  // A parent has a lower gameId than its crates, so one pass in gameId order creates every parent first.
  const rows = [...saved.drones.map((d) => ({ id: d.gameId, drone: d })), ...saved.crates.map((c) => ({ id: c.gameId, crate: c }))]
  rows.sort((a, b) => a.id - b.id)
  for (const r of rows) {
    if ('drone' in r) makeDrone(ctx, r.drone)
    else makeCrate(ctx, r.crate.gameId, r.crate.item, r.crate.depth, ctx.entityOf.get(r.crate.parent)!, r.crate)
  }
  // No change state from the discarded ticks reaches a later tick: the windows of `state` start empty, and so does the list.
  ctx.stamp.fill(0)
  ctx.worked.length = 0
  ctx.changed.length = 0
  runAs(world, STATE, () => void takeTouched(ctx))
}
