import { byGameId, type Context } from '../context.ts'
import { memberIndex } from '../hierarchy.ts'
import type { Unit } from '../types.ts'

export const cleanupSystem = (ctx: Context) => {
  const { k, add, begin, end, dirty, unitById, world, homeX, kindName } = ctx
  const { KIND } = k
  const naiveChurn = ctx.isNaive('churn'), naiveUnlink = ctx.isNaive('cleanup.unlink'), naiveCascade = ctx.isNaive('cleanup.cascade')
  const naiveCredit = ctx.isNaive('cleanup.credit'), naiveThreat = ctx.isNaive('threat')
  const hasRoom = (h: number) => ctx.slots[h].items.length < k.MAX_ITEMS

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
    begin('links')
    const members = memberIndex(ctx)
    end('links')

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
        begin('cleanup.credit')
        const killer = unitById.get(u.lastHitBy)
        if (killer) {
          killer.killCount++
          dirty.add(killer)
          if (killer.veteran) {
            if (naiveCredit) killer.chronicle = [...killer.chronicle, u.kind]
            else killer.chronicle.push(u.kind)
            if (killer.chronicle.length > k.CHRONICLE_MAX) {
              if (naiveCredit) killer.chronicle = killer.chronicle.slice(1)
              else killer.chronicle.shift()
            }
          }
        }
        end('cleanup.credit')
        if (u.items.length > 0) {
          const it = u.items[0]
          ctx.groundItems.push({ gameId: it.gameId, kind: it.kind, quality: it.quality, x: u.x, y: u.y, age: 0 })
          add('item.drop'); add('rel.Equips.remove')
        }
      } else add('leave')
      begin('cleanup.cascade')
      for (const m of naiveCascade ? before.filter((x) => x.childOf === u.gameId) : ctx.minionsOf.get(u.gameId) ?? []) if (!m.destroyed) destroy(m)
      end('cleanup.cascade')
      begin('links')
      promote(u)
      end('links')
      destroy(u)
    }

    for (let u_i = 0, u = before[0]; u_i < before.length; u = before[++u_i]) if (u.kind === KIND.MINION && u.age >= k.MINION_LIFETIME && !u.destroyed) destroy(u)

    begin('churn')
    let alive = before
    for (let u_i = 0, u = before[0]; u_i < before.length; u = before[++u_i]) if (u.destroyed) {
      unitById.delete(u.gameId); ctx.grid.remove(u.h); ctx.freeSlots.push(u.h)
      ctx.buffed.delete(u); ctx.threatened.delete(u)
      if (u.childOf !== -1) {
        const list = ctx.minionsOf.get(u.childOf)
        const i = list ? list.indexOf(u) : -1
        if (i !== -1) list!.splice(i, 1)
      }
      ctx.minionsOf.delete(u.gameId)
      if (naiveChurn) alive = alive.filter((x) => x !== u)
    }
    ctx.units = naiveChurn ? alive : before.filter((u) => !u.destroyed)
    end('churn')
    alive = ctx.units

    begin('cleanup.unlink')
    if (naiveUnlink) {
      for (let u_i = 0, u = alive[0]; u_i < alive.length; u = alive[++u_i]) if (u.target !== -1 && !unitById.has(u.target)) { u.target = -1; add('rel.Targets.remove') }
    } else {
      for (let u_i = 0, u = before[0]; u_i < before.length; u = before[++u_i]) if (u.destroyed) {
        const inbound = ctx.targeters.get(u.gameId)
        if (inbound) {
          for (const s of inbound) if (!s.destroyed && s.target === u.gameId) { s.target = -1; add('rel.Targets.remove') }
          ctx.targeters.delete(u.gameId)
        }
        if (u.target !== -1) ctx.retarget(u, -1)
      }
    }
    end('cleanup.unlink')

    begin('threat')
    const purge = (u: Unit) => {
      if (u.threat.length > 0) {
        const kept = u.threat.filter((e) => unitById.has(e.attacker))
        add('rel.Threat.remove', u.threat.length - kept.length)
        u.threat = kept
      }
    }
    if (naiveThreat) for (let u_i = 0, u = alive[0]; u_i < alive.length; u = alive[++u_i]) purge(u)
    else for (const u of ctx.threatened) { purge(u); if (u.threat.length === 0) ctx.threatened.delete(u) }
    end('threat')

    begin('churn')
    const projBefore = ctx.projectiles.length
    ctx.projectiles = ctx.projectiles.filter((p) => !p.spent && unitById.has(p.target) && p.age < k.PROJECTILE_LIFETIME)
    add('destroy.projectile', projBefore - ctx.projectiles.length)
    end('churn')

    // Pickup, in gameId order. Items taken here count toward the cap of later items.
    add('q.cleanup.groundItems', ctx.groundItems.length)
    if (ctx.groundItems.length > 0) {
      ctx.groundItems.sort(byGameId)
      ctx.groundItems = ctx.groundItems.filter((g) => {
        const h = ctx.grid.nearest(g.x, g.y, k.PICKUP_RANGE, hasRoom, 'pickup')
        if (h === -1) return true
        const taker = ctx.slots[h]
        add('item.pickup'); add('rel.Equips.add'); dirty.add(taker)
        taker.items.push({ gameId: g.gameId, kind: g.kind, quality: g.quality })
        taker.items.sort(byGameId)
        return false
      })
    }

    begin('churn')
    const gBefore = ctx.groundItems.length
    ctx.groundItems = ctx.groundItems.filter((g) => g.age < k.GROUND_ITEM_LIFETIME)
    add('destroy.groundItem', gBefore - ctx.groundItems.length)
    end('churn')
  }
}
