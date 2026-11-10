// SPEC-factory §10. The save is a plain data tree. Links are gameIds, so nothing in it points into the live world.
// Normal code copies the mutable machine fields as whole columns.
// The naive code (regions `save` and `load`) round trips the tree through JSON text.
import type { factory } from '@ecs-arena/spec'
import type { Ctx } from './context.ts'
import { flagsOf } from './entities.ts'
import type { Crate, Drone } from './types.ts'

interface Columns { input: ArrayLike<number>; output: ArrayLike<number>; progress: ArrayLike<number>; flags: ArrayLike<number> }
interface SavedDrone { gameId: number; x: number; y: number; vx: number; vy: number; ax: number; ay: number; c: number; s: number
  born: number; goal: number; cargo: number; item: number; source: number; sink: number; top: number }
interface SavedCrate { gameId: number; drone: number; below: number; item: number; x: number; y: number; c: number; s: number }
interface Saved {
  tick: number; totals: factory.kernel.Totals; machines: Columns; up: boolean[]; drones: SavedDrone[]; crates: SavedCrate[]
}

const readMachines = (ctx: Ctx): Columns => {
  const { machines, k } = ctx
  const input = new Int32Array(machines.length), output = new Int32Array(machines.length), progress = new Int32Array(machines.length)
  const flags = new Uint8Array(machines.length)
  for (let i = 0; i < machines.length; i++) {
    const m = machines[i]
    input[i] = m.input; output[i] = m.output; progress[i] = m.progress; flags[i] = flagsOf(k, m)
  }
  return { input, output, progress, flags }
}

const readTree = (ctx: Ctx): Saved => ({
  tick: ctx.tick, totals: { ...ctx.totals }, machines: readMachines(ctx), up: [...ctx.up],
  drones: ctx.drones.map((d) => ({ ...d, source: d.source.gameId, sink: d.sink.gameId, top: d.top ? d.top.gameId : -1, dead: undefined })),
  crates: ctx.crates.map((c) => ({
    gameId: c.gameId, drone: c.drone.gameId, below: c.below ? c.below.gameId : -1, item: c.item, x: c.x, y: c.y, c: c.c, s: c.s,
  })),
})

/** Typed columns do not survive JSON.stringify, so the text form holds plain arrays. */
const plain = (d: Saved): Saved => ({
  ...d, machines: { input: Array.from(d.machines.input), output: Array.from(d.machines.output),
    progress: Array.from(d.machines.progress), flags: Array.from(d.machines.flags) },
})

/** Replaces the live state in place. Nothing of the discarded ticks stays: the changed state restarts from the loaded values. */
const writeTree = (ctx: Ctx, d: Saved) => {
  const { k, machines } = ctx
  const { FLAG } = k
  ctx.tick = d.tick
  Object.assign(ctx.totals, d.totals)
  ctx.up = [...d.up]
  ctx.work.length = 0; ctx.dirty.length = 0; ctx.changed.length = 0
  const cols = d.machines
  for (let i = 0; i < machines.length; i++) {
    const m = machines[i]
    const f = cols.flags[i]
    m.input = cols.input[i]; m.output = cols.output[i]; m.progress = cols.progress[i]
    m.powered = (f & FLAG.POWERED) !== 0
    m.working = (f & FLAG.WORKING) !== 0
    m.pInput = m.input; m.pOutput = m.output; m.pProgress = m.progress; m.pFlags = f
    m.dirtyAt = -1; m.seenAt = -1
    if (m.working) { m.workIdx = ctx.work.length; ctx.work.push(m) } else m.workIdx = -1
  }
  const drones = new Map<number, Drone>()
  ctx.droneById = drones
  ctx.drones = d.drones.map((s) => {
    const drone: Drone = { ...s, source: machines[s.source - 1], sink: machines[s.sink - 1], top: null, dead: false }
    drones.set(drone.gameId, drone)
    return drone
  })
  const crates = new Map<number, Crate>()
  ctx.crates = d.crates.map((s) => {
    const drone = drones.get(s.drone)!
    const below = s.below === -1 ? null : crates.get(s.below)!
    const crate: Crate = { gameId: s.gameId, drone, below, item: s.item, x: s.x, y: s.y, c: s.c, s: s.s, dead: false }
    crates.set(crate.gameId, crate)
    if (!drone.top || drone.top.gameId < crate.gameId) drone.top = crate
    return crate
  })
}

/** Builds `save`. The naive region `save` turns the tree into JSON text, and the normal code keeps the tree. */
export const createSave = (ctx: Ctx) => {
  const encode = ctx.nv.save ? (data: Saved): unknown => JSON.stringify(plain(data)) : (data: Saved): unknown => data
  return (): unknown => {
    ctx.begin('save')
    const state = encode(readTree(ctx))
    ctx.end('save')
    ctx.add('save.count')
    return state
  }
}

export const createLoad = (ctx: Ctx) => {
  // The form of the save decides, so a naive save loads in either mode. The naive load only adds the round trip when the save is a tree.
  const reparse = ctx.nv.load ? (state: Saved): Saved => JSON.parse(JSON.stringify(plain(state))) : (state: Saved): Saved => state
  return (state: unknown): void => {
    ctx.begin('load')
    writeTree(ctx, typeof state === 'string' ? JSON.parse(state) : reparse(state as Saved))
    ctx.end('load')
    ctx.add('load.count')
  }
}
