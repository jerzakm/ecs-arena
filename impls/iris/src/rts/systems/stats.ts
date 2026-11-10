import {
  addComponent, collectEntities, defineSystem, type EntityId, EXPERIMENTAL_queryColumns as queryColumns, getComponentValue,
  getResourceValue, hasComponent, isEntityAlive, removeComponent, setResourceValue,
} from 'iris-ecs'
import { Bannered, Chronicle, Clock, KillCount, Kind, MemberOf, Metrics, Veteran } from '../components.ts'
import type { Ctx } from '../context.ts'
import { recomputeStats } from '../derived-stats.ts'
import { summonerOf, targetOf } from '../links.ts'
import { newlyVeteran, renderables, teamQuery, unitsLoose, unitsMember, unitsMinion } from '../queries.ts'
import { flagsOf } from '../snapshot.ts'

export const statsSystem = (ctx: Ctx) => {
  const { k, world, dirty } = ctx
  // gameId, kind, team, x, y, hp byte, flags, trail count and the oldest trail point for each unit, in query order
  let rows = new Int32Array(0)
  let keys = new Float64Array(0)
  let buf = new Int32Array(0)

  return defineSystem('stats', () => {

    // Banner: the root of the MemberOf and ChildOf chain is a warlord and the unit is not the root. The memo holds "root is a warlord".
    const rootIsWarlord = new Map<EntityId, boolean>()
    const rootWarlord = (e: EntityId): boolean => {
      let r = rootIsWarlord.get(e)
      if (r === undefined) {
        const p = targetOf(ctx, e, MemberOf) ?? summonerOf(world, e)
        rootIsWarlord.set(e, r = p !== undefined ? rootWarlord(p) : getComponentValue(world, e, Kind, 'value')! === k.KIND.WARLORD)
      }
      return r
    }
    const gain: EntityId[] = [], lose: EntityId[] = []
    // One archetype shares its tags, so `Bannered` is read once for each archetype and `MemberOf` is read as a column.
    const syncBanner = (entities: EntityId[], parentOf: (i: number) => EntityId | undefined) => {
      const has = hasComponent(world, entities[0], Bannered)
      for (let i = 0; i < entities.length; i++) {
        const p = parentOf(i)
        if ((p !== undefined && rootWarlord(p)) !== has) (has ? lose : gain).push(entities[i])
      }
    }
    queryColumns(world, unitsMember, (entities, [member]) => {
      syncBanner(entities, (i) => ctx.entityOf.get(member.to[i]) ?? summonerOf(world, entities[i]))
    })
    queryColumns(world, unitsMinion, (entities) => syncBanner(entities, (i) => summonerOf(world, entities[i])))
    queryColumns(world, unitsLoose, (entities) => { for (let i = 0; i < entities.length; i++) lose.push(entities[i]) })
    for (const e of gain) addComponent(world, e, Bannered)
    for (const e of lose) removeComponent(world, e, Bannered)

    for (const e of dirty) {
      if (!isEntityAlive(world, e)) continue
      const kills = getComponentValue(world, e, KillCount, 'value')!
      if (!hasComponent(world, e, Veteran) && kills >= k.VETERAN_KILLS) addComponent(world, e, Veteran)
      recomputeStats(ctx, e)
    }
    dirty.clear()
    for (const e of collectEntities(world, newlyVeteran)) addComponent(world, e, Chronicle, { kinds: [k.PROMOTION_MARK] })

    const alive = [0, 0]
    queryColumns(world, teamQuery, (entities, [team]) => {
      for (let i = 0; i < entities.length; i++) alive[team.value[i]]++
    })
    const tick = getResourceValue(world, Clock, 'tick')!
    let winner = getResourceValue(world, Metrics, 'winner')!
    if (tick > 0 && winner === -1) {
      if (alive[0] === 0 && alive[1] > 0) winner = 1
      else if (alive[1] === 0 && alive[0] > 0) winner = 0
    }
    setResourceValue(world, Metrics, 'alive0', alive[0])
    setResourceValue(world, Metrics, 'alive1', alive[1])
    setResourceValue(world, Metrics, 'winner', winner)

    // SPEC 6.15: one pass reads the traits of every unit into `rows`. The tags come from `hasComponent`, and the rows go out in gameId
    // order.
    const S = k.RENDER_STRIDE
    let n = 0
    queryColumns(world, renderables, (entities, [id, kind, team, pos, health, trail]) => {
      const flags = flagsOf(ctx, entities[0]) // the flags are tags, so the archetype shares them
      if (rows.length < (n + entities.length) * S) {
        const grown = new Int32Array(Math.max((n + entities.length) * S, 2 * rows.length))
        grown.set(rows)
        rows = grown
      }
      for (let i = 0; i < entities.length; i++, n++) {
        const pts = trail.pts[i], o = n * S
        rows[o] = id.id[i]; rows[o + 1] = kind.value[i]; rows[o + 2] = team.value[i]; rows[o + 3] = pos.x[i]; rows[o + 4] = pos.y[i]
        rows[o + 5] = k.fx.div(health.hp[i] * 255, health.maxHp[i]); rows[o + 6] = flags
        rows[o + 7] = pts.length >> 1; rows[o + 8] = pts[0] ?? 0; rows[o + 9] = pts[1] ?? 0
      }
    })
    // A sort of packed keys (gameId, then row) runs without a comparator: gameIds are below 2^31 and rows below 2^21.
    if (keys.length < n) keys = new Float64Array(Math.max(n, 2 * keys.length))
    const sorted = keys.subarray(0, n)
    for (let i = 0; i < n; i++) sorted[i] = rows[i * S] * 2097152 + i
    sorted.sort()
    const size = 1 + n * S
    if (buf.length < size) buf = new Int32Array(Math.max(size, 2 * buf.length))
    buf[0] = n
    for (let i = 0; i < n; i++) { const r = sorted[i] % 2097152; buf.set(rows.subarray(r * S, r * S + S), 1 + i * S) }
    setResourceValue(world, Metrics, 'renderChain', k.foldRender(getResourceValue(world, Metrics, 'renderChain')!, buf, size))
  })
}
