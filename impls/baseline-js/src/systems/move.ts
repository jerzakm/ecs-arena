import type { Context } from '../context.ts'
import type { Unit } from '../types.ts'

export const moveSystem = (ctx: Context) => {
  const { k, add, begin, end, unitById, isStunned, homeX, inRange, targetOf, depthOf } = ctx
  const { stepToward, KIND, UNIT_STATS } = k
  const naiveStep = ctx.isNaive('move.step'), naiveDepth = ctx.isNaive('move.depthOrder'), naiveGrid = ctx.isNaive('grid.update'), naiveTrail = ctx.isNaive('move.trail')
  const farX = (team: number) => (team === 0 ? k.MAX_COORD : 0)
  const moved: Unit[] = []

  // Where the unit steps this tick goes to gx, gy. False when it stays. Targets are read at their start-of-phase position.
  let gx = 0, gy = 0
  const moveGoal = (u: Unit): boolean => {
    if (isStunned(u) || u.garrison) return false
    if (u.fleeing) { gx = homeX(u.team); gy = u.y; return true }
    const t = naiveStep ? (u.target === -1 ? undefined : unitById.get(u.target)) : targetOf(u)
    if (t && inRange(u.x, u.y, t.sx, t.sy, UNIT_STATS[u.kind].range)) return false
    if (u.memberOf !== -1) { const p = naiveStep ? unitById.get(u.memberOf)! : u.pref!; gx = p.x + u.offX; gy = p.y + u.offY; return true }
    if (t) { gx = t.sx; gy = t.sy; return true }
    if (u.kind === KIND.MINION) { const s = naiveStep ? unitById.get(u.childOf)! : u.pref!; gx = s.x; gy = s.y; return true }
    gx = farX(u.team); gy = u.y
    return true
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
    for (let u_i = 0, u = units[0]; u_i < units.length; u = units[++u_i]) {
      if (naiveStep) u = unitById.get(u.gameId)!
      u.sx = u.x; u.sy = u.y
    }
    for (let level_i = 0, level = levels[0]; level_i < levels.length; level = levels[++level_i]) for (let u_i = 0, u = level[0]; u_i < level.length; u = level[++u_i]) {
      if (naiveStep) u = unitById.get(u.gameId)!
      if (!moveGoal(u)) continue
      add('q.move.units')
      ;[u.x, u.y] = stepToward(u.x, u.y, gx, gy, u.speed)
      if (naiveStep) { const w = unitById.get(u.gameId)!; w.x = u.x; w.y = u.y } // the write goes through the key too
      moved.push(u)
    }
    begin('move.trail')
    for (let u_i = 0, u = moved[0]; u_i < moved.length; u = moved[++u_i]) {
      if (u.x === u.sx && u.y === u.sy) continue
      if (naiveTrail) {
        u.trail = [...u.trail, u.x, u.y]
        if (u.trail.length > 2 * k.TRAIL_POINTS) u.trail = u.trail.slice(2)
      } else {
        u.trail.push(u.x, u.y)
        if (u.trail.length > 2 * k.TRAIL_POINTS) u.trail.splice(0, 2)
      }
    }
    end('move.trail')
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
