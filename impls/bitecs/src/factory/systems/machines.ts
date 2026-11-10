import { addComponent, hasComponent, query, removeComponent } from 'bitecs'
import { Boost, Machine, Manual, Powered, Working } from '../components.ts'
import type { Ctx } from '../context.ts'
import { flagsOf, markDirty } from '../entities.ts'
import { Q } from '../queries.ts'

/** SPEC-factory §5.7 `work`. Only the machines with Working are visited, and the optional boost splits them into two queries. */
export const work = (ctx: Ctx) => {
  const { k, world, totals } = ctx
  const step = (m: number, boost: number) => {
    const r = k.RECIPES[Machine.kind[m]]
    Machine.progress[m] += 1000 + boost
    if (Machine.progress[m] < r.cycle * 1000) return
    Machine.progress[m] -= r.cycle * 1000
    if (r.input !== k.ITEM.NONE) Machine.input[m]--
    if (r.output !== k.ITEM.NONE) Machine.output[m]++
    if (Machine.kind[m] === k.KIND.SINK) totals.score = k.wrap32(totals.score, 1)
    markDirty(ctx, m)
  }
  return () => {
    for (const m of query(world, Q.workBoost)) step(m, Boost.value[m])
    for (const m of query(world, Q.workPlain)) step(m, 0)
  }
}

/** The `Working` rule of SPEC-factory §3.1. */
const shouldWork = (ctx: Ctx, m: number): boolean => {
  const { k, world } = ctx
  const r = k.RECIPES[Machine.kind[m]]
  return (hasComponent(world, m, Powered) || hasComponent(world, m, Manual)) &&
    (r.input === k.ITEM.NONE || Machine.input[m] >= 1) && (r.output === k.ITEM.NONE || Machine.output[m] < k.CAP)
}

/** Puts the machine on the changed list when a field differs from the end of the last tick (SPEC-factory §8). */
const note = (ctx: Ctx, m: number) => {
  if (Machine.seenAt[m] === ctx.world.tick) return
  Machine.seenAt[m] = ctx.world.tick
  const flags = flagsOf(ctx, m)
  if (Machine.input[m] === Machine.pInput[m] && Machine.output[m] === Machine.pOutput[m] &&
    Machine.progress[m] === Machine.pProgress[m] && flags === Machine.pFlags[m]) return
  Machine.pInput[m] = Machine.input[m]; Machine.pOutput[m] = Machine.output[m]
  Machine.pProgress[m] = Machine.progress[m]; Machine.pFlags[m] = flags
  ctx.changed.push(m)
}

/**
 * SPEC-factory §5.7 `state`, with the change tracking of §8. It looks at the machines that `work`, `dock` and `power` listed as dirty,
 * and at the Working set. At tick 0 every machine is dirty, and only the machines in `live` can work.
 */
export const state = (ctx: Ctx) => {
  const { world, dirty } = ctx
  const recheck = (m: number) => {
    const on = shouldWork(ctx, m)
    if (on === hasComponent(world, m, Working)) return
    if (on) addComponent(world, m, Working)
    else removeComponent(world, m, Working)
  }
  return () => {
    ctx.changed.length = 0
    for (const m of world.tick === 0 ? query(world, Q.live) : dirty) recheck(m)
    for (const m of query(world, Q.working)) note(ctx, m)
    for (const m of dirty) note(ctx, m)
    dirty.length = 0
  }
}
