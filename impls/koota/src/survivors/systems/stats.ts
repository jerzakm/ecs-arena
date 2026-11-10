import { survivors } from '@ecs-arena/spec'
import { Clock, Hp, Iframes, Loadout, Position, Totals } from '../traits.ts'
import { flagsOf, traitsOf } from '../tags.ts'
import type { Ctx } from '../context.ts'

const { RENDER_KIND, RENDER_STRIDE, CAMERA_HALF: CAM } = survivors.kernel

/** The render rows are arrays that start with the gameId. */
const byRowId = (a: number[], b: number[]) => a[0] - b[0]

export const statsSystems: Pick<survivors.SystemTable<Ctx>, 'stats.render'> = {
  'stats.render': (ctx) => {
    const { k } = ctx
    let buf = new Int32Array(0)
    return () => {
      const { world, q, player } = ctx
      const { tick } = world.get(Clock)!
      const totals = world.get(Totals)!
      const { x: px, y: py } = player.get(Position)!
      // The rows of the camera window. A query result has no order, so the rows are sorted by gameId before they go out.
      const rows: number[][] = []
      const inWindow = (x: number, y: number) => !(x - px > CAM || px - x > CAM || y - py > CAM || py - y > CAM)
      let alive = 0
      world.query(q.renderMobs).readEach(([g, kind, p, hp], e) => {
        alive++
        if (!inWindow(p.x, p.y)) return
        const flags = flagsOf(e)
        rows.push([g.id, kind.value, p.x, p.y, k.hpByte(hp.hp, k.mobMaxHp(kind.value, flags)), flags])
      })
      world.query(q.renderProjectiles).readEach(([pr, g, p], e) => {
        if (!inWindow(p.x, p.y)) return
        const code = pr.weapon === -1 ? RENDER_KIND.PROJECTILE : RENDER_KIND.PROJECTILE + pr.weapon + 1
        rows.push([g.id, code, p.x, p.y, 0, traitsOf(e)])
      })
      world.query(q.renderPickups).readEach(([pk, g, p]) => {
        if (inWindow(p.x, p.y)) rows.push([g.id, RENDER_KIND.PICKUP + pk.kind, p.x, p.y, 0, 0])
      })
      world.query(q.renderParticles).readEach(([pt, g, p]) => {
        if (inWindow(p.x, p.y)) rows.push([g.id, RENDER_KIND.PARTICLE + pt.kind, p.x, p.y, 0, 0])
      })
      totals.alive = alive // spawn.wave of the next tick reads it
      rows.sort(byRowId)
      const need = 1 + RENDER_STRIDE * (1 + rows.length)
      if (buf.length < need) buf = new Int32Array(Math.max(need, 2 * buf.length))
      let at = 1
      const row = (id: number, code: number, x: number, y: number, hb: number, fl: number) => {
        buf[at++] = id; buf[at++] = code; buf[at++] = x; buf[at++] = y; buf[at++] = hb; buf[at++] = fl
      }
      const maxHp = k.maxHp(world.get(Loadout)!.stats.vigor)
      row(k.PLAYER_ID, RENDER_KIND.PLAYER, px, py, k.hpByte(player.get(Hp)!.hp, maxHp), player.has(Iframes) ? 1 << k.STATUS.IFRAMES : 0)
      for (const r of rows) row(r[0], r[1], r[2], r[3], r[4], r[5])
      buf[0] = (at - 1) / RENDER_STRIDE
      totals.renderChain = k.foldRender(totals.renderChain, buf, at)
      totals.tick = tick
      world.set(Clock, { tick: tick + 1 })
    }
  },
}
