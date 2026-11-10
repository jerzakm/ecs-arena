// SPEC-factory §10. The save is a plain data tree. Links are gameIds, so nothing in it points into the live world.
// bitECS 0.4 has a snapshot serializer, but it writes native ids and cannot carry the link, so the save is emulated like the other games:
// the machines are copied as whole columns, and drones and crates are read through their queries.
// `load` keeps the machines, writes their columns back, and removes and spawns every drone and crate again.
import { addComponent, hasComponent, query, removeComponent } from 'bitecs'
import type { factory } from '@ecs-arena/spec'
import { GameId } from '../shared/components.ts'
import { sortedByGameId } from '../shared/util.ts'
import { Crate, Drone, Machine, Motion, Powered, Transform, Working } from './components.ts'
import type { Ctx } from './context.ts'
import { addCrate, destroy, flagsOf, flush, makeDrone } from './entities.ts'
import { Q } from './queries.ts'

interface Columns { input: Int32Array; output: Int32Array; progress: Int32Array; flags: Int32Array }
interface SavedDrone {
  gameId: number; x: number; y: number; vx: number; vy: number; ax: number; ay: number; c: number; s: number
  born: number; goal: number; cargo: number; item: number; source: number; sink: number
}
interface SavedCrate { gameId: number; parent: number; item: number; x: number; y: number; c: number; s: number }
export interface Saved {
  tick: number; totals: factory.kernel.Totals; machines: Columns; up: boolean[]; drones: SavedDrone[]; crates: SavedCrate[]
}

const readMachines = (ctx: Ctx): Columns => {
  const { machines } = ctx
  const n = machines.length
  const cols: Columns = { input: new Int32Array(n), output: new Int32Array(n), progress: new Int32Array(n), flags: new Int32Array(n) }
  for (let i = 0; i < n; i++) {
    const m = machines[i]
    cols.input[i] = Machine.input[m]; cols.output[i] = Machine.output[m]; cols.progress[i] = Machine.progress[m]
    cols.flags[i] = flagsOf(ctx, m)
  }
  return cols
}

export const save = (ctx: Ctx): Saved => {
  const { world } = ctx
  const gameIdOf = (e: number) => GameId.id[e]
  return {
    tick: world.tick, totals: { ...ctx.totals }, machines: readMachines(ctx), up: [...ctx.up],
    drones: sortedByGameId(ctx, Q.drones).map((d) => ({
      gameId: gameIdOf(d), x: Transform.x[d], y: Transform.y[d], vx: Motion.vx[d], vy: Motion.vy[d], ax: Motion.ax[d], ay: Motion.ay[d],
      c: Transform.c[d], s: Transform.s[d], born: Drone.born[d], goal: Drone.goal[d], cargo: Drone.cargo[d], item: Drone.item[d],
      source: gameIdOf(Drone.source[d]), sink: gameIdOf(Drone.sink[d]),
    })),
    crates: sortedByGameId(ctx, Q.crates).map((c) => ({
      gameId: gameIdOf(c), parent: gameIdOf(Crate.parent[c]), item: Crate.item[c],
      x: Transform.x[c], y: Transform.y[c], c: Transform.c[c], s: Transform.s[c],
    })),
  }
}

/** Replaces the live state in place. Nothing of the discarded ticks stays: the changed state restarts from the loaded values. */
export const load = (ctx: Ctx, d: Saved): void => {
  const { world, machines, k } = ctx
  for (const e of query(world, Q.crates)) destroy(ctx, e)
  for (const e of query(world, Q.drones)) destroy(ctx, e)
  flush(ctx)
  world.tick = d.tick
  Object.assign(ctx.totals, d.totals)
  ctx.up = [...d.up]
  ctx.dirty.length = 0; ctx.changed.length = 0
  const { input, output, progress, flags } = d.machines
  for (let i = 0; i < machines.length; i++) {
    const m = machines[i]
    Machine.input[m] = input[i]; Machine.output[m] = output[i]; Machine.progress[m] = progress[i]
    Machine.pInput[m] = input[i]; Machine.pOutput[m] = output[i]; Machine.pProgress[m] = progress[i]; Machine.pFlags[m] = flags[i]
    Machine.dirtyAt[m] = -1; Machine.seenAt[m] = -1
    setTag(ctx, m, Powered, (flags[i] & k.FLAG.POWERED) !== 0)
    setTag(ctx, m, Working, (flags[i] & k.FLAG.WORKING) !== 0)
  }
  const loaded = new Map<number, number>()
  const ownerOf = new Map<number, [drone: number, depth: number]>() // crate gameId -> its drone and its depth
  for (const s of d.drones) {
    const e = makeDrone(ctx, s.gameId, s.born, 0)
    loaded.set(s.gameId, e)
    Transform.x[e] = s.x; Transform.y[e] = s.y; Transform.c[e] = s.c; Transform.s[e] = s.s
    Motion.vx[e] = s.vx; Motion.vy[e] = s.vy; Motion.ax[e] = s.ax; Motion.ay[e] = s.ay
    Drone.goal[e] = s.goal; Drone.cargo[e] = s.cargo; Drone.item[e] = s.item
    Drone.source[e] = machines[s.source - 1]; Drone.sink[e] = machines[s.sink - 1]
  }
  // A parent has a smaller gameId than its child, so one pass in gameId order finds every parent loaded.
  for (const s of d.crates) {
    const parent = loaded.get(s.parent)!
    const [drone, above] = ownerOf.get(s.parent) ?? [parent, 0]
    const e = addCrate(ctx, s.gameId, drone, parent, above + 1)
    loaded.set(s.gameId, e)
    ownerOf.set(s.gameId, [drone, above + 1])
    Crate.item[e] = s.item
    Transform.x[e] = s.x; Transform.y[e] = s.y; Transform.c[e] = s.c; Transform.s[e] = s.s
  }
}

const setTag = (ctx: Ctx, e: number, tag: object, on: boolean): void => {
  if (hasComponent(ctx.world, e, tag) === on) return
  if (on) addComponent(ctx.world, e, tag)
  else removeComponent(ctx.world, e, tag)
}
