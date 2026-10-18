import { addComponent, addComponents, addEntity, entityExists, hasComponent, query, removeEntity } from 'bitecs'
import type { Context } from './context.ts'
import {
  Age, CAP, Cooldown, GameId, Health, Item, ItemKind, ItemTags, KillCount, Kind, Minion, Morale, Position, Start, Stats, Summoner, Team, Trail, Unit,
} from './components.ts'
import { ChildOf, clearLink, clearThreat, Equips, FiredBy, GarrisonOf, LastHitBy, LINKS, MemberOf, offsetX, offsetY, setLink, Targets, Threat } from './relations.ts'
import { bannerAtSpawn, recomputeStats } from './derived-stats.ts'

const REVERSE_LINKS = [ChildOf, MemberOf, GarrisonOf]
const CLEARED_LINKS = [Targets, LastHitBy, FiredBy]

/** Allocates an entity. bitECS recycles ids at once, so the mirrors that an old entity left in this slot are cleared. */
export const newEntity = (ctx: Context): number => {
  const e = addEntity(ctx.world)
  if (e >= CAP) throw new Error(`entity id ${e} is over the store capacity ${CAP}`)
  for (const l of LINKS) l.to[e] = -1
  if (Equips.items[e]) Equips.items[e].length = Equips.quality[e].length = 0
  clearThreat(e)
  ctx.inGrid[e] = 0
  return e
}

export const equip = (ctx: Context, unit: number, item: number, quality: number) => {
  const items = (Equips.items[unit] ??= []), qualities = (Equips.quality[unit] ??= [])
  items.push(item); qualities.push(quality)
}

/**
 * Removes the entity, the minions that are linked to it (ChildOf) and the items it holds. Plain components cannot cascade, so this does it.
 * Links that name the entity from other entities are cleared by `sweepDestroyed`, once for all entities removed in a phase.
 */
export const destroyEntity = (ctx: Context, e: number) => {
  const { world } = ctx
  if (!entityExists(world, e)) return
  for (const minion of ChildOf.from![e]?.slice() ?? []) destroyEntity(ctx, minion)
  for (const l of REVERSE_LINKS) {
    clearLink(e, l)
    for (const s of l.from![e] ?? []) l.to[s] = -1
    if (l.from![e]) l.from![e].length = 0
  }
  const items = Equips.items[e] ?? []
  if (hasComponent(world, e, Unit)) ctx.destroyed.add(e) // only units are the target of a link or a threat
  removeEntity(world, e)
  for (const item of items) removeEntity(world, item)
}

/** Clears the links and threats that name a removed entity. Ids are recycled at once, so this runs before the next spawn. */
export const sweepDestroyed = (ctx: Context) => {
  const { destroyed, world } = ctx
  if (destroyed.size === 0) return
  for (const e of query(world, [GameId])) {
    for (const l of CLEARED_LINKS) if (l.to[e] !== -1 && destroyed.has(l.to[e])) l.to[e] = -1
    const attackers = Threat.attackers[e]
    if (attackers?.length) {
      const values = Threat.amount[e]
      for (let i = attackers.length - 1; i >= 0; i--) if (destroyed.has(attackers[i])) { attackers.splice(i, 1); values.splice(i, 1) }
    }
  }
  destroyed.clear()
}

