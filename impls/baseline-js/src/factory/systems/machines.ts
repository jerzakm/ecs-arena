import type { Ctx } from '../context.ts'
import { flagsOf, markDirty } from '../entities.ts'
import type { Machine } from '../types.ts'

/**
 * SPEC-factory §5.7 `work`. `work.query` finds the Working machines: the normal code reads the set, the naive code scans every machine for
 * the tag. `work.step` runs the cycle of each of them: the normal code reads the fields of the machine object, the naive code looks the
 * machine up by gameId in a `Map` for every field access.
 */
export const work = (ctx: Ctx) => {
  const { k, nv } = ctx
  const finish = (m: Machine, r: { input: number; output: number }) => {
    if (r.input !== k.ITEM.NONE) m.input--
    if (r.output !== k.ITEM.NONE) m.output++
    if (m.kind === k.KIND.SINK) {
      ctx.totals.score = k.wrap32(ctx.totals.score, 1)
      ctx.add('sink.score')
    }
    markDirty(ctx, m)
  }
  const direct = (list: Machine[]) => {
    for (let i = 0; i < list.length; i++) {
      const m = list[i]
      const r = k.RECIPES[m.kind]
      m.progress += 1000 + m.boost
      if (m.progress < r.cycle * 1000) continue
      m.progress -= r.cycle * 1000
      finish(m, r)
    }
  }
  const byId = (list: Machine[]) => {
    const at = (id: number) => ctx.machineById.get(id)!
    for (let i = 0; i < list.length; i++) {
      const id = list[i].gameId
      const r = k.RECIPES[at(id).kind]
      at(id).progress = at(id).progress + 1000 + at(id).boost
      if (at(id).progress < r.cycle * 1000) continue
      at(id).progress = at(id).progress - r.cycle * 1000
      finish(at(id), r)
    }
  }
  const scan = (): Machine[] => {
    const found: Machine[] = []
    const all = ctx.machines
    for (let i = 0; i < all.length; i++) if (all[i].working) found.push(all[i])
    return found
  }
  const step = nv['work.step'] ? byId : direct
  return () => {
    // Counted before the step, because a cycle that ends can put a machine back to rest.
    if (ctx.counters) countWork(ctx)
    ctx.begin('work.query')
    const list = nv['work.query'] ? scan() : ctx.work
    ctx.end('work.query')
    ctx.begin('work.step')
    step(list)
    ctx.end('work.step')
  }
}

const countWork = (ctx: Ctx) => {
  let manualOnly = 0
  let boosted = 0
  for (const m of ctx.work) {
    if (m.manual && !ctx.up[m.district]) manualOnly++
    if (m.boost > 0) boosted++
  }
  ctx.add('work.machine', ctx.work.length)
  ctx.add('work.manualOnly', manualOnly)
  ctx.add('work.boost', boosted)
}

/** The `Working` rule of SPEC-factory §3.1. */
const shouldWork = (ctx: Ctx, m: Machine): boolean => {
  const r = ctx.k.RECIPES[m.kind]
  return (m.powered || m.manual) && (r.input === ctx.k.ITEM.NONE || m.input >= 1) && (r.output === ctx.k.ITEM.NONE || m.output < ctx.k.CAP)
}

/** The normal code keeps the set dense with a swap-pop through `workIdx`. The naive code makes a new array for each tag change. */
const setWorking = (ctx: Ctx, m: Machine, on: boolean) => {
  m.working = on
  if (ctx.nv['work.tag']) {
    ctx.work = on ? [...ctx.work, m] : ctx.work.filter((x) => x !== m)
    return
  }
  if (on) {
    m.workIdx = ctx.work.length
    ctx.work.push(m)
    return
  }
  const last = ctx.work.pop()!
  if (last !== m) {
    ctx.work[m.workIdx] = last
    last.workIdx = m.workIdx
  }
  m.workIdx = -1
}

/** Puts the machine on the changed list when a field differs from the end of the last tick (SPEC-factory §8). */
const note = (ctx: Ctx, m: Machine) => {
  if (m.seenAt === ctx.tick) return
  m.seenAt = ctx.tick
  const flags = flagsOf(ctx.k, m)
  if (m.input === m.pInput && m.output === m.pOutput && m.progress === m.pProgress && flags === m.pFlags) return
  m.pInput = m.input; m.pOutput = m.output; m.pProgress = m.progress; m.pFlags = flags
  ctx.changed.push(m)
}

/**
 * SPEC-factory §5.7 `state`, with the change tracking of §8. The normal code looks at the machines that changed: the Working set,
 * and the machines that `work`, `dock` and `power` listed as dirty. The naive code looks at every machine.
 */
export const state = (ctx: Ctx) => {
  const { nv } = ctx
  // A machine whose Working tag has to flip waits in this list until every check is done, so that `work.tag` times only the tag changes.
  const flips: Machine[] = []
  const recheck = (m: Machine) => {
    if (shouldWork(ctx, m) !== m.working) flips.push(m)
  }
  const applyFlips = () => {
    ctx.begin('work.tag')
    for (let i = 0; i < flips.length; i++) setWorking(ctx, flips[i], !flips[i].working)
    ctx.end('work.tag')
    ctx.add('work.flip', flips.length)
    flips.length = 0
  }
  // A machine that changed a field is in the Working set or in the dirty list, and a worker that left the set was dirty.
  const viaDirty = (): number => {
    const { dirty } = ctx
    for (let i = 0; i < dirty.length; i++) recheck(dirty[i])
    applyFlips()
    const { work } = ctx
    for (let i = 0; i < work.length; i++) note(ctx, work[i])
    for (let i = 0; i < dirty.length; i++) note(ctx, dirty[i])
    return dirty.length
  }
  const viaScan = (): number => {
    const all = ctx.machines
    for (let i = 0; i < all.length; i++) recheck(all[i])
    applyFlips()
    for (let i = 0; i < all.length; i++) note(ctx, all[i])
    return all.length
  }
  const run = nv['state.changed'] ? viaScan : viaDirty
  return () => {
    ctx.changed.length = 0
    ctx.begin('state.changed')
    const rechecked = run()
    ctx.end('state.changed')
    ctx.add('state.recheck', rechecked)
    ctx.dirty.length = 0
  }
}
