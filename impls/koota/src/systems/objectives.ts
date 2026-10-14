import type { Context } from '../context.ts'
import { Fleeing, Position, Score, Shrine } from '../components.ts'

export const objectivesSystem = (ctx: Context) => {
  const { k, world } = ctx

  return () => {
    const shrines = ctx.sortedByGameId(Shrine)
    for (const { e } of shrines) {
      const pos = e.get(Position)!
      const count = [0, 0]
      ctx.grid.forNear(pos.x, pos.y, k.SHRINE_RADIUS, (h) => {
        if (!ctx.unitAt[h].has(Fleeing)) count[ctx.teamAt[h]]++
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
