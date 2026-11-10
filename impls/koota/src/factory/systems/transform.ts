import type { Entity } from 'koota'
import type { Ctx } from '../context.ts'
import { ChildOf, Drone, Pose, Top, Totals } from '../traits.ts'

/**
 * SPEC-factory §5.8. For each drone with a chain, the pass lists the chain from the top crate down to the drone, then goes up from
 * the drone. A crate reads the Pose of its parent, which this pass has just written.
 */
export const transform = (ctx: Ctx) => {
  const { k, world } = ctx
  const { lx, ly, lc, ls } = k.CRATE_LOCAL
  return () => {
    const carriers: Entity[] = []
    world.query(Drone, Top('*')).readEach((_, e) => void carriers.push(e))
    for (const drone of carriers) {
      const chain: Entity[] = []
      for (let c = drone.targetFor(Top); c && c !== drone; c = c.targetFor(ChildOf)) chain.push(c)
      let parent = drone
      for (let i = chain.length - 1; i >= 0; i--) {
        const p = parent.get(Pose)!
        const [x, y, c, s] = k.compose(p.x, p.y, p.c, p.s, lx, ly, lc, ls)
        chain[i].set(Pose, { x, y, c, s })
        parent = chain[i]
      }
    }
    world.get(Totals)!.tick++
  }
}
