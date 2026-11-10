// The budget region `query.match`: does a system have anything to do? The normal code reads a counter that creation and destruction keep.
// The naive code scans the entities. Both count the run or the skip, which the liveness rows read.
import type { CtxData } from './context.ts'
import { ENT } from './types.ts'

export interface Gates {
  /** True when the system `id` should run. `normal` is the answer from the counters and `scan` is the answer from the entities. */
  gate(id: string, normal: boolean, scan: () => boolean): boolean
  /** True when a mob of one of the kinds is alive. */
  kindGate(id: string, ...kinds: number[]): boolean
}

export const createGates = (ctx: CtxData): Gates => {
  const { nv, add, begin, end } = ctx
  const answerFromCounter = (normal: boolean, _scan: () => boolean) => normal
  const answerFromScan = (_normal: boolean, scan: () => boolean) => scan()
  const answer = nv['query.match'] ? answerFromScan : answerFromCounter

  const gate: Gates['gate'] = (id, normal, scan) => {
    begin('query.match')
    const go = answer(normal, scan)
    end('query.match')
    add(go ? `sys.${id}` : 'q.idleSkip')
    return go
  }
  return {
    gate,
    kindGate: (id, ...kinds) => gate(id, kinds.some((kind) => ctx.kindCount[kind] > 0), () => {
      const mobs = ctx.lists[ENT.MOB]
      for (let i = 0; i < mobs.length; i++) if (kinds.includes(mobs[i].kind)) return true
      return false
    }),
  }
}
