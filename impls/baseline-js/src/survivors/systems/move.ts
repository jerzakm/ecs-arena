import { survivors } from '@ecs-arena/spec'
import type { Ctx } from '../context.ts'
import { ENT, type Proj } from '../types.ts'
const { TRAIT, STATUS } = survivors.kernel
export const moveSystems: Pick<survivors.SystemTable<Ctx>, 'move.mobs' | 'move.proj' | 'move.particles' | 'grid.update'> = {
  'move.mobs': (ctx) => {
    const { k } = ctx
    const { hasTag, gateFree } = ctx.tags
    return () => {
      const { px, py } = ctx
      const mobs = ctx.lists[ENT.MOB]
      for (let i = 0; i < mobs.length; i++) {
        const m = mobs[i]
        if (!hasTag(m, STATUS.KNOCKBACK)) continue
        const [x, y] = k.stepTo(m.x, m.y, 2 * m.x - px, 2 * m.y - py, k.KNOCK_SPEED)
        if (x !== m.x || y !== m.y) m.moved = true
        m.x = x; m.y = y
      }
      const free = gateFree(mobs, k.BLOCKS_MOVE)
      for (let i = 0; i < free.length; i++) {
        const m = free[i]
        const x = k.clampToArena(m.x + m.vx), y = k.clampToArena(m.y + m.vy)
        if (x !== m.x || y !== m.y) m.moved = true
        m.x = x; m.y = y
      }
    }
  },
  'move.proj': (ctx) => {
    const { k } = ctx
    const homing = (p: Proj) => {
      const t = ctx.mobById.get(p.target)
      if (t) [p.vx, p.vy] = k.velToward(p.x, p.y, t.x, t.y, ctx.wstat[p.weapon]!.speed)
    }
    const back = (p: Proj, tick: number) => {
      const st = ctx.wstat[p.weapon]!
      if (tick >= p.ttl - Math.ceil(st.life / 2)) [p.vx, p.vy] = k.velToward(p.x, p.y, ctx.px, ctx.py, st.speed)
    }
    const steered = (p: Proj) => p.weapon >= 0 && p.ttl !== k.INF_TTL
    return () => {
      const { tick } = ctx
      const ps = ctx.lists[ENT.PROJ]
      for (let i = 0; i < ps.length; i++) {
        const p = ps[i]
        if (!(p.traits & (TRAIT.HOMING | TRAIT.RETURN)) || !steered(p)) continue
        if (p.traits & TRAIT.HOMING) homing(p)
        if (p.traits & TRAIT.RETURN) back(p, tick)
      }
      if (ctx.counters) ctx.add('proj.traitSets', new Set(ps.map((p) => p.traits)).size)
      for (let i = 0; i < ps.length; i++) {
        const p = ps[i]
        if (p.ttl === k.INF_TTL) continue
        p.x = k.clampToArena(p.x + p.vx)
        p.y = k.clampToArena(p.y + p.vy)
      }
    }
  },
  'move.particles': (ctx) => () => {
    const { k } = ctx
    const ps = ctx.lists[ENT.PART]
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i]
      p.x = k.clampToArena(p.x + p.vx)
      p.y = k.clampToArena(p.y + p.vy)
      p.vx = k.fx.div(p.vx * 7, 8)
      p.vy = k.fx.div(p.vy * 7, 8)
    }
  },
  'grid.update': (ctx) => {
    // The naive code does not follow the movers. ctx.resendGrid sends every mob to the grid before each search.
    if (ctx.nv['grid.update']) return () => {}
    return () => {
      ctx.begin('grid.update')
      const mobs = ctx.lists[ENT.MOB]
      for (let i = 0; i < mobs.length; i++) {
        const m = mobs[i]
        if (!m.moved) continue
        m.moved = false
        ctx.grid.update(m.h, m.x, m.y)
      }
      ctx.end('grid.update')
    }
  },
}
