import { addComponent, addComponents, createEntity, type EntityId } from 'iris-ecs'
import type { Context } from './context.ts'
import { Age, Cooldown, Equips, GameId, Health, Item, ItemKind, ItemTags, KillCount, LastHitBy, Kind, MemberOf, Minion, Morale, Position, Start, Stats, Summoner, Targets, Team, Threat, Trail, Unit } from './components.ts'
import { bannerAtSpawn, recomputeStats } from './derived-stats.ts'

export const spawnUnit = (ctx: Context, team: number, kind: number, x: number, y: number): EntityId => {
  const { k, world, scenario } = ctx
  const { seed } = scenario
  const tick = ctx.tickNow()
  const id = ctx.nextId()
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
      const itemId = ctx.nextId()
      createEntity(world, [Item, [GameId, { id: itemId }], [ItemKind, { value: kindOfItem }]])
      ctx.equipsOf(e).push(itemId, 1 + k.randInt(3, seed, tick, id, k.PURPOSE.ITEM_QUALITY, i))
      tags.add(ItemTags[kindOfItem])
    }
    if (tags.size > 0) addComponents(world, e, [...tags])
  }
  recomputeStats(ctx, e)
  return e
}

const spawnWarlord = (ctx: Context, team: number, warband: number, yPurpose: number) => {
  const { k, scenario } = ctx
  const { seed } = scenario
  const tick = ctx.tickNow()
  const facing = team === 0 ? 1 : -1
  const y = k.SPAWN_Y_MIN + k.randInt(k.SPAWN_Y_RANGE, seed, tick, k.teamGameId(team), yPurpose, warband) * k.FX
  return spawnUnit(ctx, team, k.KIND.WARLORD, k.SPAWN_X[team] + facing * k.WARLORD_SPAWN_GAP, y)
}

const spawnSquad = (ctx: Context, team: number, squadIndex: number, place: number, warlord: EntityId, kindPurpose: number) => {
  const { k, world, scenario, get } = ctx
  const { seed } = scenario
  const tick = ctx.tickNow()
  const squad = k.SQUADS[k.randInt(4, seed, tick, k.teamGameId(team), kindPurpose, squadIndex)]
  const facing = team === 0 ? 1 : -1
  const wx = get(warlord, Position, 'x'), wy = get(warlord, Position, 'y')
  const leaderOffsetX = -facing * k.LEADER_SLOT_SPACING
  const leaderOffsetY = (2 * place - 3) * k.LEADER_SLOT_SPACING
  const leader = spawnUnit(ctx, team, squad.leader, wx + leaderOffsetX, wy + leaderOffsetY)
  addComponents(world, leader, [[MemberOf, { to: ctx.gid(warlord), offsetX: leaderOffsetX, offsetY: leaderOffsetY }], [Morale, { size0: 1 + squad.members.length, lost: 0 }]])
  bannerAtSpawn(ctx, leader, warlord)
  const lx = get(leader, Position, 'x'), ly = get(leader, Position, 'y')
  squad.members.forEach((kind, i) => {
    const offsetX = -facing * (1 + k.fx.div(i, 3)) * k.FORMATION_SPACING
    const offsetY = ((i % 3) - 1) * k.FORMATION_SPACING
    const m = spawnUnit(ctx, team, kind, lx + offsetX, ly + offsetY)
    addComponent(world, m, MemberOf, { to: ctx.gid(leader), offsetX, offsetY })
    bannerAtSpawn(ctx, m, leader)
  })
  return 1 + squad.members.length
}

export const spawnSquads = (ctx: Context, team: number, maxSquads: number, popCap: number, kindPurpose: number, yPurpose: number) => {
  const { k } = ctx
  let alive = ctx.aliveCount(team)
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
