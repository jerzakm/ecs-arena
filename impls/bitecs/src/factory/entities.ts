// Creating machines, drones and crates, and destroying drones and crates. Each `make*` takes its gameId from the caller.
import { addComponent, addComponents, addEntity, entityExists, hasComponent, removeEntity } from 'bitecs'
import { GameId } from '../shared/components.ts'
import { Boost, CAP, Crate, DEPTH_TAGS, Drone, Machine, Manual, Motion, Powered, Transform, Working } from './components.ts'
import type { Ctx } from './context.ts'

export const newEntity = (ctx: Ctx): number => {
  const e = addEntity(ctx.world)
  if (e >= CAP) throw new Error(`entity id ${e} is over the store capacity ${CAP}`)
  return e
}

/** SPEC-factory §3.1 and §5.1. A machine that is not `Manual` starts with `Powered`. */
export const makeMachine = (ctx: Ctx, gameId: number): number => {
  const { k, scenario, world } = ctx
  const e = newEntity(ctx)
  addComponents(world, e, [Machine, GameId])
  const [x, y] = k.slotPos(scenario, gameId)
  const kind = k.kindOf(scenario, gameId)
  GameId.id[e] = gameId
  Machine.kind[e] = kind; Machine.district[e] = Math.floor((gameId - 1) / scenario.machinesPerDistrict)
  Machine.x[e] = x; Machine.y[e] = y
  Machine.input[e] = 0; Machine.output[e] = k.startOutput(kind); Machine.progress[e] = 0
  Machine.dirtyAt[e] = -1; Machine.seenAt[e] = -1
  Machine.pInput[e] = Machine.pOutput[e] = Machine.pProgress[e] = Machine.pFlags[e] = -1
  const boost = k.boostOf(scenario.seed, gameId)
  if (boost > 0) { addComponent(world, e, Boost); Boost.value[e] = boost }
  addComponent(world, e, k.manualOf(scenario, gameId) ? Manual : Powered)
  ctx.machines.push(e)
  ctx.districts[Machine.district[e]].push(e)
  return e
}

/** Lists a machine for the `state` phase once per tick (SPEC-factory §5.7). */
export const markDirty = (ctx: Ctx, m: number): void => {
  if (Machine.dirtyAt[m] === ctx.world.tick) return
  Machine.dirtyAt[m] = ctx.world.tick
  ctx.dirty.push(m)
}

/** The `flags` value of a machine in the snapshot (SPEC-factory §8). */
export const flagsOf = (ctx: Ctx, m: number): number => {
  const { world, k } = ctx
  return (hasComponent(world, m, Working) ? k.FLAG.WORKING : 0) | (hasComponent(world, m, Powered) ? k.FLAG.POWERED : 0) |
    (hasComponent(world, m, Manual) ? k.FLAG.MANUAL : 0) | (hasComponent(world, m, Boost) ? k.FLAG.BOOST : 0)
}

/** SPEC-factory §5.3. A drone with its two machines as `source` and `sink`, at the depot of district `d`, with no crates. */
export const makeDrone = (ctx: Ctx, gameId: number, tick: number, d: number): number => {
  const { k, scenario, world } = ctx
  const e = newEntity(ctx)
  addComponents(world, e, [Drone, GameId, Transform, Motion])
  const [source, sink] = k.route(scenario, tick, gameId, d)
  const [x, y] = k.depotPos(scenario, d)
  GameId.id[e] = gameId
  Transform.x[e] = x; Transform.y[e] = y; Transform.c[e] = k.FX; Transform.s[e] = 0
  Motion.vx[e] = Motion.vy[e] = Motion.ax[e] = Motion.ay[e] = 0
  Drone.born[e] = tick; Drone.goal[e] = 0; Drone.cargo[e] = 0; Drone.top[e] = -1
  Drone.source[e] = ctx.machines[source - 1]; Drone.sink[e] = ctx.machines[sink - 1]
  Drone.item[e] = k.RECIPES[Machine.kind[Drone.source[e]]].output
  return e
}

/** A crate with a known gameId and parent: the top crate of the drone, or the drone. It becomes the `top`. `load` uses it too. */
export const addCrate = (ctx: Ctx, gameId: number, drone: number, parent: number, depth: number): number => {
  const e = newEntity(ctx)
  addComponents(ctx.world, e, [Crate, GameId, Transform, DEPTH_TAGS[depth - 1]])
  GameId.id[e] = gameId
  Crate.item[e] = Drone.item[drone]; Crate.parent[e] = parent
  Transform.x[e] = Transform.y[e] = Transform.c[e] = Transform.s[e] = 0
  Drone.top[drone] = e
  return e
}

/** SPEC-factory §5.6 pick up: one crate on top of the chain. */
export const pickCrate = (ctx: Ctx, drone: number): number => {
  const top = Drone.top[drone]
  const e = addCrate(ctx, ctx.totals.nextId++, drone, top === -1 ? drone : top, Drone.cargo[drone] + 1)
  Drone.cargo[drone]++
  return e
}

/** The entity is removed by the next `flush`. */
/** Destroys a drone with its chain of crates, which are the `cargo` crates from the top down. */
export const destroyDrone = (ctx: Ctx, drone: number): void => {
  let crate = Drone.top[drone]
  for (let i = Drone.cargo[drone]; i > 0; i--, crate = Crate.parent[crate]) destroy(ctx, crate)
  destroy(ctx, drone)
}

export const destroy = (ctx: Ctx, e: number): void => void ctx.doomed.push(e)
export const flush = (ctx: Ctx): void => {
  const { doomed, world } = ctx
  for (let i = 0; i < doomed.length; i++) if (entityExists(world, doomed[i])) removeEntity(world, doomed[i])
  doomed.length = 0
}
