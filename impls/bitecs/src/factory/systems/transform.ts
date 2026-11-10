import { query } from 'bitecs'
import { Crate, Transform } from '../components.ts'
import type { Ctx } from '../context.ts'
import { CRATE_DEPTHS } from '../queries.ts'

/** SPEC-factory §5.8. One depth at a time, so a crate reads the parent that this pass already wrote. */
export const transform = (ctx: Ctx) => {
  const { k, world } = ctx
  const { lx, ly, lc, ls } = k.CRATE_LOCAL
  return () => {
    for (const depth of CRATE_DEPTHS) for (const c of query(world, depth)) {
      const p = Crate.parent[c]
      const w = k.compose(Transform.x[p], Transform.y[p], Transform.c[p], Transform.s[p], lx, ly, lc, ls)
      Transform.x[c] = w[0]; Transform.y[c] = w[1]; Transform.c[c] = w[2]; Transform.s[c] = w[3]
    }
    ctx.totals.tick = world.tick++
  }
}
