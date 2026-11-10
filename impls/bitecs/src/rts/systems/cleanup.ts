import { addComponent, addComponents, entityExists, hasComponent, query, removeComponent, setComponent } from 'bitecs'
import type { Ctx } from '../context.ts'
import {
  Age, Chronicle, Dead, Fleeing, Ground, ItemKind, ItemTags, KillCount, Kind, Morale, Position, Routed, Spent, Team, Veteran,
} from '../components.ts'
import { GameId } from '../../shared/components.ts'
import { destroyEntity, equip } from '../entities.ts'
import { Q } from '../queries.ts'
import { clearLink, Equips, itemCount, LastHitBy, MemberOf, setLink, Targets } from '../relations.ts'
import { byGameId, sortedByGameId } from '../../shared/util.ts'
import { sweepDestroyed } from '../workarounds.ts'

const promote = (ctx: Ctx, unit: number) => {
  const { world } = ctx
  const members = (MemberOf.from[unit] ?? []).slice().sort(byGameId)
  if (members.length === 0) return
  const [head, ...rest] = members
  const { offsetX, offsetY } = MemberOf
  const headX = offsetX[head], headY = offsetY[head]
  const parent = MemberOf.to[unit]
  const toParent = parent !== -1 ? { x: offsetX[unit], y: offsetY[unit] } : undefined
  const restOffsets = rest.map((m) => ({ m, x: offsetX[m], y: offsetY[m] }))
  clearLink(head, MemberOf)
  if (parent !== -1 && !hasComponent(world, head, Fleeing)) {
    setLink(head, MemberOf, parent)
    offsetX[head] = toParent!.x; offsetY[head] = toParent!.y
  }
  if (!hasComponent(world, head, Morale) && hasComponent(world, unit, Morale)) {
    addComponent(world, head, Morale)
    Morale.size0[head] = Morale.size0[unit]; Morale.lost[head] = Morale.lost[unit]
    if (hasComponent(world, unit, Routed)) addComponent(world, head, Routed)
  }
  for (const { m, x, y } of restOffsets) {
    setLink(m, MemberOf, head)
    offsetX[m] = x - headX; offsetY[m] = y - headY
  }
}

export const cleanupSystem = (ctx: Ctx) => {
  const { k, world } = ctx
  const { KIND, homeX } = k
  const hasRoom = (h: number) => itemCount(h) < k.MAX_ITEMS

  return () => {
    const kills = [0, 0]

    const leaving = sortedByGameId(ctx, Q.dead)
    for (const e of query(world, Q.home)) if (Position.x[e] === homeX(Team.value[e])) leaving.push(e)
    leaving.sort(byGameId)

    for (const e of leaving) {
      if (!entityExists(world, e)) continue // a minion cascade can have removed it
      if (hasComponent(world, e, Dead)) {
        if (Kind.value[e] !== KIND.MINION) kills[1 - Team.value[e]]++
        const killer = LastHitBy.to[e]
        if (killer !== -1 && entityExists(world, killer)) { // a killer removed earlier in this loop is not swept yet
          setComponent(world, killer, KillCount, { value: KillCount.value[killer] + 1 })
          if (hasComponent(world, killer, Veteran)) {
            const n = Chronicle.n[killer], log = Chronicle.kinds[killer]
            if (n === k.CHRONICLE_MAX) { log.copyWithin(0, 1); log[n - 1] = Kind.value[e] }
            else { log[n] = Kind.value[e]; Chronicle.n[killer] = n + 1 }
          }
        }
        const held = Equips.items[e]
        if (held?.length) {
          let at = 0
          for (let i = 1; i < held.length; i++) if (GameId.id[held[i]] < GameId.id[held[at]]) at = i
          const first = held[at], quality = Equips.quality[e][at]
          held.splice(at, 1); Equips.quality[e].splice(at, 1)
          addComponents(world, first, [Ground, Position, Age])
          Ground.quality[first] = quality
          Position.x[first] = Position.x[e]; Position.y[first] = Position.y[e]
          Age.value[first] = 0
        }
      }
      promote(ctx, e)
      // The remaining items and the linked minions go with the unit.
      destroyEntity(ctx, e)
    }

    for (const e of Array.from(query(world, Q.agedMinions))) if (Age.value[e] >= k.MINION_LIFETIME) destroyEntity(ctx, e)

    sweepDestroyed(ctx)

    const doneProjectiles: number[] = []
    for (const e of query(world, Q.agedProjectiles)) {
      if (hasComponent(world, e, Spent) || Targets.to[e] === -1 || Age.value[e] >= k.PROJECTILE_LIFETIME) doneProjectiles.push(e)
    }
    for (const e of doneProjectiles) destroyEntity(ctx, e)

    const ground = sortedByGameId(ctx, Q.ground)
    for (const g of ground) {
      const h = ctx.grid.nearest(Position.x[g], Position.y[g], k.PICKUP_RANGE, hasRoom)
      if (h === -1) continue
      equip(ctx, h, g, Ground.quality[g])
      const tag = ItemTags[ItemKind.value[g]]
      addComponent(world, h, tag)
      ctx.dirty.add(h)
      removeComponent(world, g, Ground, Position, Age)
    }

    const old: number[] = []
    for (const e of query(world, Q.ground)) if (Age.value[e] >= k.GROUND_ITEM_LIFETIME) old.push(e)
    for (const e of old) destroyEntity(ctx, e)

    world.metrics.kills0 += kills[0]
    world.metrics.kills1 += kills[1]
  }
}
