import type { Context } from '../context.ts'
import { Position, Score, Shrine } from '../components.ts'
import { buildGrid, forNear } from '../spatial.ts'

export const objectivesSystem = (ctx: Context) => {
  const { k, world, inRange } = ctx

  return () => {
    const grid = buildGrid(ctx)
    const shrines = ctx.sortedByGameId(Shrine)
    for (const { e } of shrines) {
      const pos = e.get(Position)!
      const count = [0, 0]
      forNear(ctx, grid, pos.x, pos.y, k.SHRINE_RADIUS, (v) => {
        if (inRange(pos.x, pos.y, v.x, v.y, k.SHRINE_RADIUS) && !v.fleeing) count[v.team]++
      })
      const step = Math.max(-k.SHRINE_STEP_MAX, Math.min(k.SHRINE_STEP_MAX, count[0] - count[1]))
      e.set(Shrine, (s) => {
        const progress = Math.max(-k.SHRINE_PROGRESS_MAX, Math.min(k.SHRINE_PROGRESS_MAX, s.progress + step))
        return { progress, owner: progress === k.SHRINE_PROGRESS_MAX ? 0 : progress === -k.SHRINE_PROGRESS_MAX ? 1 : s.owner }
      })
    }
    const owned = [0, 0]
    world.query(Shrine).readEach(([s]) => { if (s.owner >= 0) owned[s.owner]++ })
    world.set(Score, { shrines0: owned[0], shrines1: owned[1] })
  }
}
