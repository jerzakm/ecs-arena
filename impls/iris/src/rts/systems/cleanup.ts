import {
  addComponent, addComponents, collectEntities, defineSystem, destroyEntity, type EntityId, getComponent, getComponentValue,
  getResourceValue, hasComponent, isEntityAlive, removeComponent, removeComponents, setComponent, setComponentValue, setResourceValue,
} from 'iris-ecs'
import { GameId } from '../../shared/components.ts'
import { byGameId, sortedByGameId } from '../../shared/util.ts'
import {
  Age, Chronicle, Dead, Equips, Fleeing, Ground, ItemKind, ItemTags, KillCount, Kind, LastHitBy, MemberOf, Metrics, Morale, Position,
  Routed, Spent, Targets, Team, Veteran,
} from '../components.ts'
import type { Ctx } from '../context.ts'
import { targetOf } from '../links.ts'
import { doneProjectiles, groundAged, homebound, members, oldMinions } from '../queries.ts'

export const cleanupSystem = (ctx: Ctx) => {
  const { k, world } = ctx
  const { KIND } = k
  const hasRoom = (h: number) => getComponentValue(world, ctx.units.entityAt[h], Equips, 'items')!.length < 2 * k.MAX_ITEMS

  return defineSystem('cleanup', () => {
    const kills = [0, 0]

    // The members of each leader, from one scan of the `MemberOf` wildcard. A query for each leader would cache one query for each unit.
    let kids: Map<EntityId, EntityId[]> | undefined
    const membersOf = (unit: EntityId) => {
      if (!kids) {
        kids = new Map()
        for (const m of collectEntities(world, members)) {
          const parent = targetOf(ctx, m, MemberOf)
          if (parent === undefined) continue
          const list = kids.get(parent)
          if (list) list.push(m)
          else kids.set(parent, [m])
        }
      }
      return (kids.get(unit) ?? []).filter((m) => isEntityAlive(world, m) && targetOf(ctx, m, MemberOf) === unit)
    }
    const adopt = (parent: EntityId, m: EntityId) => {
      const list = kids!.get(parent)
      if (list) list.push(m)
      else kids!.set(parent, [m])
    }

    const promote = (unit: EntityId) => {
      const list = membersOf(unit).map((m) => ({ id: getComponentValue(world, m, GameId, 'id')!, e: m })).sort(byGameId)
      if (list.length === 0) return
      const [{ e: head }, ...rest] = list
      const headX = getComponentValue(world, head, MemberOf, 'offsetX')!, headY = getComponentValue(world, head, MemberOf, 'offsetY')!
      const parent = targetOf(ctx, unit, MemberOf)
      removeComponent(world, head, MemberOf)
      if (parent !== undefined && !hasComponent(world, head, Fleeing)) {
        addComponent(world, head, MemberOf, {
          to: getComponentValue(world, parent, GameId, 'id')!,
          offsetX: getComponentValue(world, unit, MemberOf, 'offsetX')!,
          offsetY: getComponentValue(world, unit, MemberOf, 'offsetY')!,
        })
        adopt(parent, head)
      }
      if (!hasComponent(world, head, Morale) && hasComponent(world, unit, Morale)) {
        addComponent(world, head, Morale, getComponent(world, unit, Morale)!)
        if (hasComponent(world, unit, Routed)) addComponent(world, head, Routed)
      }
      for (const { e: m } of rest) {
        setComponent(world, m, MemberOf, {
          to: getComponentValue(world, head, GameId, 'id')!,
          offsetX: getComponentValue(world, m, MemberOf, 'offsetX')! - headX,
          offsetY: getComponentValue(world, m, MemberOf, 'offsetY')! - headY,
        })
        adopt(head, m)
      }
    }

    const leaving = sortedByGameId(world, Dead)
    for (const e of collectEntities(world, homebound)) {
      const home = k.homeX(getComponentValue(world, e, Team, 'value'))
      if (getComponentValue(world, e, Position, 'x') === home) leaving.push({ id: getComponentValue(world, e, GameId, 'id'), e })
    }
    leaving.sort(byGameId)

    for (const { e } of leaving) {
      if (!isEntityAlive(world, e)) continue
      if (hasComponent(world, e, Dead)) {
        if (getComponentValue(world, e, Kind, 'value')! !== KIND.MINION) kills[1 - getComponentValue(world, e, Team, 'value')!]++
        const killer = targetOf(ctx, e, LastHitBy)
        if (killer !== undefined) {
          setComponentValue(world, killer, KillCount, 'value', getComponentValue(world, killer, KillCount, 'value')! + 1)
          if (hasComponent(world, killer, Veteran)) {
            const chronicle = getComponentValue(world, killer, Chronicle, 'kinds')!
            chronicle.push(getComponentValue(world, e, Kind, 'value')!)
            if (chronicle.length > k.CHRONICLE_MAX) chronicle.shift()
          }
        }
        const held = getComponentValue(world, e, Equips, 'items')!
        let slot = -1, firstId = 0
        for (let i = 0; i < held.length; i += 2) {
          const id = held[i]
          if (slot < 0 || id < firstId) { slot = i; firstId = id }
        }
        if (slot >= 0) {
          const first = ctx.entityOf.get(held[slot])!, quality = held[slot + 1]
          held.splice(slot, 2)
          const { x, y } = getComponent(world, e, Position)!
          addComponents(world, first, [[Ground, { quality }], [Position, { x, y }], [Age, { value: 0 }]])
        }
      }
      promote(e)
      // The items are gameIds in a list, not relation targets, so the remaining items go here.
      // `ChildOf` carries `onDeleteTarget: 'delete'`, so the minions of the unit go with it.
      const held = getComponentValue(world, e, Equips, 'items')!
      for (let i = 0; i < held.length; i += 2) destroyEntity(world, ctx.entityOf.get(held[i])!)
      destroyEntity(world, e)
    }

    for (const e of collectEntities(world, oldMinions)) {
      if (isEntityAlive(world, e) && getComponentValue(world, e, Age, 'value') >= k.MINION_LIFETIME) destroyEntity(world, e)
    }

    for (const e of collectEntities(world, doneProjectiles)) {
      const expired = getComponentValue(world, e, Age, 'value') >= k.PROJECTILE_LIFETIME
      if (hasComponent(world, e, Spent) || targetOf(ctx, e, Targets) === undefined || expired) destroyEntity(world, e)
    }

    const ground = sortedByGameId(world, Ground)
    for (const g of ground) {
      const gx = getComponentValue(world, g.e, Position, 'x')!, gy = getComponentValue(world, g.e, Position, 'y')!
      const h = ctx.units.grid.nearest(gx, gy, k.PICKUP_RANGE, hasRoom)
      if (h === -1) continue
      const quality = getComponentValue(world, g.e, Ground, 'quality')!
      const taker = ctx.units.entityAt[h]
      getComponentValue(world, taker, Equips, 'items')!.push(g.id, quality)
      ctx.dirty.add(taker)
      addComponent(world, taker, ItemTags[getComponentValue(world, g.e, ItemKind, 'value')!])
      removeComponents(world, g.e, [Ground, Position, Age])
    }

    for (const e of collectEntities(world, groundAged)) {
      if (getComponentValue(world, e, Age, 'value') >= k.GROUND_ITEM_LIFETIME) destroyEntity(world, e)
    }

    setResourceValue(world, Metrics, 'kills0', getResourceValue(world, Metrics, 'kills0')! + kills[0])
    setResourceValue(world, Metrics, 'kills1', getResourceValue(world, Metrics, 'kills1')! + kills[1])
  })
}
