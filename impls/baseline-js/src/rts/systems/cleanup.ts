import type { Ctx } from '../context.ts'
import { resendGridFor } from '../grid.ts'
import { dropMember } from '../hierarchy.ts'
import { kindName } from '../profiling.ts'
import { retarget } from '../targets.ts'
import type { Projectile, Unit } from '../types.ts'
import { byGameId } from '../../shared/util.ts'

// cleanup runs these steps in order. Each step is built once, and picks the normal or the naive function of its regions when it is built.
export const cleanupSystem = (ctx: Ctx) => {
  const departAndCascade = departAndCascadeStep(ctx)
  const expireMinions = expireMinionsStep(ctx)
  const churnUnits = churnUnitsStep(ctx)
  const unlinkTargets = unlinkTargetsStep(ctx)
  const purgeThreat = purgeThreatStep(ctx)
  const churnProjectiles = churnProjectilesStep(ctx)
  const pickup = pickupStep(ctx)
  const expireGround = expireGroundStep(ctx)

  return () => {
    const before = ctx.units
    departAndCascade(before)
    expireMinions(before)
    const gone = churnUnits(before)
    const alive = ctx.units
    unlinkTargets(before)
    purgeThreat(before, alive, gone)
    churnProjectiles()
    pickup()
    expireGround()
  }
}

/** Marks the unit destroyed. The counters see the relations that the destroy drops. */
const destroyUnit = (ctx: Ctx) => {
  const { add } = ctx
  return (u: Unit) => {
    if (ctx.counters) {
      add(`destroy.${kindName(ctx, u.kind)}`)
      if (u.target !== -1) add('rel.Targets.destroyDrop')
      if (u.memberOf !== -1) add('rel.MemberOf.destroyDrop')
      if (u.childOf !== -1) add('rel.ChildOf.destroyDrop')
      if (u.threat.length) add('rel.Threat.destroyDrop', u.threat.length)
      const rest = u.dead ? Math.max(0, u.items.length - 1) : u.items.length
      if (rest > 0) { add('destroy.equippedItem', rest); add('rel.Equips.destroyDrop', rest) }
    }
    u.destroyed = true
  }
}

