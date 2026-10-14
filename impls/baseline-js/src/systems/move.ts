import type { Context } from '../context.ts'
import type { Unit } from '../types.ts'

export const moveSystem = (ctx: Context) => {
  const { k, add, begin, end, unitById, isStunned, homeX, inRange, targetOf, depthOf } = ctx
  const { stepToward, KIND, UNIT_STATS } = k
  const naiveStep = ctx.isNaive('move.step'), naiveDepth = ctx.isNaive('move.depthOrder'), naiveGrid = ctx.isNaive('grid.update')
  const farX = (team: number) => (team === 0 ? k.MAX_COORD : 0)
  const moved: Unit[] = []

  // Where the unit steps this tick, or null when it stays. Targets are read at their start-of-phase position.
  const moveGoal = (u: Unit): [number, number] | null => {
    if (isStunned(u) || u.garrison) return null
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
    begin('move.depthOrder')
    let levels: Unit[][]
    if (naiveDepth) {
      levels = []
      for (let u_i = 0, u = units[0]; u_i < units.length; u = units[++u_i]) (levels[depthOf(u)] ??= []).push(u)
    } else levels = [units] // a parent always has a lower gameId than its children, so array order moves parents first
    end('move.depthOrder')

    begin('move.step')
    for (let u_i = 0, u = units[0]; u_i < units.length; u = units[++u_i]) { u.sx = u.x; u.sy = u.y }
    for (let level_i = 0, level = levels[0]; level_i < levels.length; level = levels[++level_i]) for (let u_i = 0, u = level[0]; u_i < level.length; u = level[++u_i]) {
      if (naiveStep) u = unitById.get(u.gameId)!
      const goal = moveGoal(u)
      if (!goal) continue
      add('q.move.units')
      ;[u.x, u.y] = stepToward(u.x, u.y, goal[0], goal[1], u.speed)
      moved.push(u)
    }
    add('q.move.projectiles', projectiles.length)
    for (let p_i = 0, p = projectiles[0]; p_i < projectiles.length; p = projectiles[++p_i]) {
      const t = unitById.get(p.target)
      if (t) [p.x, p.y] = stepToward(p.x, p.y, t.x, t.y, p.speed)
    }
    end('move.step')

    begin('grid.update')
    if (naiveGrid) for (let u_i = 0, u = units[0]; u_i < units.length; u = units[++u_i]) { if (!u.garrison) ctx.grid.update(u.h, u.x, u.y) }
    else for (let u_i = 0, u = moved[0]; u_i < moved.length; u = moved[++u_i]) ctx.grid.update(u.h, u.x, u.y)
    end('grid.update')
    moved.length = 0
  }
}
