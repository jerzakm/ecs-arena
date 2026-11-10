import type { Ctx } from '../context.ts'
import { recomputeStats, scanItemMask } from '../derived-stats.ts'
import { parentById } from '../hierarchy.ts'
import { depthOf, sampleEntities } from '../profiling.ts'
import { flagsOf } from '../snapshot.ts'
import type { Unit } from '../types.ts'

/** Writes one row of the render buffer (SPEC §6.15) and returns the index after it. */
const writeRow = (buf: Int32Array, at: number, k: Ctx['k'], u: Unit): number => {
  buf[at++] = u.gameId; buf[at++] = u.kind; buf[at++] = u.team; buf[at++] = u.x; buf[at++] = u.y; buf[at++] = k.fx.div(u.hp * 255, u.maxHp)
  buf[at++] = flagsOf(u); buf[at++] = u.trail.length >> 1; buf[at++] = u.trail[0] ?? 0; buf[at++] = u.trail[1] ?? 0
  return at
}

export const statsSystem = (ctx: Ctx) => {
  const { k, add, begin, end, dirty, world } = ctx
  const naiveBanner = ctx.isNaive('stats.banner')
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

  // A unit has the banner when the root of its parent chain is a warlord and it is not the root.
  const bannerByRoot = (u: Unit): boolean => {
    let root = u
    for (let p = parentById(ctx, root); p; p = parentById(ctx, root)) root = p
    return root !== u && root.kind === k.KIND.WARLORD
  }
  // A parent has a lower gameId than its children, so one pass in array order sees the parent's new value.
  const bannerByParent = (u: Unit): boolean => {
    const p = u.pref
    return !!p && (p.kind === k.KIND.WARLORD || p.bannered)
  }
  const bannerOf = naiveBanner ? bannerByRoot : bannerByParent

  const updateBanners = () => {
    const units = ctx.units
    begin('stats.banner')
    for (let u_i = 0, u = units[0]; u_i < units.length; u = units[++u_i]) {
      const banner = bannerOf(u)
      if (banner !== u.bannered) { u.bannered = banner; dirty.add(u); add('tag.change.bannered') }
    }
    end('stats.banner')
  }

  // The naive code scans the items of every unit for the item mask. The normal code keeps the mask when items change.
  const rescanMasks = () => {
    const units = ctx.units
    for (let u_i = 0, u = units[0]; u_i < units.length; u = units[++u_i]) u.itemMask = scanItemMask(u)
  }
  const keepMasks = () => {}
  const refreshMasks = ctx.isNaive('stats.setBonus') ? rescanMasks : keepMasks
  // New units are not dirty: spawn already computed them and only items, buffs and kills change them later.
  const recomputeAll = () => {
    const units = ctx.units
    for (let u_i = 0, u = units[0]; u_i < units.length; u = units[++u_i]) refresh(u)
  }
  const recomputeDirty = () => {
    for (const u of dirty) if (!u.destroyed) refresh(u)
  }
  const recompute = ctx.isNaive('stats.recompute') ? recomputeAll : recomputeDirty

  // The naive code copies each unit into a new object first, like a renderer that takes a copy of the entity.
  const fillFromCopies = (at: number): number => {
    const rows = ctx.units.map((u) => ({ ...u }))
    for (let r_i = 0, r = rows[0]; r_i < rows.length; r = rows[++r_i]) at = writeRow(buf, at, k, r)
    return at
  }
  const fillFromUnits = (at: number): number => {
    const units = ctx.units
    for (let u_i = 0, u = units[0]; u_i < units.length; u = units[++u_i]) at = writeRow(buf, at, k, u)
    return at
  }
  const fillRows = ctx.isNaive('stats.render') ? fillFromCopies : fillFromUnits

  /** Counts that only the profile runner reads. */
  const sampleHierarchy = () => {
    const { units, counters } = ctx
    if (!counters) return
    let needed = 0
    for (const u of dirty) if (!u.destroyed) needed++
    add('stats.needed', needed)
    add('stats.full', units.length)
    sampleEntities(ctx)
    let maxDepth = 0
    const children = new Map<number, number>()
    for (let u_i = 0, u = units[0]; u_i < units.length; u = units[++u_i]) {
      const p = u.pref
      if (p) children.set(p.gameId, (children.get(p.gameId) ?? 0) + 1)
      maxDepth = Math.max(maxDepth, depthOf(ctx, u))
    }
    counters.set('hier.depth', maxDepth)
    counters.set('hier.maxChildren', Math.max(0, ...children.values()))
  }

  return () => {
    const { units } = ctx
    updateBanners()
    begin('stats.setBonus')
    refreshMasks()
    end('stats.setBonus')
    begin('stats.recompute')
    recompute()
    end('stats.recompute')
    sampleHierarchy()
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
    fillRows(1)
    end('stats.render') // the fold is the kernel's hash of the buffer, not extraction work
    const chain = k.foldRender(world.renderChain, buf, size)
    if (chain !== world.renderChain) add('rule.renderChain')
    world.renderChain = chain
    world.tick = ctx.tick
    ctx.tick++
  }
}
