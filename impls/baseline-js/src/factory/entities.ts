// Creating and destroying machines, drones and crates. A destroyed drone or crate is marked dead and leaves its list at the
// next `compact`. The naive `churn` region rebuilds the list after each create and destroy.
import type { FactoryKernel } from '@ecs-arena/spec'
import type { CtxData } from './context.ts'
import type { Crate, Drone, Machine } from './types.ts'

export const makeMachine = (ctx: CtxData, gameId: number): Machine => {
  const { k, scenario } = ctx
  const [x, y] = k.slotPos(scenario, gameId)
  const m: Machine = {
    gameId, kind: k.kindOf(scenario, gameId), district: Math.floor((gameId - 1) / scenario.machinesPerDistrict), x, y,
    input: 0, output: 0, progress: 0, boost: k.boostOf(scenario.seed, gameId),
    manual: k.manualOf(scenario, gameId), powered: false, working: false,
    workIdx: -1, dirtyAt: -1, seenAt: -1, pInput: -1, pOutput: -1, pProgress: -1, pFlags: -1,
  }
  m.powered = !m.manual
  m.output = k.startOutput(m.kind)
  ctx.machines.push(m)
  if (ctx.nv['work.step']) ctx.machineById.set(gameId, m)
  ctx.districts[m.district].push(m)
  return m
}

/** SPEC-factory §5.3. A new drone sits at the depot of `d` and flies the route that the kernel draws for it. */
export const newDrone = (ctx: CtxData, tick: number, d: number): Drone => {
  const { k, scenario } = ctx
  const gameId = ctx.totals.nextId++
  const [source, sink] = k.route(scenario, tick, gameId, d).map((id) => ctx.machines[id - 1])
  const [x, y] = k.depotPos(scenario, d)
  return {
    gameId, x, y, c: k.FX, s: 0, vx: 0, vy: 0, ax: 0, ay: 0, born: tick, goal: 0, cargo: 0, item: k.RECIPES[source.kind].output,
    source, sink, top: null, dead: false,
  }
}

export interface Churn {
  /** A drone with no crates joins the world. */
  addDrone(d: Drone): void
  /** The drone picks up one crate, which becomes its `top`. */
  addCrate(drone: Drone): void
  /** The drone delivers its `top` crate. */
  dropCrate(drone: Drone): void
  /** The first `r` drones retire with all their crates. Returns the number of crates that left with them. */
  retire(r: number): number
  /** Takes the dead out of the lists. A system calls it when it is done with its loops. */
  compact(): void
}

const alive = (e: { dead: boolean }) => !e.dead

export const createChurn = (ctx: CtxData): Churn => {
  const { nv, begin, end } = ctx
  const attach = (drone: Drone): Crate => {
    const crate: Crate = {
      gameId: ctx.totals.nextId++, drone, below: drone.top, item: drone.item, x: 0, y: 0, c: 0, s: 0, dead: false,
    }
    drone.top = crate
    drone.cargo++
    return crate
  }
  const detach = (drone: Drone): void => {
    const crate = drone.top!
    crate.dead = true
    drone.top = crate.below
    drone.cargo--
  }
  const killChain = (drone: Drone): number => {
    let n = 0
    for (let c = drone.top; c; c = c.below) { c.dead = true; n++ }
    return n
  }
  const retired = (r: number): Drone[] => {
    const gone = ctx.drones.slice(0, r)
    for (const d of gone) { d.dead = true; ctx.droneById.delete(d.gameId) }
    return gone
  }
  let dirty = false

  const later: Churn = {
    addDrone: (d) => {
      begin('churn')
      ctx.drones.push(d)
      ctx.droneById.set(d.gameId, d)
      end('churn')
    },
    addCrate: (drone) => {
      begin('churn')
      ctx.crates.push(attach(drone))
      end('churn')
    },
    dropCrate: (drone) => {
      begin('churn')
      detach(drone)
      dirty = true
      end('churn')
    },
    retire: (r) => {
      begin('churn')
      const gone = retired(r)
      let crates = 0
      for (const d of gone) crates += killChain(d)
      ctx.drones = ctx.drones.slice(r)
      ctx.crates = ctx.crates.filter(alive)
      end('churn')
      return crates
    },
    compact: () => {
      if (!dirty) return
      begin('churn')
      ctx.crates = ctx.crates.filter(alive)
      dirty = false
      end('churn')
    },
  }
  const now: Churn = {
    addDrone: (d) => {
      begin('churn')
      ctx.drones = [...ctx.drones, d]
      ctx.droneById.set(d.gameId, d)
      end('churn')
    },
    addCrate: (drone) => {
      begin('churn')
      ctx.crates = [...ctx.crates, attach(drone)]
      end('churn')
    },
    dropCrate: (drone) => {
      begin('churn')
      detach(drone)
      ctx.crates = ctx.crates.filter(alive)
      end('churn')
    },
    retire: (r) => {
      let crates = 0
      for (const d of retired(r)) {
        begin('churn')
        crates += killChain(d)
        ctx.drones = ctx.drones.filter(alive)
        ctx.crates = ctx.crates.filter(alive)
        end('churn')
      }
      return crates
    },
    compact: () => {},
  }
  return nv.churn ? now : later
}

/** Lists a machine for the `state` phase once per tick (SPEC-factory §5.7). */
export const markDirty = (ctx: CtxData, m: Machine): void => {
  if (m.dirtyAt === ctx.tick) return
  m.dirtyAt = ctx.tick
  ctx.dirty.push(m)
}

/** The `flags` value of a machine in the snapshot (SPEC-factory §8). */
export const flagsOf = (k: FactoryKernel, m: Machine): number =>
  (m.working ? k.FLAG.WORKING : 0) | (m.powered ? k.FLAG.POWERED : 0) | (m.manual ? k.FLAG.MANUAL : 0) | (m.boost > 0 ? k.FLAG.BOOST : 0)
