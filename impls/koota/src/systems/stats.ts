import type { Entity } from 'koota'
import type { Context } from '../context.ts'
import { Chronicle, Metrics, Veteran } from '../components.ts'
import { recomputeStats } from '../derived-stats.ts'

export const statsSystem = (ctx: Context) => {
  const { k, world, q, dirty } = ctx

  return () => {
    const candidates: Entity[] = []
    world.query(q.killsChanged).readEach(([c], e) => { if (c.value >= k.VETERAN_KILLS) candidates.push(e) })
    for (const e of candidates) e.add(Veteran)
    for (const e of world.query(q.newlyVeteran)) e.add(Chronicle({ kinds: [k.PROMOTION_MARK] }))

    for (const e of dirty) if (e.isAlive()) recomputeStats(ctx, e)
    dirty.clear()

    const alive = [0, 0]
    world.query(q.teamQuery).readEach(([t]) => { alive[t.value]++ })
    const tick = ctx.tickNow()
    world.set(Metrics, (m) => {
      let winner = m.winner
      if (tick > 0 && winner === -1) {
        if (alive[0] === 0 && alive[1] > 0) winner = 1
        else if (alive[1] === 0 && alive[0] > 0) winner = 0
      }
      return { alive0: alive[0], alive1: alive[1], winner }
    })
  }
}
