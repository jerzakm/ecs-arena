import { addComponents, query } from 'bitecs'
import type { Ctx } from '../context.ts'
import { Age, Position, Shrine, Summoner, Team } from '../components.ts'
import { GameId } from '../../shared/components.ts'
import { ChildOf, setLink } from '../relations.ts'
import { bannerAtSpawn } from '../derived-stats.ts'
import { newEntity, nextId, spawnSquads, spawnUnit } from '../entities.ts'
import { Q } from '../queries.ts'
import { sortedByGameId } from '../../shared/util.ts'

export const spawnSystem = (ctx: Ctx) => {
  const { k, world, scenario } = ctx
  const { PURPOSE, KIND } = k

  return () => {
    const tick = ++world.tick
    for (const e of query(world, Q.aged)) Age.value[e]++

    if (tick === 0) {
      for (let i = 0; i < k.SHRINE_COUNT; i++) {
        const e = newEntity(ctx)
        addComponents(world, e, [Shrine, GameId, Position])
        GameId.id[e] = nextId(ctx); Shrine.owner[e] = -1; Shrine.progress[e] = 0
        Position.x[e] = k.SHRINE_X; Position.y[e] = k.shrineY(i)
      }
    }

    if (tick % scenario.wavePeriod === 0) {
      for (const team of [0, 1]) spawnSquads(ctx, team, scenario.maxSquadsPerWave, scenario.targetPop, PURPOSE.SQUAD_KIND, PURPOSE.SPAWN_Y)
    }

    if (tick > 0 && tick % scenario.surgePeriod === 0) {
      const held = [world.score.shrines0, world.score.shrines1]
      for (const team of [0, 1]) {
        const lead = held[team] - held[1 - team]
        if (lead > 0) spawnSquads(ctx, team, scenario.surgeBase * lead, scenario.surgeCap, PURPOSE.SURGE_KIND, PURPOSE.SURGE_Y)
      }
    }

    for (const s of sortedByGameId(ctx, Q.summoners)) {
      if (tick - Summoner.lastSummon[s] < k.SUMMON_PERIOD || (ChildOf.from[s]?.length ?? 0) >= k.MAX_MINIONS) continue
      const minion = spawnUnit(ctx, Team.value[s], KIND.MINION, Position.x[s], Position.y[s])
      setLink(minion, ChildOf, s)
      bannerAtSpawn(ctx, minion, s)
      Summoner.lastSummon[s] = tick
    }
  }
}
