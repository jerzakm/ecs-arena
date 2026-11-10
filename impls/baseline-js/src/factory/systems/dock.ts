import type { Ctx } from '../context.ts'
import { markDirty } from '../entities.ts'

const DELIVERED = ['', 'deliver.ore', 'deliver.plate', 'deliver.gear'] as const

/** SPEC-factory §5.6. Drones go in ascending gameId order, and each sees the machine values that the drones before it wrote. */
export const dock = (ctx: Ctx) => {
  const { k, churn, totals } = ctx
  const reach = k.DOCK * k.DOCK
  return () => {
    const drones = ctx.drones
    for (let i = 0; i < drones.length; i++) {
      const d = drones[i]
      const m = d.goal === 0 ? d.source : d.sink
      if (k.distSq(d.x, d.y, m.x, m.y) > reach) continue
      if (d.goal === 0) {
        const n = Math.min(k.MAX_CARGO - d.cargo, m.output)
        if (n > 0) {
          m.output -= n
          totals.picked = k.wrap32(totals.picked, n)
          for (let j = 0; j < n; j++) churn.addCrate(d)
          markDirty(ctx, m)
          ctx.add('churn.create', n)
        }
        if (d.cargo > 0) d.goal = 1
      } else {
        const n = Math.min(d.cargo, k.CAP - m.input)
        if (n > 0) {
          m.input += n
          totals.delivered = k.wrap32(totals.delivered, n)
          for (let j = 0; j < n; j++) churn.dropCrate(d)
          markDirty(ctx, m)
          ctx.add('churn.destroy', n)
          ctx.add(DELIVERED[d.item], n)
        }
        if (d.cargo === 0) d.goal = 0
      }
    }
    churn.compact()
  }
}
