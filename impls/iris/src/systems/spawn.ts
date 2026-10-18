import { addComponent, collectEntities, createEntity, defineSystem, pair, type EntityId } from 'iris-ecs'
import { byGameId, type Context } from '../context.ts'
import { Clock, GameId, Position, Score, Shrine, Summoner, Team, Age } from '../components.ts'
import { ChildOf } from '../relations.ts'
import { aged, minionsOf } from '../queries.ts'
import { bannerAtSpawn } from '../derived-stats.ts'
import { spawnSquads, spawnUnit } from '../spawning.ts'

export const spawnSystem = (ctx: Context) => {
  const { k, world, scenario, get, set } = ctx
  const { PURPOSE, KIND } = k

  return defineSystem('spawn', () => {
    ctx.setRes(Clock, 'tick', ctx.tickNow() + 1)
    const tick = ctx.tickNow()
    for (const e of collectEntities(world, aged)) set(e, Age, 'value', get(e, Age, 'value') + 1)

    if (tick === 0) {
      for (let i = 0; i < k.SHRINE_COUNT; i++) {
        createEntity(world, [[Shrine, { owner: -1, progress: 0 }], [GameId, { id: ctx.nextId() }], [Position, { x: k.SHRINE_X, y: k.shrineY(i) }]])
      }
    }

    if (tick % scenario.wavePeriod === 0) {
      for (const team of [0, 1]) spawnSquads(ctx, team, scenario.maxSquadsPerWave, scenario.targetPop, PURPOSE.SQUAD_KIND, PURPOSE.SPAWN_Y)
    }

    if (tick > 0 && tick % scenario.surgePeriod === 0) {
      const held = [ctx.res(Score, 'shrines0'), ctx.res(Score, 'shrines1')]
      for (const team of [0, 1]) {
        const lead = held[team] - held[1 - team]
        if (lead > 0) spawnSquads(ctx, team, scenario.surgeBase * lead, scenario.surgeCap, PURPOSE.SURGE_KIND, PURPOSE.SURGE_Y)
      }
    }

    const summoners = (collectEntities(world, [Summoner, GameId]) as EntityId[])
      .map((e) => ({ e, id: get(e, GameId, 'id'), last: get(e, Summoner, 'lastSummon') }))
      .sort(byGameId)
    // The minions of each summoner come from one scan of the `ChildOf` wildcard, made when the first summoner is due.
    let minionCount: Map<EntityId, number> | undefined
    const minionsOfSummoner = (s: EntityId) => {
      if (!minionCount) {
        minionCount = new Map()
        for (const m of collectEntities(world, minionsOf)) {
          const parent = ctx.summonerOf(m)!
          minionCount.set(parent, (minionCount.get(parent) ?? 0) + 1)
        }
      }
      return minionCount.get(s) ?? 0
    }
    for (const s of summoners) {
      if (tick - s.last < k.SUMMON_PERIOD || minionsOfSummoner(s.e) >= k.MAX_MINIONS) continue
      const minion = spawnUnit(ctx, get(s.e, Team, 'value'), KIND.MINION, get(s.e, Position, 'x'), get(s.e, Position, 'y'))
      addComponent(world, minion, pair(ChildOf, s.e))
      bannerAtSpawn(ctx, minion, s.e)
      set(s.e, Summoner, 'lastSummon', tick)
    }
  })
}
