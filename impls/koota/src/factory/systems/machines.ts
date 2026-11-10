import type { Entity } from 'koota'
import type { Ctx } from '../context.ts'
import { Boost, GameId, Io, Kind, Manual, Powered, Prev, Totals, Working } from '../traits.ts'
import { FLAG_CHANGED } from '../../shared/workarounds.ts'

/** SPEC-factory §5.7 `work`. Two queries over the Working tag split the machines that have a Boost from the ones that lack it. */
export const work = (ctx: Ctx) => {
  const { k, world, q } = ctx
  const { RECIPES, KIND } = k
  return () => {
    let score = 0
    const step = (io: { input: number; output: number; progress: number }, kind: number, boost: number) => {
      const r = RECIPES[kind]
      io.progress += 1000 + boost
      if (io.progress < r.cycle * 1000) return
      io.progress -= r.cycle * 1000
      if (r.input !== 0) io.input--
      if (r.output !== 0) io.output++
      if (kind === KIND.SINK) score++
    }
    world.query(q.boosted).updateEach(([io, kind, boost]) => step(io, kind.value, boost.value), FLAG_CHANGED)
    world.query(q.plain).updateEach(([io, kind]) => step(io, kind.value, 0), FLAG_CHANGED)
    const totals = world.get(Totals)!
    totals.score = k.wrap32(totals.score, score)
  }
}

/**
 * SPEC-factory §5.7 `state`, with the change tracking of §8. The trackers name the machines whose Io changed, and the machines that
 * gained or lost Powered. `Or(Powered, Manual)` splits the machines of a changed Io into the ones that can work and the ones that cannot.
 * Tags change after the queries have been read. A machine is on the changed list when a value differs from `Prev`.
 */
export const state = (ctx: Ctx) => {
  const { k, world, q } = ctx
  const { RECIPES, CAP } = k
  const ready = (io: { input: number; output: number }, kind: number): boolean => {
    const r = RECIPES[kind]
    return (r.input === 0 || io.input >= 1) && (r.output === 0 || io.output < CAP)
  }
  return () => {
    const want = new Map<Entity, boolean>()
    if (world.get(Totals)!.tick + 1 === 0) {
      world.query(q.machines).readEach(([io, kind], e) => void want.set(e, (e.has(Powered) || e.has(Manual)) && ready(io, kind.value)))
    }
    world.query(q.ioAble).readEach(([io, kind], e) => void want.set(e, ready(io, kind.value)))
    world.query(q.gained).readEach(([io, kind], e) => void want.set(e, ready(io, kind.value)))
    world.query(q.ioUnable).readEach((_, e) => void want.set(e, false))
    world.query(q.lost).readEach((_, e) => void want.set(e, false))

    const changed = ctx.changed
    changed.length = 0
    for (const [e, on] of want) {
      if (on !== e.has(Working)) {
        if (on) e.add(Working)
        else e.remove(Working)
      }
      const io = e.get(Io)!
      const flags = (e.has(Working) ? k.FLAG.WORKING : 0) | (e.has(Powered) ? k.FLAG.POWERED : 0) |
        (e.has(Manual) ? k.FLAG.MANUAL : 0) | (e.has(Boost) ? k.FLAG.BOOST : 0)
      const p = e.get(Prev)!
      if (io.input === p.input && io.output === p.output && io.progress === p.progress && flags === p.flags) continue
      e.set(Prev, { input: io.input, output: io.output, progress: io.progress, flags })
      changed.push({
        gameId: e.get(GameId)!.id, kind: e.get(Kind)!.value, input: io.input, output: io.output, progress: io.progress, flags,
      })
    }
  }
}
