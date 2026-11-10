import {
  addComponent, addComponents, collectEntities, createEntity, type EntityId, getComponentValue, getResourceValue, setResourceValue,
} from 'iris-ecs'
import { GameId } from '../shared/components.ts'
import {
  Age, Clock, Cooldown, Equips, Health, Item, ItemKind, ItemTags, KillCount, Kind, LastHitBy, MemberOf, Minion, Morale, NextId, Position,
  Start, Stats, Summoner, Targets, Team, Threat, Trail, Unit,
} from './components.ts'
import type { Ctx } from './context.ts'
import { bannerAtSpawn, recomputeStats } from './derived-stats.ts'
import { teamQuery } from './queries.ts'

/** Takes the next gameId (SPEC §5.6). */
export const nextId = (ctx: Ctx): number => {
  const id = getResourceValue(ctx.world, NextId, 'value')!
  setResourceValue(ctx.world, NextId, 'value', id + 1)
  return id
}

export const aliveCount = (ctx: Ctx, team: number): number => {
  let n = 0
  for (const e of collectEntities(ctx.world, teamQuery)) if (getComponentValue(ctx.world, e, Team, 'value') === team) n++
  return n
}

export const spawnUnit = (ctx: Ctx, team: number, kind: number, x: number, y: number): EntityId => {
  const { k, world, scenario } = ctx
  const { seed } = scenario
  const tick = getResourceValue(world, Clock, 'tick')!
  const id = nextId(ctx)
  const maxHp = k.UNIT_STATS[kind].maxHp
  const px = k.clampToArena(x), py = k.clampToArena(y)
  const e = createEntity(world, [
    Unit, [GameId, { id }], [Team, { value: team }], [Kind, { value: kind }],
    [Position, { x: px, y: py }], [Start, { x: px, y: py }], [Health, { hp: maxHp, maxHp }],
    [Stats, { attack: 0, armor: 0, speed: 0 }], [Cooldown, { value: 0 }], [KillCount, { value: 0 }], [Trail, { pts: [] }],
    [Targets, { to: 0 }], [LastHitBy, { to: 0 }], [Threat, { edges: [] }], [Equips, { items: [] }],
  ])
  ctx.units.track(e, id, team, px, py)
  if (kind === k.KIND.SUMMONER) addComponent(world, e, Summoner, { lastSummon: tick })
  if (kind === k.KIND.MINION) addComponents(world, e, [Minion, [Age, { value: 0 }]])
  else {
    const count = k.randInt(4, seed, tick, id, k.PURPOSE.ITEM_COUNT)
    const tags = new Set<(typeof ItemTags)[number]>()
    for (let i = 0; i < count; i++) {
      const kindOfItem = k.randInt(8, seed, tick, id, k.PURPOSE.ITEM_KIND, i)
      const itemId = nextId(ctx)
      createEntity(world, [Item, [GameId, { id: itemId }], [ItemKind, { value: kindOfItem }]])
      getComponentValue(world, e, Equips, 'items').push(itemId, 1 + k.randInt(3, seed, tick, id, k.PURPOSE.ITEM_QUALITY, i))
      tags.add(ItemTags[kindOfItem])
    }
    if (tags.size > 0) addComponents(world, e, [...tags])
  }
  recomputeStats(ctx, e)
  return e
}

const spawnWarlord = (ctx: Ctx, team: number, warband: number, yPurpose: number) => {
  const { k, world, scenario } = ctx
  const { seed } = scenario
  const tick = getResourceValue(world, Clock, 'tick')!
  const facing = team === 0 ? 1 : -1
  const y = k.SPAWN_Y_MIN + k.randInt(k.SPAWN_Y_RANGE, seed, tick, k.teamGameId(team), yPurpose, warband) * k.FX
  return spawnUnit(ctx, team, k.KIND.WARLORD, k.SPAWN_X[team] + facing * k.WARLORD_SPAWN_GAP, y)
}

const spawnSquad = (ctx: Ctx, team: number, squadIndex: number, place: number, warlord: EntityId, kindPurpose: number) => {
  const { k, world, scenario } = ctx
  const { seed } = scenario
  const tick = getResourceValue(world, Clock, 'tick')!
  const squad = k.SQUADS[k.randInt(4, seed, tick, k.teamGameId(team), kindPurpose, squadIndex)]
  const facing = team === 0 ? 1 : -1
  const wx = getComponentValue(world, warlord, Position, 'x')!, wy = getComponentValue(world, warlord, Position, 'y')!
  const leaderOffsetX = -facing * k.LEADER_SLOT_SPACING
  const leaderOffsetY = (2 * place - 3) * k.LEADER_SLOT_SPACING
  const leader = spawnUnit(ctx, team, squad.leader, wx + leaderOffsetX, wy + leaderOffsetY)
  const offset = { offsetX: leaderOffsetX, offsetY: leaderOffsetY }
  const warlordId = getComponentValue(world, warlord, GameId, 'id')!
  addComponents(world, leader, [[MemberOf, { to: warlordId, ...offset }], [Morale, { size0: 1 + squad.members.length, lost: 0 }]])
  bannerAtSpawn(ctx, leader, warlord)
  const lx = getComponentValue(world, leader, Position, 'x')!, ly = getComponentValue(world, leader, Position, 'y')!
  squad.members.forEach((kind, i) => {
    const offsetX = -facing * (1 + k.fx.div(i, 3)) * k.FORMATION_SPACING
    const offsetY = ((i % 3) - 1) * k.FORMATION_SPACING
    const m = spawnUnit(ctx, team, kind, lx + offsetX, ly + offsetY)
    addComponent(world, m, MemberOf, { to: getComponentValue(world, leader, GameId, 'id')!, offsetX, offsetY })
    bannerAtSpawn(ctx, m, leader)
  })
  return 1 + squad.members.length
}

export const spawnSquads = (ctx: Ctx, team: number, maxSquads: number, popCap: number, kindPurpose: number, yPurpose: number) => {
  const { k } = ctx
  let alive = aliveCount(ctx, team)
  let warlord: EntityId | undefined
  for (let s = 0; s < maxSquads && alive < popCap; s++) {
    const place = s % k.SQUADS_PER_WARBAND
    if (place === 0) {
      warlord = spawnWarlord(ctx, team, k.fx.div(s, k.SQUADS_PER_WARBAND), yPurpose)
      alive++
    }
    alive += spawnSquad(ctx, team, s, place, warlord!, kindPurpose)
  }
}
