import { query } from 'bitecs'
import type { Context } from '../context.ts'
import { CAP, Position, Projectile, Stats, Kind, Team, Start, Trail } from '../components.ts'
import { ChildOf, MemberOf, offsetX, parentOf, offsetY, Targets } from '../relations.ts'
import { Q } from '../queries.ts'

/** The `Sim.moveStart` step: SoA stores are not double-buffered, so `Start` copies `Position` before `move`. */
export const moveStartSystem = (ctx: Context) => () => {
  for (const e of query(ctx.world, Q.starts)) { Start.x[e] = Position.x[e]; Start.y[e] = Position.y[e] }
}

export const moveSystem = (ctx: Context) => {
  const { k, world, homeX, inRange } = ctx
  const { KIND, UNIT_STATS, stepToward } = k
  const fleeing = new Uint8Array(CAP) // Fleeing marks of the phase, from the tag's own query
  const depth = new Int8Array(CAP) // memo for the phase: depth + 1, 0 = not computed. Siblings share their parent chain.
  const depthOf = (e: number): number => {
    let d = depth[e]
    if (d === 0) {
      const p = parentOf(e)
      depth[e] = d = (p === -1 ? 0 : depthOf(p) + 1) + 1
    }
    return d - 1
  }

  return () => {
    depth.fill(0)
    fleeing.fill(0)
    for (const e of query(world, Q.fleeing)) fleeing[e] = 1
    const levels: number[][] = []
    for (const e of query(world, Q.movers)) (levels[depthOf(e)] ??= []).push(e)

    // Hierarchy order: a parent moves before its children, and children read the new parent position.
    for (const level of levels) {
      if (!level) continue
      for (const e of level) {
        const kind = Kind.value[e], team = Team.value[e]
        const px = Position.x[e], py = Position.y[e]
        let tx: number, ty: number
        const target = Targets.to[e]
        if (fleeing[e]) { tx = homeX(team); ty = py }
        else {
          if (target !== -1 && inRange(px, py, Start.x[target], Start.y[target], UNIT_STATS[kind].range)) continue
          const parent = MemberOf.to[e]
          if (parent !== -1) {
            tx = Position.x[parent] + offsetX[e]; ty = Position.y[parent] + offsetY[e]
          } else if (target !== -1) { tx = Start.x[target]; ty = Start.y[target] }
          else if (kind === KIND.MINION) { const sp = ChildOf.to[e]; tx = Position.x[sp]; ty = Position.y[sp] }
          else { tx = team === 0 ? k.MAX_COORD : 0; ty = py }
        }
        const [x, y] = stepToward(px, py, tx, ty, Stats.speed[e])
        Position.x[e] = x; Position.y[e] = y
        if (x !== px || y !== py) {
          const pts = Trail.pts[e], n = Trail.n[e]
          if (n === k.TRAIL_POINTS) { pts.copyWithin(0, 2); pts[2 * n - 2] = x; pts[2 * n - 1] = y }
          else { pts[2 * n] = x; pts[2 * n + 1] = y; Trail.n[e] = n + 1 }
        }
        ctx.grid.update(e, x, y)
      }
    }

    for (const e of query(world, Q.projectiles)) {
      const t = Targets.to[e]
      if (t !== -1) { const [x, y] = stepToward(Position.x[e], Position.y[e], Position.x[t], Position.y[t], Projectile.speed[e]); Position.x[e] = x; Position.y[e] = y }
    }
  }
}
