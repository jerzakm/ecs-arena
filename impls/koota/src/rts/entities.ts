// Factories: a unit with its items, then the squads and warbands of a wave (SPEC §6.2). Only these functions take a gameId from NextId.
import type { Entity } from 'koota'
import type { Ctx } from './context.ts'
import {
  Age, Clock, Cooldown, Equips, GameId, Health, Item, ItemKind, ITEM_TAGS, KillCount, Kind, MemberOf, Minion, Morale, NextId, Position,
  Start, Stats, Summoner, Team, Trail, Unit,
} from './traits.ts'
import { bannerAtSpawn, recomputeStats } from './derived-stats.ts'

/** Takes the next gameId (SPEC §5.6). */
export const nextId = (ctx: Ctx): number => {
  const id = ctx.world.get(NextId)!.value
  ctx.world.set(NextId, { value: id + 1 })
  return id
}

const aliveCount = (ctx: Ctx, team: number): number => {
  let n = 0
  ctx.world.query(ctx.q.teams).readEach(([t]) => { if (t.value === team) n++ })
  return n
}

export const spawnUnit = (ctx: Ctx, team: number, kind: number, x: number, y: number): Entity => {
  const { k, world, scenario } = ctx
  const { seed } = scenario
  const { tick } = world.get(Clock)!
  const id = nextId(ctx)
  const maxHp = k.UNIT_STATS[kind].maxHp
  const px = k.clampToArena(x), py = k.clampToArena(y)
  const e = world.spawn(
    Unit, GameId({ id }), Team({ value: team }), Kind({ value: kind }),
    Position({ x: px, y: py }), Start({ x: px, y: py }), Health({ hp: maxHp, maxHp }), Stats, Cooldown, KillCount, Trail
  )
  ctx.unitAt[e.id()] = e
  ctx.teamAt[e.id()] = team
  ctx.grid.add(e.id(), id, px, py)
  ctx.inGrid[e.id()] = true
  ctx.unitById.set(id, e)
  ctx.idAt[e.id()] = id
  if (kind === k.KIND.SUMMONER) e.add(Summoner({ lastSummon: tick }))
  if (kind === k.KIND.MINION) e.add(Minion, Age)
  else {
    const count = k.randInt(4, seed, tick, id, k.PURPOSE.ITEM_COUNT)
    const tags = new Set<(typeof ITEM_TAGS)[number]>()
    for (let i = 0; i < count; i++) {
      const kindOfItem = k.randInt(8, seed, tick, id, k.PURPOSE.ITEM_KIND, i)
      const item = world.spawn(Item, GameId({ id: nextId(ctx) }), ItemKind({ value: kindOfItem }))
      e.add(Equips(item, { quality: 1 + k.randInt(3, seed, tick, id, k.PURPOSE.ITEM_QUALITY, i) }))
      tags.add(ITEM_TAGS[kindOfItem])
    }
    if (tags.size > 0) e.add(...tags)
  }
  recomputeStats(ctx, e)
  return e
}

const spawnWarlord = (ctx: Ctx, team: number, warband: number, yPurpose: number) => {
  const { k, world, scenario } = ctx
  const { seed } = scenario
  const { tick } = world.get(Clock)!
  const facing = team === 0 ? 1 : -1
  const y = k.SPAWN_Y_MIN + k.randInt(k.SPAWN_Y_RANGE, seed, tick, k.teamGameId(team), yPurpose, warband) * k.FX
  return spawnUnit(ctx, team, k.KIND.WARLORD, k.SPAWN_X[team] + facing * k.WARLORD_SPAWN_GAP, y)
}

const spawnSquad = (ctx: Ctx, team: number, squadIndex: number, place: number, warlord: Entity, kindPurpose: number) => {
  const { k, world, scenario } = ctx
  const { seed } = scenario
  const { tick } = world.get(Clock)!
  const squad = k.SQUADS[k.randInt(4, seed, tick, k.teamGameId(team), kindPurpose, squadIndex)]
  const facing = team === 0 ? 1 : -1
  const wp = warlord.get(Position)!
  const leaderOffsetX = -facing * k.LEADER_SLOT_SPACING
  const leaderOffsetY = (2 * place - 3) * k.LEADER_SLOT_SPACING
  const leader = spawnUnit(ctx, team, squad.leader, wp.x + leaderOffsetX, wp.y + leaderOffsetY)
  leader.add(MemberOf(warlord, { offsetX: leaderOffsetX, offsetY: leaderOffsetY }), Morale({ size0: 1 + squad.members.length, lost: 0 }))
  bannerAtSpawn(ctx, leader, warlord)
  const lp = leader.get(Position)!
  squad.members.forEach((kind, i) => {
    const offsetX = -facing * (1 + k.fx.div(i, 3)) * k.FORMATION_SPACING
    const offsetY = ((i % 3) - 1) * k.FORMATION_SPACING
    const m = spawnUnit(ctx, team, kind, lp.x + offsetX, lp.y + offsetY)
    m.add(MemberOf(leader, { offsetX, offsetY }))
    bannerAtSpawn(ctx, m, leader)
  })
  return 1 + squad.members.length
}

export const spawnSquads = (ctx: Ctx, team: number, maxSquads: number, popCap: number, kindPurpose: number, yPurpose: number) => {
  const { k } = ctx
  let alive = aliveCount(ctx, team)
  let warlord: Entity | undefined
  for (let s = 0; s < maxSquads && alive < popCap; s++) {
    const place = s % k.SQUADS_PER_WARBAND
    if (place === 0) {
      warlord = spawnWarlord(ctx, team, k.fx.div(s, k.SQUADS_PER_WARBAND), yPurpose)
      alive++
    }
    alive += spawnSquad(ctx, team, s, place, warlord!, kindPurpose)
  }
}
