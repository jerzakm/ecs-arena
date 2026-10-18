import { addComponents, query } from 'bitecs'
import type { Context } from '../context.ts'
import { Age, GameId, Position, Shrine, Summoner, Team } from '../components.ts'
import { ChildOf, setLink } from '../relations.ts'
import { bannerAtSpawn } from '../derived-stats.ts'
import { newEntity, spawnSquads, spawnUnit } from '../spawning.ts'

export const spawnSystem = (ctx: Context) => {
  const { k, world, scenario } = ctx
  const { PURPOSE, KIND } = k

  return () => {
    const tick = ++world.clock
    for (const e of query(world, [Age])) Age.value[e]++

    if (tick === 0) {
      for (let i = 0; i < k.SHRINE_COUNT; i++) {
        const e = newEntity(ctx)
        addComponents(world, e, [Shrine, GameId, Position])
        GameId.id[e] = ctx.nextId(); Shrine.owner[e] = -1; Shrine.progress[e] = 0
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

    for (const s of ctx.sortedByGameId(Summoner)) {
      if (tick - Summoner.lastSummon[s] < k.SUMMON_PERIOD || (ChildOf.from![s]?.length ?? 0) >= k.MAX_MINIONS) continue
      const minion = spawnUnit(ctx, Team.value[s], KIND.MINION, Position.x[s], Position.y[s])
      setLink(minion, ChildOf, s)
      bannerAtSpawn(ctx, minion, s)
      Summoner.lastSummon[s] = tick
    }
  }
}
