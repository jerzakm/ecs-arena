import {
  addComponent, collectEntities, createEntity, defineSystem, type EntityId, getComponent, getComponentValue, getResourceValue, pair,
  setComponentValue, setResourceValue,
} from 'iris-ecs'
import { GameId } from '../../shared/components.ts'
import { byGameId } from '../../shared/util.ts'
import { Age, ChildOf, Clock, Position, Score, Shrine, Summoner, Team } from '../components.ts'
import type { Ctx } from '../context.ts'
import { bannerAtSpawn } from '../derived-stats.ts'
import { nextId, spawnSquads, spawnUnit } from '../entities.ts'
import { summonerOf } from '../links.ts'
import { aged, minionsOf, summonerUnits } from '../queries.ts'

export const spawnSystem = (ctx: Ctx) => {
  const { k, world, scenario } = ctx
  const { PURPOSE, KIND } = k

  return defineSystem('spawn', () => {
    setResourceValue(world, Clock, 'tick', getResourceValue(world, Clock, 'tick')! + 1)
    const tick = getResourceValue(world, Clock, 'tick')!
    for (const e of collectEntities(world, aged)) setComponentValue(world, e, Age, 'value', getComponentValue(world, e, Age, 'value') + 1)

    if (tick === 0) {
      for (let i = 0; i < k.SHRINE_COUNT; i++) {
        createEntity(world, [
          [Shrine, { owner: -1, progress: 0 }], [GameId, { id: nextId(ctx) }], [Position, { x: k.SHRINE_X, y: k.shrineY(i) }],
        ])
      }
    }

    if (tick % scenario.wavePeriod === 0) {
      for (const team of [0, 1]) spawnSquads(ctx, team, scenario.maxSquadsPerWave, scenario.targetPop, PURPOSE.SQUAD_KIND, PURPOSE.SPAWN_Y)
    }

    if (tick > 0 && tick % scenario.surgePeriod === 0) {
      const held = [getResourceValue(world, Score, 'shrines0')!, getResourceValue(world, Score, 'shrines1')!]
      for (const team of [0, 1]) {
        const lead = held[team] - held[1 - team]
        if (lead > 0) spawnSquads(ctx, team, scenario.surgeBase * lead, scenario.surgeCap, PURPOSE.SURGE_KIND, PURPOSE.SURGE_Y)
      }
    }

    const summoners = collectEntities(world, summonerUnits)
      .map((e) => ({ e, id: getComponentValue(world, e, GameId, 'id')!, last: getComponentValue(world, e, Summoner, 'lastSummon')! }))
      .sort(byGameId)
    // The minions of each summoner come from one scan of the `ChildOf` wildcard, made when the first summoner is due.
    let minionCount: Map<EntityId, number> | undefined
    const minionsOfSummoner = (s: EntityId) => {
      if (!minionCount) {
        minionCount = new Map()
        for (const m of collectEntities(world, minionsOf)) {
          const parent = summonerOf(world, m)!
          minionCount.set(parent, (minionCount.get(parent) ?? 0) + 1)
        }
      }
      return minionCount.get(s) ?? 0
    }
    for (const s of summoners) {
      if (tick - s.last < k.SUMMON_PERIOD || minionsOfSummoner(s.e) >= k.MAX_MINIONS) continue
      const { x, y } = getComponent(world, s.e, Position)!
      const minion = spawnUnit(ctx, getComponentValue(world, s.e, Team, 'value')!, KIND.MINION, x, y)
      addComponent(world, minion, pair(ChildOf, s.e))
      bannerAtSpawn(ctx, minion, s.e)
      setComponentValue(world, s.e, Summoner, 'lastSummon', tick)
    }
  })
}
