import type { Context } from '../context.ts'
import type { Unit } from '../types.ts'

export const moveSystem = (ctx: Context) => {
  const { k, add, unitById, isStunned, homeX, inRange, targetOf, depthOf } = ctx
  const { stepToward, KIND, UNIT_STATS } = k
  const farX = (team: number) => (team === 0 ? k.MAX_COORD : 0)

  // Where the unit steps this tick, or null when it stays. Targets are read at their start-of-phase position.
  const moveGoal = (u: Unit): [number, number] | null => {
    if (isStunned(u)) return null
    if (u.fleeing) return [homeX(u.team), u.y]
    const t = targetOf(u)
    if (t && inRange(u.x, u.y, t.sx, t.sy, UNIT_STATS[u.kind].range)) return null
    if (u.memberOf !== -1) { const p = unitById.get(u.memberOf)!; return [p.x + u.offX, p.y + u.offY] }
    if (t) return [t.sx, t.sy]
    if (u.kind === KIND.MINION) { const s = unitById.get(u.childOf)!; return [s.x, s.y] }
    return [farX(u.team), u.y]
  }

  return () => {
    const { units, projectiles } = ctx
    const byDepth: Unit[][] = []
    for (let u_i = 0, u = units[0]; u_i < units.length; u = units[++u_i]) {
      u.sx = u.x; u.sy = u.y
      const d = depthOf(u)
      ;(byDepth[d] ??= []).push(u)
    }
    // Hierarchy order: a parent moves before its children, so children read the new parent position.
    for (let level_i = 0, level = byDepth[0]; level_i < byDepth.length; level = byDepth[++level_i]) for (let u_i = 0, u = level[0]; u_i < level.length; u = level[++u_i]) {
      const goal = moveGoal(u)
      if (!goal) continue
      add('q.move.units')
      ;[u.x, u.y] = stepToward(u.x, u.y, goal[0], goal[1], u.speed)
    }
    add('q.move.projectiles', projectiles.length)
    for (let p_i = 0, p = projectiles[0]; p_i < projectiles.length; p = projectiles[++p_i]) {
      const t = unitById.get(p.target)!
      ;[p.x, p.y] = stepToward(p.x, p.y, t.x, t.y, p.speed)
    }
  }
}
