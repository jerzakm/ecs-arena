import type { Context } from '../context.ts'
import { spawnSquads, spawnUnit } from '../spawning.ts'
import { sampleEntities } from '../profiling.ts'

export const spawnSystem = (ctx: Context) => {
  const { k, scenario, add, world } = ctx
  const { PURPOSE, KIND } = k

  const spawnShrines = () => {
    for (let i = 0; i < k.SHRINE_COUNT; i++) {
      ctx.shrines.push({ gameId: ctx.nextId++, y: k.shrineY(i), owner: -1, progress: 0, garrison: [] })
      add('create.shrine')
    }
  }

  return () => {
    const { units, projectiles, groundItems, tick } = ctx
    for (let u_i = 0, u = units[0]; u_i < units.length; u = units[++u_i]) if (u.kind === KIND.MINION) u.age++
    for (let p_i = 0, p = projectiles[0]; p_i < projectiles.length; p = projectiles[++p_i]) p.age++
    for (let g_i = 0, g = groundItems[0]; g_i < groundItems.length; g = groundItems[++g_i]) g.age++

    if (tick === 0) spawnShrines()

    if (tick % scenario.wavePeriod === 0) {
      for (const team of [0, 1]) spawnSquads(ctx, team, scenario.maxSquadsPerWave, scenario.targetPop, PURPOSE.SQUAD_KIND, PURPOSE.SPAWN_Y)
    }

    if (tick > 0 && tick % scenario.surgePeriod === 0) {
      for (const team of [0, 1]) {
        const lead = world.score[team] - world.score[1 - team]
        if (lead <= 0) continue
        const before = units.length
        spawnSquads(ctx, team, scenario.surgeBase * lead, scenario.surgeCap, PURPOSE.SURGE_KIND, PURPOSE.SURGE_Y)
        add('surge.unit', units.length - before)
      }
    }

    const minionCount = new Map<number, number>()
    for (let u_i = 0, u = units[0]; u_i < units.length; u = units[++u_i]) if (u.childOf !== -1) minionCount.set(u.childOf, (minionCount.get(u.childOf) ?? 0) + 1)
    const summoners = units.filter((u) => u.kind === KIND.SUMMONER)
    add('q.spawn.summoners', summoners.length)
    for (let s_i = 0, s = summoners[0]; s_i < summoners.length; s = summoners[++s_i]) {
      if (tick - s.lastSummon < k.SUMMON_PERIOD || (minionCount.get(s.gameId) ?? 0) >= k.MAX_MINIONS) continue
      const m = spawnUnit(ctx, s.team, KIND.MINION, s.x, s.y, s)
      m.childOf = s.gameId; m.pref = s
      const list = ctx.minionsOf.get(s.gameId)
      if (list) list.push(m)
      else ctx.minionsOf.set(s.gameId, [m])
      add('rel.ChildOf.add')
      s.lastSummon = tick
      minionCount.set(s.gameId, (minionCount.get(s.gameId) ?? 0) + 1)
    }
    sampleEntities(ctx)
  }
}
