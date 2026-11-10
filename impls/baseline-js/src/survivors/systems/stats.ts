import { survivors } from '@ecs-arena/spec'
import type { Ctx } from '../context.ts'
import { ENT, type Ent, type Mob } from '../types.ts'
const { RENDER_KIND, RENDER_STRIDE, CAMERA_HALF: CAM } = survivors.kernel
const NO_ID = 0x7fffffff
/** Writes one row of the render buffer (SPEC-survivors §6.15) and returns the index after it. */
const writeRow = (buf: Int32Array, at: number, id: number, code: number, x: number, y: number, hpByte: number, flags: number): number => {
  buf[at++] = id; buf[at++] = code; buf[at++] = x; buf[at++] = y; buf[at++] = hpByte; buf[at++] = flags
  return at
}
export const statsSystems: Pick<survivors.SystemTable<Ctx>, 'stats.render'> = {
  'stats.render': (ctx) => {
    const { k } = ctx
    let buf = new Int32Array(0)
    // The naive code copies each entity into a new object before it writes the row, like a renderer that takes a copy, tags included.
    const copyOf = (e: Mob | Ent): Mob | Ent => (e.t === ENT.MOB ? { ...e, timed: e.timed.map((t) => ({ ...t })) } : { ...e })
    const viewOf = ctx.nv['stats.render'] ? copyOf : (e: Mob | Ent) => e
    return () => {
      const { totals, player, px, py } = ctx
      const [M, P, K, Q] = ctx.lists
      totals.alive = M.length
      if (ctx.counters) {
        const total = M.length + P.length + K.length + Q.length
        ctx.counters.set('alive.mob', M.length)
        ctx.counters.set('alive.projectile', P.length)
        ctx.counters.set('alive.pickup', K.length)
        ctx.counters.set('alive.particle', Q.length)
        ctx.counters.set('alive.total', total + 1)
      }
      const need = 1 + RENDER_STRIDE * (2 + M.length + P.length + K.length + Q.length)
      if (buf.length < need) buf = new Int32Array(Math.max(need, 2 * buf.length))
      ctx.begin('stats.render')
      let at = 1
      const playerHp = k.hpByte(player.hp, k.maxHp(ctx.pstat.vigor))
      at = writeRow(buf, at, k.PLAYER_ID, RENDER_KIND.PLAYER, player.x, player.y, playerHp, player.iframes ? 1 << k.STATUS.IFRAMES : 0)
      // Four lists, each sorted by gameId. The rows go out in gameId order.
      let a = 0, b = 0, c = 0, d = 0
      let ia = M.length ? M[0].gameId : NO_ID, ib = P.length ? P[0].gameId : NO_ID
      let ic = K.length ? K[0].gameId : NO_ID, id = Q.length ? Q[0].gameId : NO_ID
      for (;;) {
        let src: Mob | Ent
        if (ia < ib && ia < ic && ia < id) { src = M[a++]; ia = a < M.length ? M[a].gameId : NO_ID }
        else if (ib < ic && ib < id) { src = P[b++]; ib = b < P.length ? P[b].gameId : NO_ID }
        else if (ic < id) { src = K[c++]; ic = c < K.length ? K[c].gameId : NO_ID }
        else if (id < NO_ID) { src = Q[d++]; id = d < Q.length ? Q[d].gameId : NO_ID }
        else break
        const e = viewOf(src)
        if (e.x - px > CAM || px - e.x > CAM || e.y - py > CAM || py - e.y > CAM) continue
        let code: number, hb = 0, fl = 0
        if (e.t === ENT.MOB) { code = e.kind; hb = k.hpByte(e.hp, k.mobMaxHp(e.kind, e.flags)); fl = e.flags }
        else if (e.t === ENT.PROJ) {
          code = e.weapon === -1 ? RENDER_KIND.PROJECTILE : RENDER_KIND.PROJECTILE + e.weapon + 1
          fl = e.traits
        }
        else if (e.t === ENT.PICKUP) code = RENDER_KIND.PICKUP + e.kind
        else code = RENDER_KIND.PARTICLE + e.kind
        at = writeRow(buf, at, e.gameId, code, e.x, e.y, hb, fl)
      }
      buf[0] = (at - 1) / RENDER_STRIDE
      ctx.end('stats.render')
      const chain = k.foldRender(totals.renderChain, buf, at)
      if (chain !== totals.renderChain) ctx.add('rule.renderChain')
      totals.renderChain = chain
      totals.tick = ctx.tick
      ctx.tick++
    }
  },
}
