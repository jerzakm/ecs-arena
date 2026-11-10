import type { Entity } from 'koota'
import type { Ctx } from '../context.ts'
import { Age, Clock, GameId, Position, Score, Shrine, Summoner, Team, ChildOf } from '../traits.ts'
import { bannerAtSpawn } from '../derived-stats.ts'
import { nextId, spawnSquads, spawnUnit } from '../entities.ts'
import { byGameId } from '../../shared/util.ts'

export const spawnSystem = (ctx: Ctx) => {
  const { k, world, scenario } = ctx
  const { PURPOSE, KIND } = k

  return () => {
    world.set(Clock, (c) => ({ tick: c.tick + 1 }))
    const { tick } = world.get(Clock)!
    world.query(Age).updateEach(([age]) => { age.value++ })

    if (tick === 0) {
      for (let i = 0; i < k.SHRINE_COUNT; i++) {
        world.spawn(Shrine, GameId({ id: nextId(ctx) }), Position({ x: k.SHRINE_X, y: k.shrineY(i) }))
      }
    }

    if (tick % scenario.wavePeriod === 0) {
      for (const team of [0, 1]) spawnSquads(ctx, team, scenario.maxSquadsPerWave, scenario.targetPop, PURPOSE.SQUAD_KIND, PURPOSE.SPAWN_Y)
    }

    if (tick > 0 && tick % scenario.surgePeriod === 0) {
      const score = world.get(Score)!
      const held = [score.shrines0, score.shrines1]
      for (const team of [0, 1]) {
        const lead = held[team] - held[1 - team]
        if (lead > 0) spawnSquads(ctx, team, scenario.surgeBase * lead, scenario.surgeCap, PURPOSE.SURGE_KIND, PURPOSE.SURGE_Y)
      }
    }

    const summoners: { e: Entity; gameId: number; last: number }[] = []
    world.query(Summoner, GameId).readEach(([s, g], e) => summoners.push({ e, gameId: g.id, last: s.lastSummon }))
    summoners.sort(byGameId)
    for (const s of summoners) {
      if (tick - s.last < k.SUMMON_PERIOD || world.query(ChildOf(s.e)).length >= k.MAX_MINIONS) continue
      const pos = s.e.get(Position)!
      const minion = spawnUnit(ctx, s.e.get(Team)!.value, KIND.MINION, pos.x, pos.y)
      minion.add(ChildOf(s.e))
      bannerAtSpawn(ctx, minion, s.e)
      s.e.set(Summoner, { lastSummon: tick })
    }
  }
}