/** Units that died, or that fled to their home edge, leave. Their minions go with them and their members get a new head. */
const departAndCascadeStep = (ctx: Ctx) => {
  const { k, add, begin, end, dirty, unitById, world } = ctx
  const { KIND } = k
  const destroy = destroyUnit(ctx)
  const naiveLinks = ctx.isNaive('links')
  const naiveCascade = ctx.isNaive('cleanup.cascade')

  // The members of a unit, in gameId order. The normal code reads the inverse index, the naive code scans every unit.
  const membersByIndex = (_before: Unit[], id: number): Unit[] => ctx.members.get(id) ?? []
  const membersByScan = (before: Unit[], id: number): Unit[] => before.filter((m) => m.memberOf === id)
  const membersOf = naiveLinks ? membersByScan : membersByIndex
  // The normal code keeps the inverse index in step. The naive code keeps nothing.
  const setMembers = naiveLinks ? () => {} : (parent: number, list: Unit[]) => void ctx.members.set(parent, list)

  const minionsByIndex = (_before: Unit[], id: number): Unit[] => ctx.minionsOf.get(id) ?? []
  const minionsByScan = (before: Unit[], id: number): Unit[] => before.filter((x) => x.childOf === id)
  const minionsOf = naiveCascade ? minionsByScan : minionsByIndex

  /** The first live member takes the place of the departing unit, and the rest follow it. */
  const promote = (before: Unit[], old: Unit) => {
    const live = membersOf(before, old.gameId).filter((m) => !m.destroyed)
    ctx.members.delete(old.gameId)
    if (live.length === 0) return
    const [head, ...rest] = live
    const { offX, offY } = head
    const siblings = (ctx.members.get(old.memberOf) ?? []).filter((m) => m !== old)
    if (old.memberOf !== -1 && !head.fleeing) {
      setMembers(old.memberOf, siblings.concat(head).sort(byGameId))
      head.memberOf = old.memberOf; head.pref = old.pref; head.offX = old.offX; head.offY = old.offY
    } else {
      if (old.memberOf !== -1) setMembers(old.memberOf, siblings)
      head.memberOf = -1; head.pref = undefined; head.offX = 0; head.offY = 0
    }
    if (!head.morale && old.morale) { head.morale = { ...old.morale }; head.routed = old.routed }
    for (let m_i = 0, m = rest[0]; m_i < rest.length; m = rest[++m_i]) {
      m.memberOf = head.gameId; m.pref = head; m.offX -= offX; m.offY -= offY
    }
    setMembers(head.gameId, [...(ctx.members.get(head.gameId) ?? []), ...rest].sort(byGameId))
    add('promote'); add('rel.MemberOf.remove'); add('rel.MemberOf.retarget', rest.length)
  }

  /** A dead unit counts for the other team, credits its killer and drops its first item. */
  const die = (u: Unit) => {
    if (u.kind !== KIND.MINION) world.kills[1 - u.team]++
    const killer = unitById.get(u.lastHitBy)
    if (killer) {
      killer.killCount++
      dirty.add(killer)
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
  }

  return (before: Unit[]) => {
    // A leaving unit is fleeing, alive, and on its home edge.
    const departing = before.filter((u) => u.dead || (u.fleeing && u.x === k.homeX(u.team)))
    add('q.cleanup.dead', departing.length)
    for (let u_i = 0, u = departing[0]; u_i < departing.length; u = departing[++u_i]) {
      if (u.destroyed) continue
      if (u.dead) die(u)
      else add('leave')
      begin('cleanup.cascade')
      for (const m of minionsOf(before, u.gameId)) if (!m.destroyed) destroy(m)
      end('cleanup.cascade')
      begin('links')
      promote(before, u)
      end('links')
      destroy(u)
    }
  }
}

/** A minion that reached its lifetime is destroyed. */
const expireMinionsStep = (ctx: Ctx) => {
  const { k, begin, end } = ctx
  const destroy = destroyUnit(ctx)
  // Without the inverse index, every destroyed unit needs the scan, also an old minion that has no minions.
  const cascadeByScan = (before: Unit[], u: Unit) => {
    for (const m of before.filter((x) => x.childOf === u.gameId)) if (!m.destroyed) destroy(m)
  }
  const cascadeByIndex = () => {}
  const cascade = ctx.isNaive('cleanup.cascade') ? cascadeByScan : cascadeByIndex
  return (before: Unit[]) => {
    for (let u_i = 0, u = before[0]; u_i < before.length; u = before[++u_i]) {
      if (u.kind !== k.KIND.MINION || u.age < k.MINION_LIFETIME || u.destroyed) continue
      begin('cleanup.cascade')
      cascade(before, u)
      end('cleanup.cascade')
      destroy(u)
    }
  }
}

/** Takes the destroyed units out of every index and out of `ctx.units`. Returns how many there were. */
const churnUnitsStep = (ctx: Ctx) => {
  const { add, begin, end, unitById } = ctx
  const gridRemoveByCheck = (u: Unit) => { if (!u.garrison) ctx.grid.remove(u.h) }
  const gridRemoveAlways = (u: Unit) => ctx.grid.remove(u.h)
  // The naive garrison code leaves a garrisoned unit in the kernel grid, so it has to take it out here.
  const removeFromGrid = ctx.isNaive('garrison') ? gridRemoveAlways : gridRemoveByCheck

  const release = (u: Unit) => {
    unitById.delete(u.gameId); ctx.freeSlots.push(u.h)
    dropMember(ctx, u)
    removeFromGrid(u)
    if (u.garrison) { const list = u.garrison.garrison; list.splice(list.indexOf(u), 1); add('rel.GarrisonOf.destroyDrop') }
    ctx.buffed.delete(u); ctx.threatened.delete(u); ctx.veterans.delete(u)
    if (u.childOf !== -1) {
      const list = ctx.minionsOf.get(u.childOf)
      const i = list ? list.indexOf(u) : -1
      if (i !== -1) list!.splice(i, 1)
    }
    ctx.minionsOf.delete(u.gameId)
  }

  const dropWithFilter = (before: Unit[]): number => {
    let gone = 0
    for (let u_i = 0, u = before[0]; u_i < before.length; u = before[++u_i]) if (u.destroyed) {
      gone++
      release(u)
    }
    ctx.units = gone === 0 ? before : before.filter((u) => !u.destroyed)
    return gone
  }
  // The naive code rebuilds the list after each unit that it releases.
  const dropOneByOne = (before: Unit[]): number => {
    let alive = before
    let gone = 0
    for (let u_i = 0, u = before[0]; u_i < before.length; u = before[++u_i]) if (u.destroyed) {
      gone++
      release(u)
      alive = alive.filter((x) => x !== u)
    }
    ctx.units = alive
    return gone
  }
  const drop = ctx.isNaive('churn') ? dropOneByOne : dropWithFilter
  return (before: Unit[]): number => {
    begin('churn')
    const gone = drop(before)
    end('churn')
    return gone
  }
}

/** Targets that pointed at a destroyed unit are dropped. */
const unlinkTargetsStep = (ctx: Ctx) => {
  const { add, begin, end, unitById } = ctx
  // retarget keeps the inverse index (targeters) in step, which combat.fanIn reads
  const unlinkByScan = (before: Unit[]) => {
    for (let u_i = 0, u = before[0]; u_i < before.length; u = before[++u_i]) if (u.destroyed && u.target !== -1) retarget(ctx, u, -1)
    const alive = ctx.units
    for (let u_i = 0, u = alive[0]; u_i < alive.length; u = alive[++u_i]) {
      if (u.target !== -1 && !unitById.has(u.target)) { retarget(ctx, u, -1); add('rel.Targets.remove') }
    }
  }
  const unlinkByIndex = (before: Unit[]) => {
    for (let u_i = 0, u = before[0]; u_i < before.length; u = before[++u_i]) if (u.destroyed) {
      const inbound = ctx.targeters.get(u.gameId)
      if (inbound) {
        for (const s of inbound) if (!s.destroyed && s.target === u.gameId) { s.target = -1; s.tref = undefined; add('rel.Targets.remove') }
        ctx.targeters.delete(u.gameId)
      }
      if (u.target !== -1) retarget(ctx, u, -1)
    }
  }
  const unlink = ctx.isNaive('cleanup.unlink') ? unlinkByScan : unlinkByIndex
  return (before: Unit[]) => {
    begin('cleanup.unlink')
    unlink(before)
    end('cleanup.unlink')
  }
}

/** Threat edges from a destroyed attacker are dropped. */
const purgeThreatStep = (ctx: Ctx) => {
  const { add, begin, end, unitById } = ctx
  const purge = (u: Unit) => {
    if (u.threat.length > 0) {
      const kept = u.threat.filter((e) => unitById.has(e.attacker))
      if (kept.length === u.threat.length) return
      add('rel.Threat.remove', u.threat.length - kept.length)
      u.threat = kept
    }
  }
  // Scan every unit for the edges of each destroyed attacker.
  const purgeByScan = (before: Unit[], alive: Unit[]) => {
    for (let d_i = 0, d = before[0]; d_i < before.length; d = before[++d_i]) if (d.destroyed) {
      for (let u_i = 0, u = alive[0]; u_i < alive.length; u = alive[++u_i]) {
        if (u.threat.length === 0 || !u.threat.some((e) => e.attacker === d.gameId)) continue
        add('rel.Threat.remove')
        u.threat = u.threat.filter((e) => e.attacker !== d.gameId)
      }
    }
  }
  // Edges only go stale when a unit was destroyed.
  const purgeByIndex = (_before: Unit[], _alive: Unit[], gone: number) => {
    if (gone > 0) for (const u of ctx.threatened) { purge(u); if (u.threat.length === 0) ctx.threatened.delete(u) }
  }
  const purgeAll = ctx.isNaive('threat') ? purgeByScan : purgeByIndex
  return (before: Unit[], alive: Unit[], gone: number) => {
    begin('threat')
    purgeAll(before, alive, gone)
    end('threat')
  }
}

/** Projectiles that hit, lost their target or got old are removed. */
const churnProjectilesStep = (ctx: Ctx) => {
  const { k, add, begin, end, unitById } = ctx
  const isDone = (p: Projectile) => p.spent || !unitById.has(p.target) || p.age >= k.PROJECTILE_LIFETIME
  const dropOneByOne = () => {
    for (const p of ctx.projectiles.filter(isDone)) ctx.projectiles = ctx.projectiles.filter((x) => x !== p)
  }
  // Compact in place, nothing is allocated.
  const dropInPlace = () => {
    const ps = ctx.projectiles
    let w = 0
    for (let p_i = 0, p = ps[0]; p_i < ps.length; p = ps[++p_i]) if (!isDone(p)) ps[w++] = p
    ps.length = w
  }
  const drop = ctx.isNaive('churn') ? dropOneByOne : dropInPlace
  return () => {
    begin('churn')
    const projBefore = ctx.projectiles.length
    drop()
    add('destroy.projectile', projBefore - ctx.projectiles.length)
    end('churn')
  }
}

/** Pickup, in gameId order. Items taken here count toward the cap of later items. */
const pickupStep = (ctx: Ctx) => {
  const { k, add, dirty } = ctx
  const resendGrid = resendGridFor(ctx)
  const hasRoom = (h: number) => { const v = ctx.slots[h]; return v.items.length < k.MAX_ITEMS && !v.garrison }
  return () => {
    add('q.cleanup.groundItems', ctx.groundItems.length)
    if (ctx.groundItems.length === 0) return
    resendGrid()
    ctx.groundItems.sort(byGameId)
    ctx.groundItems = ctx.groundItems.filter((g) => {
      const h = ctx.grid.nearest(g.x, g.y, k.PICKUP_RANGE, hasRoom, 'pickup')
      if (h === -1) return true
      const taker = ctx.slots[h]
      add('item.pickup'); add('rel.Equips.add'); dirty.add(taker)
      taker.items.push({ gameId: g.gameId, kind: g.kind, quality: g.quality })
      taker.items.sort(byGameId)
      taker.itemMask |= 1 << g.kind
      return false
    })
  }
}

const expireGroundStep = (ctx: Ctx) => {
  const { k, add, begin, end } = ctx
  return () => {
    begin('churn')
    const gBefore = ctx.groundItems.length
    ctx.groundItems = ctx.groundItems.filter((g) => g.age < k.GROUND_ITEM_LIFETIME)
    add('destroy.groundItem', gBefore - ctx.groundItems.length)
    end('churn')
  }
}
