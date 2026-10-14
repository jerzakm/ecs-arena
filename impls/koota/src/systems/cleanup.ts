import { Not, type Entity } from 'koota'
import { byGameId, type Context } from '../context.ts'
import {
  Age, Chronicle, Dead, Fleeing, GameId, Ground, KillCount, Kind, Metrics, Minion, Morale, Position, Projectile, Routed, Spent, Team, Veteran,
} from '../components.ts'
import { Equips, LastHitBy, MemberOf, Targets } from '../relations.ts'
import { buildGrid, forNear, type Cell } from '../spatial.ts'

const promote = (ctx: Context, unit: Entity) => {
  const members = ctx.world.query(MemberOf(unit)).map((m) => ({ id: ctx.gid(m), e: m })).sort(byGameId)
  if (members.length === 0) return
  const [{ e: head }, ...rest] = members
  const headOffset = head.get(MemberOf(unit))!
  const parent = unit.targetFor(MemberOf)
  head.remove(MemberOf(unit))
  if (parent && !head.has(Fleeing)) head.add(MemberOf(parent, { ...unit.get(MemberOf(parent))! }))
  if (!head.has(Morale) && unit.has(Morale)) {
    head.add(Morale({ ...unit.get(Morale)! }))
    if (unit.has(Routed)) head.add(Routed)
  }
  for (const { e: m } of rest) {
    const o = m.get(MemberOf(unit))!
    m.add(MemberOf(head, { offsetX: o.offsetX - headOffset.offsetX, offsetY: o.offsetY - headOffset.offsetY }))
  }
}

export const cleanupSystem = (ctx: Context) => {
  const { k, world, gid, homeX, sortedByGameId } = ctx
  const { KIND, distSq } = k

  return () => {
    const kills = [0, 0]

    const leaving = sortedByGameId(Dead)
    world.query(Fleeing, GameId, Position, Team, Not(Dead)).readEach(([g, p, t], e) => {
      if (p.x === homeX(t.value)) leaving.push({ id: g.id, e })
    })
    leaving.sort(byGameId)

    for (const { e } of leaving) {
      if (!e.isAlive()) continue
      if (e.has(Dead)) {
        if (e.get(Kind)!.value !== KIND.MINION) kills[1 - e.get(Team)!.value]++
        const killer = e.targetFor(LastHitBy)
        if (killer) {
          killer.set(KillCount, (c) => ({ value: c.value + 1 }))
          if (killer.has(Veteran)) {
            const chronicle = killer.get(Chronicle)!.kinds
            chronicle.push(e.get(Kind)!.value)
            if (chronicle.length > k.CHRONICLE_MAX) chronicle.shift()
          }
        }
        const first = e.targetsFor(Equips).map((item) => ({ id: gid(item), e: item })).sort(byGameId)[0]?.e
        if (first) {
          const quality = e.get(Equips(first))!.quality
          const pos = e.get(Position)!
          e.remove(Equips(first))
          first.add(Ground({ quality }), Position({ x: pos.x, y: pos.y }), Age)
        }
      }
      promote(ctx, e)
      // The remaining items and the minions of the unit go with it (autoDestroy on Equips and ChildOf).
      e.destroy()
    }

    const oldMinions: Entity[] = []
    world.query(Minion, Age).readEach(([age], e) => { if (age.value >= k.MINION_LIFETIME) oldMinions.push(e) })
    for (const e of oldMinions) e.destroy()

    const doneProjectiles: Entity[] = []
    world.query(Projectile, Age).readEach(([, age], e) => {
      if (e.has(Spent) || !e.targetFor(Targets) || age.value >= k.PROJECTILE_LIFETIME) doneProjectiles.push(e)
    })
    for (const e of doneProjectiles) e.destroy()

    const ground = sortedByGameId(Ground)
    if (ground.length > 0) {
      const grid = buildGrid(ctx)
      for (const g of ground) {
        const gp = g.e.get(Position)!
        let best: Cell | undefined
        let bestD = 0
        forNear(ctx, grid, gp.x, gp.y, k.PICKUP_RANGE, (v) => {
          const d = distSq(gp.x, gp.y, v.x, v.y)
          if (d > k.PICKUP_RANGE * k.PICKUP_RANGE) return
          if (best && !(d < bestD || (d === bestD && v.id < best.id))) return
          if (v.e.targetsFor(Equips).length >= k.MAX_ITEMS) return
          best = v; bestD = d
        })
        if (!best) continue
        const quality = g.e.get(Ground)!.quality
        best.e.add(Equips(g.e, { quality }))
        g.e.remove(Ground, Position, Age)
      }
    }

    const old: Entity[] = []
    world.query(Ground, Age).readEach(([, age], e) => { if (age.value >= k.GROUND_ITEM_LIFETIME) old.push(e) })
    for (const e of old) e.destroy()

    world.set(Metrics, (m) => ({ kills0: m.kills0 + kills[0], kills1: m.kills1 + kills[1] }))
  }
}
