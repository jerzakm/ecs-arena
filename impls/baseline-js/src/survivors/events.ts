// The event lists of SPEC-survivors §3.3. Each type has a flat list of ints, `STRIDE[type]` ints for each event.
// The field order of one event lives here, in the writer `push` and in the readers below.
import type { CtxData } from './context.ts'

/** Ints that each event of a type takes in its flat list, indexed by EVENT. */
export const STRIDE = [2, 5, 1, 2, 1] as const

const field = (offset: number) => (list: readonly number[], at: number): number => list[at + offset]
/** HIT: mob gameId, traits. */
export const hitMob = field(0), hitTraits = field(1)
/** KILL: mob gameId, kind, x, y, flags. */
export const killId = field(0), killKind = field(1), killX = field(2), killY = field(3), killFlags = field(4)
/** PICKUP: pickup gameId, kind. */
export const pickupId = field(0), pickupKind = field(1)
/** LEVELUP: the new level. */
export const levelUpLevel = field(0)

export interface Events {
  /** Counts the event in the totals and appends its fields. `a` to `e` are the fields in the order of the readers. */
  push(type: number, a: number, b?: number, c?: number, d?: number, e?: number): void
  /** The list of one type, in push order. */
  eventsOf(type: number): number[]
}

export const createEvents = (ctx: CtxData): Events => {
  const { nv, add, begin, end } = ctx

  const pushToList: Events['push'] = (type, a, b = 0, c = 0, d = 0, e = 0) => {
    ctx.totals.evt[type] = (ctx.totals.evt[type] + 1) | 0
    const l = ctx.ev[type]
    l.push(a)
    if (STRIDE[type] > 1) l.push(b)
    if (STRIDE[type] > 2) l.push(c, d, e)
  }
  // The naive code keeps one list of all types: the type, then the fields.
  const pushToAll: Events['push'] = (type, a, b = 0, c = 0, d = 0, e = 0) => {
    ctx.totals.evt[type] = (ctx.totals.evt[type] + 1) | 0
    const l = ctx.evAll
    l.push(type)
    l.push(a)
    if (STRIDE[type] > 1) l.push(b)
    if (STRIDE[type] > 2) l.push(c, d, e)
  }

  const listOf = (type: number): number[] => ctx.ev[type]
  const scanOf = (type: number): number[] => {
    const out: number[] = []
    for (let i = 0; i < ctx.evAll.length; i += 1 + STRIDE[ctx.evAll[i]])
      if (ctx.evAll[i] === type) for (let j = 1; j <= STRIDE[type]; j++) out.push(ctx.evAll[i + j])
    return out
  }
  const read = nv['flag.reads'] ? scanOf : listOf

  return {
    push: nv['flag.reads'] ? pushToAll : pushToList,
    eventsOf: (type) => {
      begin('flag.reads')
      const out = read(type)
      end('flag.reads')
      add('evt.route', out.length / STRIDE[type])
      return out
    },
  }
}
