import type { Context } from '../context.ts'
import { recomputeStats } from '../derived-stats.ts'
import { sampleEntities } from '../profiling.ts'
import type { Unit } from '../types.ts'

export const statsSystem = (ctx: Context) => {
  const { k, add, begin, end, dirty, world, parentOf, depthOf } = ctx
  const naive = ctx.isNaive('stats.recompute')

  const refresh = (u: Unit) => {
    if (u.killCount >= k.VETERAN_KILLS && !u.veteran) {
      u.veteran = true
      u.chronicle = [k.PROMOTION_MARK]
      add('tag.add.veteran')
    }
    recomputeStats(ctx, u)
  }

  return () => {
    const { units, counters } = ctx
    begin('stats.recompute')
    // New units are not dirty: spawn already computed them and only items, buffs and kills change them later.
    if (naive) for (let u_i = 0, u = units[0]; u_i < units.length; u = units[++u_i]) refresh(u)
    else for (const u of dirty) if (!u.destroyed) refresh(u)
    end('stats.recompute')
    if (counters) {
      let needed = 0
      for (const u of dirty) if (!u.destroyed) needed++
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
    dirty.clear()
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
