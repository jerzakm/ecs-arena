import {
  addComponent, collectEntities, EXPERIMENTAL_queryColumns as queryColumns, type EntityId, getComponentValue, getResourceValue,
  hasComponent, markComponentChanged, removeComponent, setResourceValue,
} from 'iris-ecs'
import { GameId } from '../../shared/components.ts'
import { Boost, Machine, Manual, Powered, Totals, Working } from '../components.ts'
import type { Ctx } from '../context.ts'
import { mayStart, mayStop, stayIdle, workingBoosted, workingPlain } from '../queries.ts'

/** SPEC-factory §5.7 `work`. The queries are the Working set, so an idle machine costs nothing. */
export const work = (ctx: Ctx) => {
  const { k, world } = ctx
  const cycles = k.RECIPES.map((r) => r.cycle * 1000)
  const hasInput = k.RECIPES.map((r) => r.input !== k.ITEM.NONE)
  const hasOutput = k.RECIPES.map((r) => r.output !== k.ITEM.NONE)
  let score = 0
  const step = (entities: readonly EntityId[], gid: { id: ArrayLike<number> }, m: Cols, boost: ArrayLike<number> | null) => {
    for (let i = 0; i < entities.length; i++) {
      ctx.worked.push(gid.id[i])
      const kind = m.kind[i]
      m.progress[i] += 1000 + (boost ? boost[i] : 0)
      if (m.progress[i] < cycles[kind]) continue
      m.progress[i] -= cycles[kind]
      if (hasInput[kind]) m.input[i]--
      if (hasOutput[kind]) m.output[i]++
      if (kind === k.KIND.SINK) score++
      markComponentChanged(world, entities[i], Machine) // a direct column write is not seen by `changed`
    }
  }
  return () => {
    score = 0
    ctx.worked.length = 0
    queryColumns(world, workingBoosted, (entities, [gid, m, boost]) => step(entities, gid, m, boost.value))
    queryColumns(world, workingPlain, (entities, [gid, m]) => step(entities, gid, m, null))
    if (score > 0) setResourceValue(world, Totals, 'score', k.wrap32(getResourceValue(world, Totals, 'score')!, score))
  }
}

type Cols = { kind: ArrayLike<number>; input: Writable; output: Writable; progress: Writable }
interface Writable { [i: number]: number }

/** The `Working` rule of SPEC-factory §3.1 for a machine that has power or is Manual. */
const stocked = (ctx: Ctx, e: EntityId): boolean => {
  const { world } = ctx
  const r = ctx.k.RECIPES[getComponentValue(world, e, Machine, 'kind')!]
  return (r.input === ctx.k.ITEM.NONE || getComponentValue(world, e, Machine, 'input')! >= 1)
    && (r.output === ctx.k.ITEM.NONE || getComponentValue(world, e, Machine, 'output')! < ctx.k.CAP)
}

export const flagsOf = (ctx: Ctx, e: EntityId): number => {
  const { world, k } = ctx
  return (hasComponent(world, e, Working) ? k.FLAG.WORKING : 0) | (hasComponent(world, e, Powered) ? k.FLAG.POWERED : 0)
    | (hasComponent(world, e, Manual) ? k.FLAG.MANUAL : 0) | (hasComponent(world, e, Boost) ? k.FLAG.BOOST : 0)
}

/** The machines that `changed` lists as touched since `state` last ran. Reading them consumes the window, so a load calls it to drop it. */
export const STATE = 'factory.state'

export const takeTouched = (ctx: Ctx) => {
  const { world } = ctx
  return { stop: collectEntities(world, mayStop), start: collectEntities(world, mayStart), idle: collectEntities(world, stayIdle) }
}

/**
 * SPEC-factory §5.7 `state`, with the change tracking of §8. A machine that changed a field or its power is listed by `changed`,
 * and a machine that `work` stepped is on `ctx.worked`. Only those are looked at. The changed list is built here, in every tick.
 */
export const state = (ctx: Ctx) => () => {
  const { world, seen, stamp } = ctx
  const { stop, start, idle } = takeTouched(ctx)
  for (const e of stop) {
    const on = (hasComponent(world, e, Powered) || hasComponent(world, e, Manual)) && stocked(ctx, e)
    if (!on) removeComponent(world, e, Working)
  }
  for (const e of start) if (stocked(ctx, e)) addComponent(world, e, Working)

  ctx.changed.length = 0
  const note = (id: number) => {
    if (stamp[id - 1] === ctx.tick + 1) return
    stamp[id - 1] = ctx.tick + 1
    const e = ctx.machines[id - 1]
    const at = (id - 1) * 4
    const input = getComponentValue(world, e, Machine, 'input')!, output = getComponentValue(world, e, Machine, 'output')!
    const progress = getComponentValue(world, e, Machine, 'progress')!, flags = flagsOf(ctx, e)
    if (input === seen[at] && output === seen[at + 1] && progress === seen[at + 2] && flags === seen[at + 3]) return
    seen[at] = input; seen[at + 1] = output; seen[at + 2] = progress; seen[at + 3] = flags
    ctx.changed.push(id)
  }
  for (const id of ctx.worked) note(id)
  for (const list of [stop, start, idle]) for (const e of list) note(getComponentValue(world, e, GameId, 'id')!)
}
