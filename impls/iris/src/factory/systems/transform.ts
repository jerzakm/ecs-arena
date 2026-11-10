import { EXPERIMENTAL_queryColumns as queryColumns, getComponentValue, getRelationTargets, setResourceValue } from 'iris-ecs'
import { Parent, Totals, Transform } from '../components.ts'
import type { Ctx } from '../context.ts'
import { crates } from '../queries.ts'

const MAX_DEPTH = 3

/**
 * SPEC-factory §5.8. The crates that share a parent share an archetype, so one pair lookup gives the parent of the whole archetype.
 * One pass for each depth keeps a parent before its children.
 */
export const transform = (ctx: Ctx) => {
  const { k, world } = ctx
  const { lx, ly, lc, ls } = k.CRATE_LOCAL
  return () => {
    for (let depth = 1; depth <= MAX_DEPTH; depth++) {
      queryColumns(world, crates, (entities, [crate, t]) => {
        if (crate.depth[0] !== depth) return
        const p = getRelationTargets(world, entities[0], Parent)[0]!
        const px = getComponentValue(world, p, Transform, 'x')!, py = getComponentValue(world, p, Transform, 'y')!
        const pc = getComponentValue(world, p, Transform, 'c')!, ps = getComponentValue(world, p, Transform, 's')!
        const w = k.compose(px, py, pc, ps, lx, ly, lc, ls)
        for (let i = 0; i < entities.length; i++) {
          t.x[i] = w[0]; t.y[i] = w[1]; t.c[i] = w[2]; t.s[i] = w[3]
        }
      })
    }
    setResourceValue(world, Totals, 'tick', ctx.tick++)
  }
}
