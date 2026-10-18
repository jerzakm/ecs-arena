import {
  addComponent, addComponents, collectEntities, defineSystem, destroyEntity, getComponent, hasComponent, isEntityAlive, not, removeComponent, removeComponents, setComponent,
  type EntityId,
} from 'iris-ecs'
import { byGameId, type Context } from '../context.ts'
import { Age, Chronicle, Dead, Fleeing, GameId, Ground, ItemKind, ItemTags, KillCount, Kind, LastHitBy, MemberOf, Metrics, Morale, Position, Routed, Spent, Targets, Team, Veteran } from '../components.ts'
import { doneProjectiles, groundAged, members, oldMinions } from '../queries.ts'

export const cleanupSystem = (ctx: Context) => {
  const { k, world, gid, get, set, homeX, sortedByGameId } = ctx
  const { KIND } = k
  const has = (e: EntityId, c: EntityId) => hasComponent(world, e, c)
  const hasRoom = (h: number) => ctx.equipsOf(ctx.unitAt[h]).length < 2 * k.MAX_ITEMS

  return defineSystem('cleanup', () => {
    const kills = [0, 0]

    // The members of each leader, from one scan of the `MemberOf` wildcard. A query for each leader would cache one query for each unit.
    let kids: Map<EntityId, EntityId[]> | undefined
    const membersOf = (unit: EntityId) => {
      if (!kids) {
        kids = new Map()
        for (const m of collectEntities(world, members)) {
          const parent = ctx.targetOf(m, MemberOf)
          if (parent === undefined) continue
          const list = kids.get(parent)
          if (list) list.push(m)
          else kids.set(parent, [m])
        }
      }
      return (kids.get(unit) ?? []).filter((m) => isEntityAlive(world, m) && ctx.targetOf(m, MemberOf) === unit)
    }
    const adopt = (parent: EntityId, m: EntityId) => {
      const list = kids!.get(parent)
      if (list) list.push(m)
      else kids!.set(parent, [m])
    }

    const promote = (unit: EntityId) => {
      const list = membersOf(unit).map((m) => ({ id: gid(m), e: m })).sort(byGameId)
      if (list.length === 0) return
      const [{ e: head }, ...rest] = list
      const headX = get(head, MemberOf, 'offsetX'), headY = get(head, MemberOf, 'offsetY')
      const parent = ctx.targetOf(unit, MemberOf)
      removeComponent(world, head, MemberOf)
      if (parent !== undefined && !has(head, Fleeing)) {
        addComponent(world, head, MemberOf, { to: gid(parent), offsetX: get(unit, MemberOf, 'offsetX'), offsetY: get(unit, MemberOf, 'offsetY') })
        adopt(parent, head)
      }
      if (!has(head, Morale) && has(unit, Morale)) {
        addComponent(world, head, Morale, getComponent(world, unit, Morale)!)
        if (has(unit, Routed)) addComponent(world, head, Routed)
      }
      for (const { e: m } of rest) {
        setComponent(world, m, MemberOf, { to: gid(head), offsetX: get(m, MemberOf, 'offsetX') - headX, offsetY: get(m, MemberOf, 'offsetY') - headY })
        adopt(head, m)
      }
    }

    const leaving = sortedByGameId(Dead)
    for (const e of collectEntities(world, [Fleeing, GameId, Position, Team, not(Dead)])) {
      if (get(e, Position, 'x') === homeX(get(e, Team, 'value'))) leaving.push({ id: gid(e), e })
    }
    leaving.sort(byGameId)

    for (const { e } of leaving) {
      if (!isEntityAlive(world, e)) continue
      if (has(e, Dead)) {
        if (get(e, Kind, 'value') !== KIND.MINION) kills[1 - get(e, Team, 'value')]++
        const killer = ctx.targetOf(e, LastHitBy)
        if (killer !== undefined) {
          set(killer, KillCount, 'value', get(killer, KillCount, 'value') + 1)
          if (has(killer, Veteran)) {
            const chronicle = get(killer, Chronicle, 'kinds')
            chronicle.push(get(e, Kind, 'value'))
            if (chronicle.length > k.CHRONICLE_MAX) chronicle.shift()
          }
        }
        const held = ctx.equipsOf(e)
        let slot = -1, firstId = 0
        for (let i = 0; i < held.length; i += 2) {
          const id = held[i]
          if (slot < 0 || id < firstId) { slot = i; firstId = id }
        }
        if (slot >= 0) {
          const first = ctx.entityOf.get(held[slot])!, quality = held[slot + 1]
          held.splice(slot, 2)
          addComponents(world, first, [[Ground, { quality }], [Position, { x: get(e, Position, 'x'), y: get(e, Position, 'y') }], [Age, { value: 0 }]])
        }
      }
      promote(e)
      // The items are gameIds in a list, not relation targets, so the remaining items go here.
      // `ChildOf` carries `onDeleteTarget: 'delete'`, so the minions of the unit go with it.
      const held = ctx.equipsOf(e)
      for (let i = 0; i < held.length; i += 2) destroyEntity(world, ctx.entityOf.get(held[i])!)
      destroyEntity(world, e)
    }

    for (const e of collectEntities(world, oldMinions)) {
      if (isEntityAlive(world, e) && get(e, Age, 'value') >= k.MINION_LIFETIME) destroyEntity(world, e)
    }

    for (const e of collectEntities(world, doneProjectiles)) {
      if (has(e, Spent) || ctx.targetOf(e, Targets) === undefined || get(e, Age, 'value') >= k.PROJECTILE_LIFETIME) destroyEntity(world, e)
    }

    const ground = sortedByGameId(Ground)
    for (const g of ground) {
      const gx = get(g.e, Position, 'x'), gy = get(g.e, Position, 'y')
      const h = ctx.grid.nearest(gx, gy, k.PICKUP_RANGE, hasRoom)
      if (h === -1) continue
      const quality = get(g.e, Ground, 'quality')
      const taker = ctx.unitAt[h]
      ctx.equipsOf(taker).push(g.id, quality)
      ctx.dirty.add(taker)
      addComponent(world, taker, ItemTags[get(g.e, ItemKind, 'value')])
      removeComponents(world, g.e, [Ground, Position, Age])
    }

    for (const e of collectEntities(world, groundAged)) {
      if (get(e, Age, 'value') >= k.GROUND_ITEM_LIFETIME) destroyEntity(world, e)
    }

    ctx.setRes(Metrics, 'kills0', ctx.res(Metrics, 'kills0') + kills[0])
    ctx.setRes(Metrics, 'kills1', ctx.res(Metrics, 'kills1') + kills[1])
  })
}
