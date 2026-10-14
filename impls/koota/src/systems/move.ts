import type { Entity } from 'koota'
import type { Context } from '../context.ts'
import { Fleeing, Position, Start } from '../components.ts'
import { ChildOf, MemberOf, Targets } from '../relations.ts'

export const moveSystem = (ctx: Context) => {
  const { k, world, q, homeX, inRange } = ctx
  const { KIND, UNIT_STATS, stepToward } = k

  return () => {
    world.query(q.starts).updateEach(([p, s]) => { s.x = p.x; s.y = p.y })

    // Depth is memoized for the phase, since siblings share their parent chain.
    const depth = new Map<Entity, number>()
    const depthOf = (e: Entity): number => {
      let d = depth.get(e)
      if (d === undefined) {
        const p = e.targetFor(MemberOf) ?? e.targetFor(ChildOf)
        depth.set(e, d = p ? depthOf(p) + 1 : 0)
      }
      return d
    }
    const levels: { e: Entity; kind: number; team: number; speed: number }[][] = []
    world.query(q.movers).readEach(([kindT, teamT, s], e) => {
      (levels[depthOf(e)] ??= []).push({ e, kind: kindT.value, team: teamT.value, speed: s.speed })
    })

    // Hierarchy order: a parent moves before its children, and children read the new parent position.
    for (const level of levels) {
      if (!level) continue
      for (const { e, kind, team, speed } of level) {
        const p = e.get(Position)!
        let tx: number, ty: number
        if (e.has(Fleeing)) { tx = homeX(team); ty = p.y }
        else {
          const target = e.targetFor(Targets)
          const ts = target?.get(Start)
          if (ts && inRange(p.x, p.y, ts.x, ts.y, UNIT_STATS[kind].range)) continue
          const parent = e.targetFor(MemberOf)
          if (parent) {
            const pp = parent.get(Position)!
            const off = e.get(MemberOf(parent))!
            tx = pp.x + off.offsetX; ty = pp.y + off.offsetY
          } else if (ts) { tx = ts.x; ty = ts.y }
          else if (kind === KIND.MINION) { const sp = e.targetFor(ChildOf)!.get(Position)!; tx = sp.x; ty = sp.y }
          else { tx = team === 0 ? k.MAX_COORD : 0; ty = p.y }
        }
        const [x, y] = stepToward(p.x, p.y, tx, ty, speed)
        e.set(Position, { x, y })
      }
    }

    world.query(q.projectiles).updateEach(([pr, p], e) => {
      const t = e.targetFor(Targets)
      if (t) { const tp = t.get(Position)!; [p.x, p.y] = stepToward(p.x, p.y, tp.x, tp.y, pr.speed) }
    })
  }
}
