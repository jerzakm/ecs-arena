import type { Context } from '../context.ts'
import { buildGrid, forNear } from '../spatial.ts'

export const objectivesSystem = (ctx: Context) => {
  const { k, add, world, shrines, inRange } = ctx

  return () => {
    const grid = buildGrid(ctx)
    for (let s_i = 0, s = shrines[0]; s_i < shrines.length; s = shrines[++s_i]) {
      const count = [0, 0]
      forNear(ctx, grid, k.SHRINE_X, s.y, k.SHRINE_RADIUS, (u) => {
        if (!u.fleeing && inRange(k.SHRINE_X, s.y, u.x, u.y, k.SHRINE_RADIUS)) count[u.team]++
      }, 'shrine')
      const step = Math.max(-k.SHRINE_STEP_MAX, Math.min(k.SHRINE_STEP_MAX, count[0] - count[1]))
      s.progress = Math.max(-k.SHRINE_PROGRESS_MAX, Math.min(k.SHRINE_PROGRESS_MAX, s.progress + step))
      const was = s.owner
      if (s.progress === k.SHRINE_PROGRESS_MAX) s.owner = 0
      else if (s.progress === -k.SHRINE_PROGRESS_MAX) s.owner = 1
      if (s.owner !== was) add('shrine.capture')
    }
    world.score = [shrines.filter((s) => s.owner === 0).length, shrines.filter((s) => s.owner === 1).length]
  }
}
