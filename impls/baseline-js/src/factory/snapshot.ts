import type { CanonicalState } from '@ecs-arena/spec'
import type { Ctx } from './context.ts'
import { flagsOf } from './entities.ts'

/** SPEC-factory §8. The changed list is sorted here, so a run that never takes a snapshot never pays for the sort. */
export const snapshot = (ctx: Ctx): CanonicalState => {
  const { k, totals, changed, drones, crates } = ctx
  const s: number[] = k.worldHeader(totals, {
    powered: ctx.up.filter(Boolean).length, working: ctx.work.length, drones: drones.length, crates: crates.length,
  })
  changed.sort((a, b) => a.gameId - b.gameId)
  s.push(changed.length)
  for (let i = 0; i < changed.length; i++) {
    const m = changed[i]
    s.push(m.gameId, m.kind, m.input, m.output, m.progress, flagsOf(k, m))
  }
  for (let i = 0; i < drones.length; i++) {
    const d = drones[i]
    s.push(d.gameId, d.x, d.y, d.vx, d.vy, d.c, d.s, d.born, d.goal, d.cargo, d.item)
    s.push(d.source.gameId, d.sink.gameId, d.top ? d.top.gameId : -1)
  }
  for (let i = 0; i < crates.length; i++) {
    const c = crates[i]
    s.push(c.gameId, (c.below ?? c.drone).gameId, c.item, c.x, c.y, c.c, c.s)
  }
  return s
}
