import type { Entity } from 'koota'
import { byGameId, type Context } from '../context.ts'
import { Age, Clock, GameId, Position, Score, Shrine, Summoner, Team } from '../components.ts'
import { ChildOf } from '../relations.ts'
import { spawnSquads, spawnUnit } from '../spawning.ts'

export const spawnSystem = (ctx: Context) => {
  const { k, world, scenario } = ctx
  const { PURPOSE, KIND } = k

  return () => {
    world.set(Clock, (c) => ({ tick: c.tick + 1 }))
    const tick = ctx.tickNow()
    world.query(Age).updateEach(([age]) => { age.value++ })

    if (tick === 0) {
      for (let i = 0; i < k.SHRINE_COUNT; i++) world.spawn(Shrine, GameId({ id: ctx.nextId() }), Position({ x: k.SHRINE_X, y: k.shrineY(i) }))
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

    const summoners: { e: Entity; id: number; last: number }[] = []
    world.query(Summoner, GameId).readEach(([s, g], e) => summoners.push({ e, id: g.id, last: s.lastSummon }))
    summoners.sort(byGameId)
    for (const s of summoners) {
      if (tick - s.last < k.SUMMON_PERIOD || world.query(ChildOf(s.e)).length >= k.MAX_MINIONS) continue
      const pos = s.e.get(Position)!
      spawnUnit(ctx, s.e.get(Team)!.value, KIND.MINION, pos.x, pos.y).add(ChildOf(s.e))
      s.e.set(Summoner, { lastSummon: tick })
    }
  }
}
