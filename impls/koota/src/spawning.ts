import type { Entity } from 'koota'
import type { Context } from './context.ts'
import { Age, Cooldown, GameId, Health, Item, ItemKind, KillCount, Kind, Minion, Morale, Position, Start, Stats, Summoner, Team, Unit } from './components.ts'
import { Equips, MemberOf } from './relations.ts'
import { recomputeStats } from './derived-stats.ts'

export const spawnUnit = (ctx: Context, team: number, kind: number, x: number, y: number): Entity => {
  const { k, world, scenario } = ctx
  const { seed } = scenario
  const tick = ctx.tickNow()
  const id = ctx.nextId()
  const maxHp = k.UNIT_STATS[kind].maxHp
  const px = k.clampToArena(x), py = k.clampToArena(y)
  const e = world.spawn(
    Unit, GameId({ id }), Team({ value: team }), Kind({ value: kind }),
    Position({ x: px, y: py }), Start({ x: px, y: py }), Health({ hp: maxHp, maxHp }), Stats, Cooldown, KillCount
  )
  if (kind === k.KIND.SUMMONER) e.add(Summoner({ lastSummon: tick }))
  if (kind === k.KIND.MINION) e.add(Minion, Age)
  else {
    const count = k.randInt(4, seed, tick, id, k.PURPOSE.ITEM_COUNT)
    for (let i = 0; i < count; i++) {
      const item = world.spawn(Item, GameId({ id: ctx.nextId() }), ItemKind({ value: k.randInt(8, seed, tick, id, k.PURPOSE.ITEM_KIND, i) }))
      e.add(Equips(item, { quality: 1 + k.randInt(3, seed, tick, id, k.PURPOSE.ITEM_QUALITY, i) }))
    }
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

const spawnSquad = (ctx: Context, team: number, squadIndex: number, place: number, warlord: Entity, kindPurpose: number) => {
  const { k, scenario } = ctx
  const { seed } = scenario
  const tick = ctx.tickNow()
  const squad = k.SQUADS[k.randInt(4, seed, tick, k.teamGameId(team), kindPurpose, squadIndex)]
  const facing = team === 0 ? 1 : -1
  const wp = warlord.get(Position)!
  const leaderOffsetX = -facing * k.LEADER_SLOT_SPACING
  const leaderOffsetY = (2 * place - 3) * k.LEADER_SLOT_SPACING
  const leader = spawnUnit(ctx, team, squad.leader, wp.x + leaderOffsetX, wp.y + leaderOffsetY)
  leader.add(MemberOf(warlord, { offsetX: leaderOffsetX, offsetY: leaderOffsetY }), Morale({ size0: 1 + squad.members.length, lost: 0 }))
  const lp = leader.get(Position)!
  squad.members.forEach((kind, i) => {
    const offsetX = -facing * (1 + k.fx.div(i, 3)) * k.FORMATION_SPACING
    const offsetY = ((i % 3) - 1) * k.FORMATION_SPACING
    spawnUnit(ctx, team, kind, lp.x + offsetX, lp.y + offsetY).add(MemberOf(leader, { offsetX, offsetY }))
  })
  return 1 + squad.members.length
}

export const spawnSquads = (ctx: Context, team: number, maxSquads: number, popCap: number, kindPurpose: number, yPurpose: number) => {
  const { k } = ctx
  let alive = ctx.aliveCount(team)
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
