// Creating machines and drones. Each factory takes the next gameId where SPEC-factory §3 says so, and spawns every trait in one call.
import type { ConfigurableTrait, Entity } from 'koota'
import type { Ctx } from './context.ts'
import { Boost, Drone, GameId, InDistrict, Io, Kind, Machine, Manual, Mission, Motion, Pose, Powered, Prev, Sink, Slot, Source, Totals } from './traits.ts'

/** SPEC-factory §3.1. Every district starts with power, so a machine that is not Manual starts Powered. */
export const makeMachine = (ctx: Ctx, gameId: number): Entity => {
  const { k, scenario, world, districts } = ctx
  const kind = k.kindOf(scenario, gameId)
  const [x, y] = k.slotPos(scenario, gameId)
  const district = Math.floor((gameId - 1) / scenario.machinesPerDistrict)
  const traits: ConfigurableTrait[] = [
    GameId({ id: gameId }), Machine, Kind({ value: kind }), Slot({ x, y }), Io({ output: k.startOutput(kind) }), Prev,
    InDistrict(districts[district]), k.manualOf(scenario, gameId) ? Manual : Powered,
  ]
  const boost = k.boostOf(scenario.seed, gameId)
  if (boost > 0) traits.push(Boost({ value: boost }))
  return world.spawn(...traits)
}

/** SPEC-factory §5.3. A new drone sits at the depot of `d` and flies the route that the kernel draws for it. */
export const makeDrone = (ctx: Ctx, tick: number, d: number): Entity => {
  const { k, scenario, world, machines } = ctx
  const totals = world.get(Totals)!
  const gameId = totals.nextId++
  const [source, sink] = k.route(scenario, tick, gameId, d)
  const [x, y] = k.depotPos(scenario, d)
  const item = k.RECIPES[k.kindOf(scenario, source)].output
  return world.spawn(
    GameId({ id: gameId }), Drone, Pose({ x, y, c: k.FX, s: 0 }), Motion, Mission({ born: tick, goal: 0, cargo: 0, item }),
    Source(machines[source - 1]), Sink(machines[sink - 1]),
  )
}
