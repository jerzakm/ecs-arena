// Creating machines, drones and crates. Each factory writes every component of the entity in one `createEntity` call.
import {
  type ComponentEntry, createEntity, destroyEntity, type EntityId, getComponentValue, getRelationTargets, getResourceValue, hasComponent,
  pair, setResourceValue,
} from 'iris-ecs'
import { GameId } from '../shared/components.ts'
import { Accel, Boost, Crate, Drone, Machine, Manual, Parent, Place, Powered, Totals, Transform, Velocity, Working } from './components.ts'
import type { Ctx } from './context.ts'

/** Takes the next gameId. */
export const nextId = (ctx: Ctx): number => {
  const id = getResourceValue(ctx.world, Totals, 'nextId')!
  setResourceValue(ctx.world, Totals, 'nextId', id + 1)
  return id
}

export interface MachineState { input: number; output: number; progress: number; powered: boolean; working: boolean }

/** SPEC-factory §3.1. The kernel gives the layout, and `state` gives the tag Working. */
export const makeMachine = (ctx: Ctx, gameId: number, s: MachineState): EntityId => {
  const { k, scenario } = ctx
  const [x, y] = k.slotPos(scenario, gameId)
  const district = Math.floor((gameId - 1) / scenario.machinesPerDistrict)
  const kind = k.kindOf(scenario, gameId)
  const boost = k.boostOf(scenario.seed, gameId)
  const entries: ComponentEntry[] = [
    [GameId, { id: gameId }], [Machine, { kind, district, input: s.input, output: s.output, progress: s.progress }], [Place, { x, y }],
  ]
  if (k.manualOf(scenario, gameId)) entries.push(Manual)
  else if (s.powered) entries.push(Powered)
  if (s.working) entries.push(Working)
  if (boost > 0) entries.push([Boost, { value: boost }])
  const e = createEntity(ctx.world, entries)
  ctx.machines[gameId - 1] = e
  ctx.districts[district].push(e)
  return e
}

export interface DroneState {
  gameId: number; x: number; y: number; c: number; s: number; vx: number; vy: number; ax: number; ay: number
  born: number; goal: number; cargo: number; item: number; source: number; sink: number; top: number
}

export const makeDrone = (ctx: Ctx, d: DroneState): EntityId =>
  createEntity(ctx.world, [
    [GameId, { id: d.gameId }],
    [Drone, { born: d.born, goal: d.goal, cargo: d.cargo, item: d.item, source: d.source, sink: d.sink, top: d.top }],
    [Transform, { x: d.x, y: d.y, c: d.c, s: d.s }], [Velocity, { x: d.vx, y: d.vy }], [Accel, { x: d.ax, y: d.ay }],
  ])

/** SPEC-factory §5.3. A new drone sits at the depot of `district` and flies the route that the kernel draws for it. */
export const spawnDrone = (ctx: Ctx, tick: number, district: number): EntityId => {
  const { k, scenario } = ctx
  const gameId = nextId(ctx)
  const [source, sink] = k.route(scenario, tick, gameId, district)
  const [x, y] = k.depotPos(scenario, district)
  return makeDrone(ctx, {
    gameId, x, y, c: k.FX, s: 0, vx: 0, vy: 0, ax: 0, ay: 0, born: tick, goal: 0, cargo: 0,
    item: k.RECIPES[k.kindOf(scenario, source)].output, source, sink, top: -1,
  })
}

/** A crate below `parent` (a drone or a crate). Its world transform is 0 until `transform`. */
export const makeCrate = (ctx: Ctx, gameId: number, item: number, depth: number, parent: EntityId, at = { x: 0, y: 0, c: 0, s: 0 }): EntityId =>
  createEntity(ctx.world, [[GameId, { id: gameId }], [Crate, { item, depth }], [Transform, at], pair(Parent, parent)])

/** Destroys the top crate. Returns the gameId of the new top, or -1 when the drone has none. */
export const dropTop = (ctx: Ctx, top: EntityId): number => {
  const parent = getRelationTargets(ctx.world, top, Parent)[0]!
  destroyEntity(ctx.world, top)
  return hasComponent(ctx.world, parent, Crate) ? getComponentValue(ctx.world, parent, GameId, 'id')! : -1
}
