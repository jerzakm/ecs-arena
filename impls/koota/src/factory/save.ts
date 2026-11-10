// SPEC-factory §10. koota 0.6.6 has no snapshot API, so the save is emulated: queries list the entities and read their traits.
// Links in the save name a gameId. Machines are never created or destroyed after tick 0, so a load writes their values back in place,
// and it destroys and respawns the drones and crates (the restore of the world trait and the tags is in `load`).
import { Not, type Entity, type Trait } from 'koota'
import type { factory } from '@ecs-arena/spec'
import { drainTrackers, type Ctx } from './context.ts'
import {
  Boost, Cargo, ChildOf, Crate, Drone, GameId, Io, Lit, Machine, Manual, Mission, Motion, Pose, Powered, Prev, Sink, Source, Top, Totals, Working,
} from './traits.ts'
import { byGameId } from "../shared/util.ts"
import { destroyAll } from '../shared/workarounds.ts'

interface SavedDrone { gameId: number; pose: number[]; motion: number[]; mission: number[]; source: number; sink: number; top: number }
interface SavedCrate { gameId: number; parent: number; item: number; pose: number[] }
export interface Saved {
  totals: factory.kernel.Totals
  lit: boolean[]
  machines: { input: Int32Array; output: Int32Array; progress: Int32Array; flags: Uint8Array } // by gameId - 1
  drones: SavedDrone[]
  crates: SavedCrate[]
}

const link = (e: Entity, relation: typeof Top): number => e.targetFor(relation)?.get(GameId)!.id ?? -1

export const save = (ctx: Ctx): Saved => {
  const { k, world, districts } = ctx
  const n = ctx.machines.length
  const machines = { input: new Int32Array(n), output: new Int32Array(n), progress: new Int32Array(n), flags: new Uint8Array(n) }
  world.query(Machine, GameId, Io).readEach(([g, io]) => {
    machines.input[g.id - 1] = io.input; machines.output[g.id - 1] = io.output; machines.progress[g.id - 1] = io.progress
  })
  const mark = (tag: Trait, bit: number) => world.query(Machine, GameId, tag).readEach(([g]) => void (machines.flags[g.id - 1] |= bit))
  mark(Working, k.FLAG.WORKING); mark(Powered, k.FLAG.POWERED); mark(Manual, k.FLAG.MANUAL); mark(Boost, k.FLAG.BOOST)

  const drones: SavedDrone[] = []
  world.query(Drone, GameId, Pose, Motion, Mission).readEach(([g, p, m, mi], e) => {
    drones.push({
      gameId: g.id, pose: [p.x, p.y, p.c, p.s], motion: [m.vx, m.vy, m.ax, m.ay], mission: [mi.born, mi.goal, mi.cargo, mi.item],
      source: link(e, Source), sink: link(e, Sink), top: link(e, Top),
    })
  })
  const crates: SavedCrate[] = []
  world.query(Crate, GameId, Cargo, Pose).readEach(([g, c, p], e) => {
    crates.push({ gameId: g.id, parent: link(e, ChildOf), item: c.item, pose: [p.x, p.y, p.c, p.s] })
  })
  return {
    totals: { ...world.get(Totals)! }, lit: districts.map((d) => d.has(Lit)), machines,
    drones: drones.sort(byGameId), crates: crates.sort(byGameId),
  }
}

/** Makes the machines that have `tag` the ones whose saved flags have `bit`. */
const syncTag = (ctx: Ctx, tag: Trait, bit: number, flags: Uint8Array): void => {
  const { world } = ctx
  const drop: Entity[] = [], gain: Entity[] = []
  world.query(Machine, GameId, tag).readEach(([g], e) => void (flags[g.id - 1] & bit || drop.push(e)))
  world.query(Machine, GameId, Not(tag)).readEach(([g], e) => void (flags[g.id - 1] & bit && gain.push(e)))
  for (const e of drop) e.remove(tag)
  for (const e of gain) e.add(tag)
}

/** Writes the saved state into the same world. Nothing of the discarded ticks stays: the trackers are read once to drop their events. */
export const load = (ctx: Ctx, saved: Saved): void => {
  const { k, world, machines, districts } = ctx
  const { FLAG } = k
  Object.assign(world.get(Totals)!, saved.totals)
  districts.forEach((d, i) => {
    if (saved.lit[i] !== d.has(Lit)) { if (saved.lit[i]) d.add(Lit); else d.remove(Lit) }
  })

  const cols = saved.machines
  world.query(Machine, GameId, Io, Prev).updateEach(([g, io, p]) => {
    const i = g.id - 1
    io.input = p.input = cols.input[i]; io.output = p.output = cols.output[i]; io.progress = p.progress = cols.progress[i]
    p.flags = cols.flags[i]
  })
  syncTag(ctx, Working, FLAG.WORKING, cols.flags)
  syncTag(ctx, Powered, FLAG.POWERED, cols.flags)

  destroyAll(world, Drone)
  destroyAll(world, Crate)
  const byId = new Map<number, Entity>()
  for (const s of saved.drones) {
    const e = world.spawn(
      GameId({ id: s.gameId }), Drone, Pose({ x: s.pose[0], y: s.pose[1], c: s.pose[2], s: s.pose[3] }),
      Motion({ vx: s.motion[0], vy: s.motion[1], ax: s.motion[2], ay: s.motion[3] }),
      Mission({ born: s.mission[0], goal: s.mission[1], cargo: s.mission[2], item: s.mission[3] }),
      Source(machines[s.source - 1]), Sink(machines[s.sink - 1]),
    )
    byId.set(s.gameId, e)
  }
  for (const s of saved.crates) { // a parent has a smaller gameId than its child
    byId.set(s.gameId, world.spawn(
      GameId({ id: s.gameId }), Crate, Cargo({ item: s.item }), Pose({ x: s.pose[0], y: s.pose[1], c: s.pose[2], s: s.pose[3] }),
      ChildOf(byId.get(s.parent)!),
    ))
  }
  for (const s of saved.drones) if (s.top !== -1) byId.get(s.gameId)!.add(Top(byId.get(s.top)!))

  drainTrackers(ctx)
}
