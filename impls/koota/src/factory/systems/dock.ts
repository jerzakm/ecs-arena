import type { Entity } from 'koota'
import type { Ctx } from '../context.ts'
import { Cargo, ChildOf, Crate, GameId, Io, Mission, Pose, Sink, Slot, Source, Top, Totals } from '../traits.ts'
import { byGameId } from '../../shared/util.ts'

/**
 * SPEC-factory §5.6. One query finds the drones in reach of their goal. Only those are sorted by gameId, because each sees the machine
 * values that the drones before it wrote. A crate is a child of the drone's top, and the Top relation moves with each pick up and drop.
 */
export const dock = (ctx: Ctx) => {
  const { k, world, q } = ctx
  const reach = k.DOCK * k.DOCK
  return () => {
    const totals = world.get(Totals)!
    const near: { gameId: number; e: Entity }[] = []
    world.query(q.docking).readEach(([g, p, mi], e) => {
      const at = e.targetFor(mi.goal === 0 ? Source : Sink)!.get(Slot)!
      if (k.distSq(p.x, p.y, at.x, at.y) <= reach) near.push({ gameId: g.id, e })
    })
    near.sort(byGameId)

    for (const { e } of near) {
      const mi = e.get(Mission)!
      let { cargo, goal } = mi
      if (goal === 0) {
        const source = e.targetFor(Source)!
        const io = source.get(Io)!
        const n = Math.min(k.MAX_CARGO - cargo, io.output)
        if (n > 0) {
          source.set(Io, { output: io.output - n })
          totals.picked = k.wrap32(totals.picked, n)
          let top: Entity = e.targetFor(Top) ?? e
          for (let j = 0; j < n; j++) top = world.spawn(GameId({ id: totals.nextId++ }), Crate, Cargo({ item: mi.item }), Pose, ChildOf(top))
          e.add(Top(top))
          cargo += n
        }
        if (cargo > 0) goal = 1
      } else {
        const sink = e.targetFor(Sink)!
        const io = sink.get(Io)!
        const n = Math.min(cargo, k.CAP - io.input)
        if (n > 0) {
          sink.set(Io, { input: io.input + n })
          totals.delivered = k.wrap32(totals.delivered, n)
          for (let j = 0; j < n; j++) {
            const top = e.targetFor(Top)!
            const below = top.targetFor(ChildOf)!
            e.remove(Top(top))
            top.destroy()
            if (below !== e) e.add(Top(below))
          }
          cargo -= n
        }
        if (cargo === 0) goal = 0
      }
      e.set(Mission, { cargo, goal })
    }
  }
}
