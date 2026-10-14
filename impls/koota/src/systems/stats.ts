import type { Entity } from 'koota'
import type { Context } from '../context.ts'
import { Bannered, Chronicle, Kind, Metrics, Unit, Veteran } from '../components.ts'
import { recomputeStats } from '../derived-stats.ts'
import { ChildOf, MemberOf } from '../relations.ts'

export const statsSystem = (ctx: Context) => {
  const { k, world, q, dirty } = ctx

  return () => {
    const candidates: Entity[] = []
    world.query(q.killsChanged).readEach(([c], e) => { if (c.value >= k.VETERAN_KILLS) candidates.push(e) })
    for (const e of candidates) e.add(Veteran)
    for (const e of world.query(q.newlyVeteran)) e.add(Chronicle({ kinds: [k.PROMOTION_MARK] }))

    // Banner: the root of the MemberOf and ChildOf chain is a warlord and the unit is not the root. The memo holds "root is a warlord".
    const rootIsWarlord = new Map<Entity, boolean>()
    const rootWarlord = (e: Entity): boolean => {
      let r = rootIsWarlord.get(e)
      if (r === undefined) {
        const p = e.targetFor(MemberOf) ?? e.targetFor(ChildOf)
        rootIsWarlord.set(e, r = p ? rootWarlord(p) : e.get(Kind)!.value === k.KIND.WARLORD)
      }
      return r
    }
    const gain: Entity[] = [], lose: Entity[] = []
    for (const e of world.query(Unit)) {
      const p = e.targetFor(MemberOf) ?? e.targetFor(ChildOf)
      const banner = !!p && rootWarlord(p)
      if (banner !== e.has(Bannered)) (banner ? gain : lose).push(e)
    }
    for (const e of gain) e.add(Bannered)
    for (const e of lose) e.remove(Bannered)

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
