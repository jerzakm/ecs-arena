import type { Context } from '../context.ts'
import { recomputeStats } from '../derived-stats.ts'
import { sampleEntities } from '../profiling.ts'

export const statsSystem = (ctx: Context) => {
  const { k, add, dirty, unitById, world, parentOf, depthOf } = ctx

  return () => {
    const { units, counters } = ctx
    for (let u_i = 0, u = units[0]; u_i < units.length; u = units[++u_i]) {
      if (u.killCount >= k.VETERAN_KILLS && !u.veteran) {
        u.veteran = true
        u.chronicle = [k.PROMOTION_MARK]
        dirty?.add(u.gameId)
        add('tag.add.veteran')
      }
      recomputeStats(ctx, u)
    }
    if (counters && dirty) {
      let needed = 0
      for (const id of dirty) if (unitById.has(id)) needed++
      dirty.clear()
      add('stats.needed', needed)
      add('stats.full', units.length)
      sampleEntities(ctx)
      let maxDepth = 0
      const children = new Map<number, number>()
      for (let u_i = 0, u = units[0]; u_i < units.length; u = units[++u_i]) {
        const p = parentOf(u)
        if (p) children.set(p.gameId, (children.get(p.gameId) ?? 0) + 1)
        maxDepth = Math.max(maxDepth, depthOf(u))
      }
      counters.set('hier.depth', maxDepth)
      counters.set('hier.maxChildren', Math.max(0, ...children.values()))
    }
    world.alive = [0, 0]
    for (let u_i = 0, u = units[0]; u_i < units.length; u = units[++u_i]) world.alive[u.team]++
    if (ctx.tick > 0 && world.winner === -1) {
      if (world.alive[0] === 0 && world.alive[1] > 0) world.winner = 1
      else if (world.alive[1] === 0 && world.alive[0] > 0) world.winner = 0
    }
    world.tick = ctx.tick
    ctx.tick++
  }
}
