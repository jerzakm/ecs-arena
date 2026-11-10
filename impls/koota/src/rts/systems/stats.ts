import type { Entity } from 'koota'
import type { Ctx } from '../context.ts'
import { Bannered, ChildOf, Chronicle, Clock, FLAG_TAGS, Kind, MemberOf, Metrics, Unit, Veteran } from '../traits.ts'
import { recomputeStats } from '../derived-stats.ts'
import { maskOf } from '../../shared/util.ts'

export const statsSystem = (ctx: Ctx) => {
  const { k, world, q, dirty } = ctx
  // For each unit in query order: gameId, kind, team, x, y, hp byte, flags, trail count, the oldest trail point
  const rows: number[] = []
  let buf = new Int32Array(0)

  return () => {
    const candidates: Entity[] = []
    world.query(q.killsChanged).readEach(([c], e) => { if (c.value >= k.VETERAN_KILLS) candidates.push(e) })
    for (const e of candidates) e.add(Veteran)
    for (const e of world.query(q.newlyVeteran)) e.add(Chronicle({ kinds: [k.PROMOTION_MARK] }))

    // Banner: the root of the MemberOf and ChildOf chain is a warlord and the unit is not the root. The memo holds "root is a warlord".
    const rootIsWarlord = new Map<Entity, boolean>()
    const rootWarlord = (e: Entity): boolean => {
      let r = rootIsWarlord.get(e)
      if (r === undefined) {
        const p = e.targetFor(MemberOf) ?? e.targetFor(ChildOf)
        rootIsWarlord.set(e, r = p ? rootWarlord(p) : e.get(Kind)!.value === k.KIND.WARLORD)
      }
      return r
    }
    const gain: Entity[] = [], lose: Entity[] = []
    for (const e of world.query(Unit)) {
      const p = e.targetFor(MemberOf) ?? e.targetFor(ChildOf)
      const banner = !!p && rootWarlord(p)
      if (banner !== e.has(Bannered)) (banner ? gain : lose).push(e)
    }
    for (const e of gain) e.add(Bannered)
    for (const e of lose) e.remove(Bannered)

    for (const e of dirty) if (e.isAlive()) recomputeStats(ctx, e)
    dirty.clear()

    const alive = [0, 0]
    world.query(q.teams).readEach(([t]) => { alive[t.value]++ })
    const { tick } = world.get(Clock)!
    world.set(Metrics, (m) => {
      let winner = m.winner
      if (tick > 0 && winner === -1) {
        if (alive[0] === 0 && alive[1] > 0) winner = 1
        else if (alive[1] === 0 && alive[0] > 0) winner = 0
      }
      return { alive0: alive[0], alive1: alive[1], winner }
    })

    // SPEC 6.15: one pass reads the traits of every unit. The tags come from `has`, and the rows go out in gameId order.
    rows.length = 0
    world.query(q.renderables).readEach(([g, kind, team, p, h, t], e) => {
      rows.push(
        g.id, kind.value, team.value, p.x, p.y, k.fx.div(h.hp * 255, h.maxHp), maskOf(e, FLAG_TAGS),
        t.pts.length >> 1, t.pts[0] ?? 0, t.pts[1] ?? 0,
      )
    })
    const n = rows.length / k.RENDER_STRIDE
    const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => rows[a * k.RENDER_STRIDE] - rows[b * k.RENDER_STRIDE])
    const size = 1 + rows.length
    if (buf.length < size) buf = new Int32Array(Math.max(size, 2 * buf.length))
    buf[0] = n
    order.forEach((r, i) => { for (let j = 0; j < k.RENDER_STRIDE; j++) buf[1 + i * k.RENDER_STRIDE + j] = rows[r * k.RENDER_STRIDE + j] })
    world.set(Metrics, (m) => ({ renderChain: k.foldRender(m.renderChain, buf, size) }))
  }
}
