import { addComponent, entityExists, hasComponent, query, removeComponent } from 'bitecs'
import type { Context } from '../context.ts'
import { Bannered, CAP, Chronicle, Fleeing, GameId, Garrisoned, Health, KillCount, Kind, Overwhelmed, Routed, Team, Unit, Veteran, Position, Trail } from '../components.ts'
import { recomputeStats } from '../derived-stats.ts'
import { parentOf } from '../relations.ts'
import { Q } from '../queries.ts'
import { byGameId } from '../context.ts'

export const statsSystem = (ctx: Context) => {
  const { k, world, dirty } = ctx
  const memo = new Int8Array(CAP) // root is a warlord: 0 not computed, 1 no, 2 yes
  let buf = new Int32Array(0)
  const flags = new Uint8Array(CAP) // SPEC §8 flag bits of the phase, one pass over each tag's own query
  const FLAG_TAGS = [Fleeing, Veteran, Routed, Overwhelmed, Bannered, Garrisoned]

  // Banner: the root of the MemberOf and ChildOf chain is a warlord and the unit is not the root.
  const rootWarlord = (e: number): boolean => {
    let r = memo[e]
    if (r === 0) {
      const p = parentOf(e)
      memo[e] = r = (p !== -1 ? rootWarlord(p) : Kind.value[e] === k.KIND.WARLORD) ? 2 : 1
    }
    return r === 2
  }

  return () => {
    // Rules on Added and on change: KillCount went through setComponent (onSet hook), and Veteran has an onAdd observer.
    const candidates = Array.from(ctx.killsChanged)
    ctx.killsChanged.clear()
    for (const e of candidates) {
      if (entityExists(world, e) && hasComponent(world, e, Unit) && !hasComponent(world, e, Veteran) && KillCount.value[e] >= k.VETERAN_KILLS) addComponent(world, e, Veteran)
    }
    const veterans = ctx.newlyVeteran.filter((e) => entityExists(world, e) && hasComponent(world, e, Veteran))
    ctx.newlyVeteran.length = 0
    for (const e of veterans) {
      addComponent(world, e, Chronicle)
      ;(Chronicle.kinds[e] ??= new Int32Array(8))[0] = k.PROMOTION_MARK
      Chronicle.n[e] = 1
    }

    memo.fill(0)
    const gain: number[] = [], lose: number[] = []
    for (const e of query(world, [Unit])) {
      const p = parentOf(e)
      const banner = p !== -1 && rootWarlord(p)
      if (banner !== hasComponent(world, e, Bannered)) (banner ? gain : lose).push(e)
    }
    for (const e of gain) addComponent(world, e, Bannered)
    for (const e of lose) removeComponent(world, e, Bannered)

    for (const e of dirty) if (entityExists(world, e) && hasComponent(world, e, Unit)) recomputeStats(ctx, e)
    dirty.clear()

    const alive = [0, 0]
    for (const e of query(world, Q.teamQuery)) alive[Team.value[e]]++
    const m = world.metrics
    m.alive0 = alive[0]; m.alive1 = alive[1]
    if (world.clock > 0 && m.winner === -1) {
      if (alive[0] === 0 && alive[1] > 0) m.winner = 1
      else if (alive[1] === 0 && alive[0] > 0) m.winner = 0
    }

    // SPEC 6.15: one pass reads the traits of every unit, in gameId order. The flags are filled by one query for each tag.
    const units = Array.from(query(world, Q.renderables)).sort(byGameId)
    const stride = k.RENDER_STRIDE
    const size = 1 + units.length * stride
    if (buf.length < size) buf = new Int32Array(Math.max(size, 2 * buf.length))
    buf[0] = units.length
    flags.fill(0)
    FLAG_TAGS.forEach((tag, bit) => { for (const e of query(world, [Unit, tag])) flags[e] |= 1 << bit })
    units.forEach((e, i) => {
      const o = 1 + i * stride
      const n = Trail.n[e], pts = Trail.pts[e]
      buf[o] = GameId.id[e]; buf[o + 1] = Kind.value[e]; buf[o + 2] = Team.value[e]; buf[o + 3] = Position.x[e]; buf[o + 4] = Position.y[e]
      buf[o + 5] = k.fx.div(Health.hp[e] * 255, Health.maxHp[e]); buf[o + 6] = flags[e]; buf[o + 7] = n; buf[o + 8] = n > 0 ? pts[0] : 0; buf[o + 9] = n > 0 ? pts[1] : 0
    })
    m.renderChain = k.foldRender(m.renderChain, buf, size)
  }
}
