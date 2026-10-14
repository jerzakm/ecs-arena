import { byGameId, type Context } from '../context.ts'
import { memberIndex } from '../hierarchy.ts'
import { buildGrid, forNear } from '../spatial.ts'
import type { Unit } from '../types.ts'

export const cleanupSystem = (ctx: Context) => {
  const { k, add, dirty, unitById, world, homeX, inRange, kindName } = ctx
  const { distSq, KIND } = k

  const destroy = (u: Unit) => {
    if (ctx.counters) {
      add(`destroy.${kindName(u.kind)}`)
      if (u.target !== -1) add('rel.Targets.destroyDrop')
      if (u.memberOf !== -1) add('rel.MemberOf.destroyDrop')
      if (u.childOf !== -1) add('rel.ChildOf.destroyDrop')
      if (u.threat.length) add('rel.Threat.destroyDrop', u.threat.length)
      const rest = u.dead ? Math.max(0, u.items.length - 1) : u.items.length
      if (rest > 0) { add('destroy.equippedItem', rest); add('rel.Equips.destroyDrop', rest) }
    }
    u.destroyed = true
  }

  return () => {
    const before = ctx.units
    const members = memberIndex(ctx)
    const minions = new Map<number, Unit[]>()
    for (let u_i = 0, u = before[0]; u_i < before.length; u = before[++u_i]) if (u.childOf !== -1) {
      const list = minions.get(u.childOf)
      if (list) list.push(u)
      else minions.set(u.childOf, [u])
    }

    const promote = (old: Unit) => {
      const live = (members.get(old.gameId) ?? []).filter((m) => !m.destroyed)
      members.delete(old.gameId)
      if (live.length === 0) return
      const [head, ...rest] = live
      const { offX, offY } = head
      const siblings = (members.get(old.memberOf) ?? []).filter((m) => m !== old)
      if (old.memberOf !== -1 && !head.fleeing) {
        members.set(old.memberOf, siblings.concat(head).sort(byGameId))
        head.memberOf = old.memberOf; head.offX = old.offX; head.offY = old.offY
      } else {
        if (old.memberOf !== -1) members.set(old.memberOf, siblings)
        head.memberOf = -1; head.offX = 0; head.offY = 0
      }
      if (!head.morale && old.morale) { head.morale = { ...old.morale }; head.routed = old.routed }
      for (let m_i = 0, m = rest[0]; m_i < rest.length; m = rest[++m_i]) { m.memberOf = head.gameId; m.offX -= offX; m.offY -= offY }
      members.set(head.gameId, [...(members.get(head.gameId) ?? []), ...rest].sort(byGameId))
      add('promote'); add('rel.MemberOf.remove'); add('rel.MemberOf.retarget', rest.length)
    }

    // A leaving unit is fleeing, alive, and on its home edge.
    const departing = before.filter((u) => u.dead || (u.fleeing && u.x === homeX(u.team)))
    add('q.cleanup.dead', departing.length)
    for (let u_i = 0, u = departing[0]; u_i < departing.length; u = departing[++u_i]) {
      if (u.destroyed) continue
      if (u.dead) {
        if (u.kind !== KIND.MINION) world.kills[1 - u.team]++
        const killer = unitById.get(u.lastHitBy)
        if (killer) {
          killer.killCount++
          dirty?.add(killer.gameId)
          if (killer.veteran) {
            killer.chronicle.push(u.kind)
            if (killer.chronicle.length > k.CHRONICLE_MAX) killer.chronicle.shift()
          }
        }
        if (u.items.length > 0) {
          const it = u.items[0]
          ctx.groundItems.push({ gameId: it.gameId, kind: it.kind, quality: it.quality, x: u.x, y: u.y, age: 0 })
          add('item.drop'); add('rel.Equips.remove')
        }
      } else add('leave')
      for (const m of minions.get(u.gameId) ?? []) if (!m.destroyed) destroy(m)
      promote(u)
      destroy(u)
    }

    for (let u_i = 0, u = before[0]; u_i < before.length; u = before[++u_i]) if (u.kind === KIND.MINION && u.age >= k.MINION_LIFETIME && !u.destroyed) destroy(u)

    for (let u_i = 0, u = before[0]; u_i < before.length; u = before[++u_i]) if (u.destroyed) unitById.delete(u.gameId)
    ctx.units = before.filter((u) => !u.destroyed)
    const alive = ctx.units
    for (let u_i = 0, u = alive[0]; u_i < alive.length; u = alive[++u_i]) {
      if (u.target !== -1 && !unitById.has(u.target)) { u.target = -1; add('rel.Targets.remove') }
      if (u.threat.length > 0) {
        const kept = u.threat.filter((e) => unitById.has(e.attacker))
        add('rel.Threat.remove', u.threat.length - kept.length)
        u.threat = kept
      }
    }

    const projBefore = ctx.projectiles.length
    ctx.projectiles = ctx.projectiles.filter((p) => !p.spent && unitById.has(p.target) && p.age < k.PROJECTILE_LIFETIME)
    add('destroy.projectile', projBefore - ctx.projectiles.length)

    // Pickup, in gameId order. Items taken here count toward the cap of later items.
    add('q.cleanup.groundItems', ctx.groundItems.length)
    if (ctx.groundItems.length > 0) {
      ctx.groundItems.sort(byGameId)
      const grid = buildGrid(ctx)
      ctx.groundItems = ctx.groundItems.filter((g) => {
        let best: Unit | null = null
        let bestD = 0
        forNear(ctx, grid, g.x, g.y, k.PICKUP_RANGE, (v) => {
          if (v.items.length >= k.MAX_ITEMS || !inRange(g.x, g.y, v.x, v.y, k.PICKUP_RANGE)) return
          const d = distSq(g.x, g.y, v.x, v.y)
          if (!best || d < bestD || (d === bestD && v.gameId < best.gameId)) { best = v; bestD = d }
        }, 'pickup')
        if (!best) return true
        const taker = best as Unit
        add('item.pickup'); add('rel.Equips.add'); dirty?.add(taker.gameId)
        taker.items.push({ gameId: g.gameId, kind: g.kind, quality: g.quality })
        taker.items.sort(byGameId)
        return false
      })
    }

    const gBefore = ctx.groundItems.length
    ctx.groundItems = ctx.groundItems.filter((g) => g.age < k.GROUND_ITEM_LIFETIME)
    add('destroy.groundItem', gBefore - ctx.groundItems.length)
  }
}
