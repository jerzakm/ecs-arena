import type { Context } from '../context.ts'
import { recomputeStats, scanItemMask } from '../derived-stats.ts'
import { sampleEntities } from '../profiling.ts'
import { flagsOf } from '../snapshot.ts'
import type { Unit } from '../types.ts'

export const statsSystem = (ctx: Context) => {
  const { k, add, begin, end, dirty, world, parentOf, parentById, depthOf } = ctx
  const naive = ctx.isNaive('stats.recompute'), naiveSet = ctx.isNaive('stats.setBonus'), naiveBanner = ctx.isNaive('stats.banner'), naiveRender = ctx.isNaive('stats.render')
  let buf = new Int32Array(0)

  const refresh = (u: Unit) => {
    if (u.killCount >= k.VETERAN_KILLS && !u.veteran) {
      u.veteran = true
      ctx.veterans.add(u)
      u.chronicle = [k.PROMOTION_MARK]
      add('tag.add.veteran')
    }
    recomputeStats(ctx, u)
  }

  return () => {
    const { units, counters } = ctx
    // Banner: a parent has a lower gameId than its children, so one pass in array order sees the parent's new value.
    begin('stats.banner')
    for (let u_i = 0, u = units[0]; u_i < units.length; u = units[++u_i]) {
      let banner: boolean
      if (naiveBanner) {
        let root = u
        for (let p = parentById(root); p; p = parentById(root)) root = p
        banner = root !== u && root.kind === k.KIND.WARLORD
      } else {
        const p = parentOf(u)
        banner = !!p && (p.kind === k.KIND.WARLORD || p.bannered)
      }
      if (banner !== u.bannered) { u.bannered = banner; dirty.add(u); add('tag.change.bannered') }
    }
    end('stats.banner')
    begin('stats.setBonus')
    if (naiveSet) for (let u_i = 0, u = units[0]; u_i < units.length; u = units[++u_i]) u.itemMask = scanItemMask(u)
    end('stats.setBonus')
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
    // SPEC §6.15: the render buffer is one flat int32 array. Folding it into renderChain is what keeps the extraction in the hash.
    begin('stats.render')
    const size = 1 + k.RENDER_STRIDE * units.length
    if (buf.length < size) buf = new Int32Array(Math.max(size, 2 * buf.length))
    buf[0] = units.length
    let at = 1
    if (naiveRender) {
      const rows = units.map((u) => ({ ...u })) // one object for each unit, like a copy of the entity that a renderer would take
      for (let r_i = 0, r = rows[0]; r_i < rows.length; r = rows[++r_i]) { buf[at++] = r.gameId; buf[at++] = r.kind; buf[at++] = r.team; buf[at++] = r.x; buf[at++] = r.y; buf[at++] = k.fx.div(r.hp * 255, r.maxHp); buf[at++] = flagsOf(r); buf[at++] = r.trail.length >> 1; buf[at++] = r.trail[0] ?? 0; buf[at++] = r.trail[1] ?? 0 }
    } else {
      for (let u_i = 0, u = units[0]; u_i < units.length; u = units[++u_i]) {
        buf[at++] = u.gameId; buf[at++] = u.kind; buf[at++] = u.team; buf[at++] = u.x; buf[at++] = u.y; buf[at++] = k.fx.div(u.hp * 255, u.maxHp); buf[at++] = flagsOf(u); buf[at++] = u.trail.length >> 1; buf[at++] = u.trail[0] ?? 0; buf[at++] = u.trail[1] ?? 0
      }
    }
    end('stats.render') // the fold is the kernel's hash of the buffer, not extraction work
    const chain = k.foldRender(world.renderChain, buf, size)
    if (chain !== world.renderChain) add('rule.renderChain')
    world.renderChain = chain
    world.tick = ctx.tick
    ctx.tick++
  }
}