export const spawnUnit = (ctx: Context, team: number, kind: number, x: number, y: number): number => {
  const { k, world, scenario } = ctx
  const { seed } = scenario
  const tick = world.clock
  const id = ctx.nextId()
  const maxHp = k.UNIT_STATS[kind].maxHp
  const px = k.clampToArena(x), py = k.clampToArena(y)
  const e = newEntity(ctx)
  addComponents(world, e, [Unit, GameId, Team, Kind, Position, Start, Health, Stats, Cooldown, KillCount, Trail])
  GameId.id[e] = id; Team.value[e] = team; Kind.value[e] = kind
  Position.x[e] = Start.x[e] = px; Position.y[e] = Start.y[e] = py
  Health.hp[e] = Health.maxHp[e] = maxHp
  Stats.attack[e] = Stats.armor[e] = Stats.speed[e] = 0
  Cooldown.value[e] = 0; KillCount.value[e] = 0
  Trail.n[e] = 0; (Trail.pts[e] ??= new Int32Array(2 * k.TRAIL_POINTS))
  ctx.grid.add(e, id, px, py)
  ctx.inGrid[e] = 1
  ctx.unitById.set(id, e)
  if (kind === k.KIND.SUMMONER) { addComponent(world, e, Summoner); Summoner.lastSummon[e] = tick }
  if (kind === k.KIND.MINION) { addComponents(world, e, [Minion, Age]); Age.value[e] = 0 }
  else {
    const count = k.randInt(4, seed, tick, id, k.PURPOSE.ITEM_COUNT)
    for (let i = 0; i < count; i++) {
      const kindOfItem = k.randInt(8, seed, tick, id, k.PURPOSE.ITEM_KIND, i)
      const item = newEntity(ctx)
      addComponents(world, item, [Item, GameId, ItemKind])
      GameId.id[item] = ctx.nextId(); ItemKind.value[item] = kindOfItem
      equip(ctx, e, item, 1 + k.randInt(3, seed, tick, id, k.PURPOSE.ITEM_QUALITY, i))
      if (!hasComponent(world, e, ItemTags[kindOfItem])) addComponent(world, e, ItemTags[kindOfItem])
    }
  }
  recomputeStats(ctx, e)
  return e
}

const spawnWarlord = (ctx: Context, team: number, warband: number, yPurpose: number) => {
  const { k, scenario } = ctx
  const { seed } = scenario
  const tick = ctx.world.clock
  const facing = team === 0 ? 1 : -1
  const y = k.SPAWN_Y_MIN + k.randInt(k.SPAWN_Y_RANGE, seed, tick, k.teamGameId(team), yPurpose, warband) * k.FX
  return spawnUnit(ctx, team, k.KIND.WARLORD, k.SPAWN_X[team] + facing * k.WARLORD_SPAWN_GAP, y)
}

const spawnSquad = (ctx: Context, team: number, squadIndex: number, place: number, warlord: number, kindPurpose: number) => {
  const { k, scenario, world } = ctx
  const { seed } = scenario
  const tick = world.clock
  const squad = k.SQUADS[k.randInt(4, seed, tick, k.teamGameId(team), kindPurpose, squadIndex)]
  const facing = team === 0 ? 1 : -1
  const leaderOffsetX = -facing * k.LEADER_SLOT_SPACING
  const leaderOffsetY = (2 * place - 3) * k.LEADER_SLOT_SPACING
  const leader = spawnUnit(ctx, team, squad.leader, Position.x[warlord] + leaderOffsetX, Position.y[warlord] + leaderOffsetY)
  setLink(leader, MemberOf, warlord)
  offsetX[leader] = leaderOffsetX; offsetY[leader] = leaderOffsetY
  addComponent(world, leader, Morale)
  Morale.size0[leader] = 1 + squad.members.length; Morale.lost[leader] = 0
  bannerAtSpawn(ctx, leader, warlord)
  squad.members.forEach((kind, i) => {
    const ox = -facing * (1 + k.fx.div(i, 3)) * k.FORMATION_SPACING
    const oy = ((i % 3) - 1) * k.FORMATION_SPACING
    const m = spawnUnit(ctx, team, kind, Position.x[leader] + ox, Position.y[leader] + oy)
    setLink(m, MemberOf, leader)
    offsetX[m] = ox; offsetY[m] = oy
    bannerAtSpawn(ctx, m, leader)
  })
  return 1 + squad.members.length
}

export const spawnSquads = (ctx: Context, team: number, maxSquads: number, popCap: number, kindPurpose: number, yPurpose: number) => {
  const { k } = ctx
  let alive = ctx.aliveCount(team)
  let warlord = -1
  for (let s = 0; s < maxSquads && alive < popCap; s++) {
    const place = s % k.SQUADS_PER_WARBAND
    if (place === 0) {
      warlord = spawnWarlord(ctx, team, k.fx.div(s, k.SQUADS_PER_WARBAND), yPurpose)
      alive++
    }
    alive += spawnSquad(ctx, team, s, place, warlord, kindPurpose)
  }
}
