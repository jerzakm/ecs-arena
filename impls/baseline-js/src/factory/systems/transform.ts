import type { Ctx } from '../context.ts'
import type { Crate } from '../types.ts'

/**
 * SPEC-factory §5.8. The normal code reads the parent that this pass already wrote.
 * The naive code walks the chain from the drone for each crate.
 */
export const transform = (ctx: Ctx) => {
  const { k, nv } = ctx
  const { lx, ly, lc, ls } = k.CRATE_LOCAL
  const viaParent = () => {
    const crates = ctx.crates
    for (let i = 0; i < crates.length; i++) {
      const c = crates[i]
      const p = c.below ?? c.drone
      const w = k.compose(p.x, p.y, p.c, p.s, lx, ly, lc, ls)
      c.x = w[0]; c.y = w[1]; c.c = w[2]; c.s = w[3]
    }
  }
  const viaChain = () => {
    const crates = ctx.crates
    for (let i = 0; i < crates.length; i++) {
      const c = crates[i]
      const chain: Crate[] = []
      for (let n: Crate | null = c; n; n = n.below) chain.push(n)
      let w = k.compose(c.drone.x, c.drone.y, c.drone.c, c.drone.s, lx, ly, lc, ls)
      for (let j = chain.length - 2; j >= 0; j--) w = k.compose(w[0], w[1], w[2], w[3], lx, ly, lc, ls)
      c.x = w[0]; c.y = w[1]; c.c = w[2]; c.s = w[3]
    }
  }
  const run = nv.transform ? viaChain : viaParent
  return () => {
    ctx.begin('transform')
    run()
    ctx.end('transform')
    if (ctx.counters) {
      ctx.add('transform.crate', ctx.crates.length)
      ctx.add('transform.depth3', ctx.crates.filter((c) => c.below?.below).length)
    }
    ctx.totals.tick = ctx.tick++
  }
}
