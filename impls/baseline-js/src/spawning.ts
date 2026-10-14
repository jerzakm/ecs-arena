import type { Context } from './context.ts'
import { recomputeStats } from './derived-stats.ts'
import type { Item, Unit } from './types.ts'

export const spawnUnit = (ctx: Context, team: number, kind: number, x: number, y: number): Unit => {
  const { k, scenario, add } = ctx
  const { clampToArena, randInt, PURPOSE, KIND, UNIT_STATS } = k
  const { seed } = scenario
  const gameId = ctx.nextId++
  const items: Item[] = []
  if (kind !== KIND.MINION) {
    const count = randInt(4, seed, ctx.tick, gameId, PURPOSE.ITEM_COUNT)
    for (let i = 0; i < count; i++) {
      add('create.equippedItem'); add('rel.Equips.add')
      items.push({
        gameId: ctx.nextId++,
        kind: randInt(8, seed, ctx.tick, gameId, PURPOSE.ITEM_KIND, i),
        quality: 1 + randInt(3, seed, ctx.tick, gameId, PURPOSE.ITEM_QUALITY, i),
      })
    }
  }
  const u: Unit = {
    gameId, team, kind, x: clampToArena(x), y: clampToArena(y), h: ctx.freeSlots.pop() ?? ctx.slots.length,
    hp: UNIT_STATS[kind].maxHp, maxHp: UNIT_STATS[kind].maxHp, attack: 0, armor: 0, speed: 0, cooldown: 0,
    target: -1, memberOf: -1, offX: 0, offY: 0, childOf: -1, items, buffs: [0, 0, 0], threat: [],
    morale: null, fleeing: false, routed: false, veteran: false, killCount: 0, lastHitBy: -1, chronicle: [],
    lastSummon: ctx.tick, age: 0, sx: 0, sy: 0, dmgIn: 0, healIn: 0, stunIn: false, burnIn: false, hasteIn: false,
    dead: false, destroyed: false,
  }
  recomputeStats(ctx, u)
  add(`create.${ctx.kindName(kind)}`)
  ctx.units.push(u)
  ctx.slots[u.h] = u
  ctx.grid.add(u.h, gameId, u.x, u.y)
  ctx.unitById.set(gameId, u)
  return u
}

const spawnWarlord = (ctx: Context, team: number, warband: number, yPurpose: number): Unit => {
  const { k, scenario } = ctx
  const facing = team === 0 ? 1 : -1
  const y = k.SPAWN_Y_MIN + k.randInt(k.SPAWN_Y_RANGE, scenario.seed, ctx.tick, k.teamGameId(team), yPurpose, warband) * k.FX
  return spawnUnit(ctx, team, k.KIND.WARLORD, k.SPAWN_X[team] + facing * k.WARLORD_SPAWN_GAP, y)
}

const spawnSquad = (ctx: Context, team: number, squadIndex: number, place: number, warlord: Unit, kindPurpose: number) => {
  const { k, scenario, add } = ctx
  const { fx } = k
  const squad = k.SQUADS[k.randInt(4, scenario.seed, ctx.tick, k.teamGameId(team), kindPurpose, squadIndex)]
  const facing = team === 0 ? 1 : -1
  const lOffX = -facing * k.LEADER_SLOT_SPACING
  const lOffY = (2 * place - 3) * k.LEADER_SLOT_SPACING
  const leader = spawnUnit(ctx, team, squad.leader, warlord.x + lOffX, warlord.y + lOffY)
  leader.memberOf = warlord.gameId; leader.offX = lOffX; leader.offY = lOffY
  leader.morale = { size0: 1 + squad.members.length, lost: 0 }
  add('rel.MemberOf.add')
  squad.members.forEach((kind, i) => {
    const offX = -facing * (1 + fx.div(i, 3)) * k.FORMATION_SPACING
    const offY = ((i % 3) - 1) * k.FORMATION_SPACING
    const m = spawnUnit(ctx, team, kind, leader.x + offX, leader.y + offY)
    m.memberOf = leader.gameId; m.offX = offX; m.offY = offY
    add('rel.MemberOf.add')
  })
}

export const spawnSquads = (ctx: Context, team: number, maxSquads: number, popCap: number, kindPurpose: number, yPurpose: number) => {
  const { k, units } = ctx
  let alive = units.filter((u) => u.team === team).length
  let warlord: Unit | undefined
  for (let s = 0; s < maxSquads && alive < popCap; s++) {
    const before = units.length
    const place = s % k.SQUADS_PER_WARBAND
    if (place === 0) warlord = spawnWarlord(ctx, team, k.fx.div(s, k.SQUADS_PER_WARBAND), yPurpose)
    spawnSquad(ctx, team, s, place, warlord!, kindPurpose)
    alive += units.length - before
  }
}
