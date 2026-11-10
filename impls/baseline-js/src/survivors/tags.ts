// Status tags of a mob (SPEC-survivors §3.1). A tag is a bit in `flags`, and a timed tag also has a row in `timed`.
// The budget regions `move.gate`, `flag.reads` and `status.expire` have a naive version of the reads and writes here.
// createTags picks the normal or the naive function of each once, so a caller never asks which one it got.
import { survivors } from '@ecs-arena/spec'
import type { CtxData } from './context.ts'
import { ENT, type Mob, type Timed } from './types.ts'
import { pushTo } from '../shared/util.ts'

const { STATUS, STATUS_COUNT, AFFIX, AFFIX_COUNT } = survivors.kernel

export interface Tags {
  hasTag(m: Mob, id: number): boolean
  blocked(m: Mob, mask: number): boolean
  hasAffix(m: Mob, bit: number): boolean
  speedOf(m: Mob): number
  /** The candidates that no tag of `mask` blocks, in the same order. */
  gateFree(cands: Mob[], mask: number): Mob[]
  addTag(m: Mob, id: number, until: number, delta?: number): void
  /** Registers every timed tag of every mob in the expiry wheel again. `load` calls it after it rebuilt the mobs. */
  reschedule(): void
}

export const timedOf = (m: Mob, id: number): Timed | undefined => {
  for (let i = 0; i < m.timed.length; i++) if (m.timed[i].id === id) return m.timed[i]
  return undefined
}

/** ELITE and DYING are bits of `flags` only. They have no row in `timed`. */
const isFlagOnly = (id: number) => id === STATUS.ELITE || id === STATUS.DYING

/** The naive read of one tag: ELITE and DYING are bits, every other tag is a row of the timed list. */
export const scanHasTag = (m: Mob, id: number): boolean => {
  if (isFlagOnly(id)) return ((m.flags >> id) & 1) === 1
  for (let i = 0; i < m.timed.length; i++) if (m.timed[i].id === id) return true
  return false
}

const idsOf = (mask: number): number[] => Array.from({ length: STATUS_COUNT }, (_, i) => i).filter((i) => mask & (1 << i))

export const removeTag = (ctx: CtxData, m: Mob, id: number) => {
  ctx.add('tag.remove')
  m.flags &= ~ctx.k.bit(id as survivors.kernel.StatusId)
  for (let i = 0; i < m.timed.length; i++) if (m.timed[i].id === id) { m.timed.splice(i, 1); break }
  if (id === STATUS.SHIELDED) m.shield = 0
}

export const createTags = (ctx: CtxData): Tags => {
  const { k, nv, add, begin, end } = ctx
  const maskIds = new Map([k.BLOCKS_MOVE, k.BLOCKS_ACT, k.IMMUNE_HIT].map((mask) => [mask, idsOf(mask)]))

  const maskHasTag = (m: Mob, id: number) => ((m.flags >> id) & 1) === 1
  const hasTag = nv['move.gate'] ? scanHasTag : maskHasTag

  const maskBlocked = (m: Mob, mask: number) => (m.flags & mask) !== 0
  const scanBlocked = (m: Mob, mask: number) => (maskIds.get(mask) ?? idsOf(mask)).some((id) => scanHasTag(m, id))
  const blocked = nv['move.gate'] ? scanBlocked : maskBlocked

  const maskHasAffix = (m: Mob, bit: number) => (m.affix & bit) !== 0
  const scanHasAffix = (m: Mob, bit: number) => {
    const set: number[] = []
    for (let i = 0; i < AFFIX_COUNT; i++) if ((m.affix >> i) & 1) set.push(1 << i)
    return set.includes(bit)
  }
  const hasAffix = nv['flag.reads'] ? scanHasAffix : maskHasAffix

  const fastSpeed = (m: Mob) => k.mobSpeed(m.kind, m.affix, m.flags)
  const composedSpeed = (m: Mob) => {
    let s = k.MOBS[m.kind].speed
    if (hasAffix(m, AFFIX.SWIFT)) s = k.fx.div(s * 3, 2)
    if (hasTag(m, STATUS.ENRAGED)) s = k.fx.div(s * 3, 2)
    if (hasTag(m, STATUS.SLOWED)) s = k.fx.div(s, 2)
    return s
  }
  const speedOf = nv['flag.reads'] || nv['move.gate'] ? composedSpeed : fastSpeed

  const gateFreeByMask = (cands: Mob[], mask: number): Mob[] => {
    begin('move.gate')
    const out: Mob[] = []
    for (let i = 0; i < cands.length; i++) if (!(cands[i].flags & mask)) out.push(cands[i])
    end('move.gate')
    add('gate.blocked', cands.length - out.length)
    return out
  }
  const gateFreeByScan = (cands: Mob[], mask: number): Mob[] => {
    begin('move.gate')
    const out: Mob[] = []
    for (let i = 0; i < cands.length; i++) if (!scanBlocked(cands[i], mask)) out.push(cands[i])
    end('move.gate')
    add('gate.blocked', cands.length - out.length)
    return out
  }

  /** Sets the bit and, for a timed tag, merges into its row or adds one. Returns the `until` that the row has now. */
  const mergeTimed = (m: Mob, id: number, until: number, delta: number): number => {
    let i = 0
    while (i < m.timed.length && m.timed[i].id < id) i++
    const t = m.timed[i]
    if (t && t.id === id) {
      t.until = k.mergeUntil(t.until, until)
      if (id === STATUS.BURNING) t.stacks = Math.min(k.BURN_MAX_STACKS, t.stacks + delta)
      return t.until
    }
    m.timed.splice(i, 0, { id, until, stacks: id === STATUS.BURNING ? delta : 0 })
    return until
  }
  const setBit = (m: Mob, id: number) => {
    add('tag.add')
    m.flags |= k.bit(id as survivors.kernel.StatusId)
  }
  /** The wheel lists the mobs by the tick on which a tag of theirs may expire. */
  const addTagToWheel = (m: Mob, id: number, until: number, delta = 0) => {
    setBit(m, id)
    if (isFlagOnly(id)) return
    pushTo(ctx.wheel, mergeTimed(m, id, until, delta), m)
  }
  const addTagNoWheel = (m: Mob, id: number, until: number, delta = 0) => {
    setBit(m, id)
    if (isFlagOnly(id)) return
    mergeTimed(m, id, until, delta)
  }

  const rebuildWheel = () => {
    ctx.wheel.clear()
    for (const m of ctx.lists[ENT.MOB]) for (const t of m.timed) pushTo(ctx.wheel, t.until, m)
  }
  const clearWheel = () => ctx.wheel.clear()

  return {
    hasTag, blocked, hasAffix, speedOf,
    gateFree: nv['move.gate'] ? gateFreeByScan : gateFreeByMask,
    addTag: nv['status.expire'] ? addTagNoWheel : addTagToWheel,
    reschedule: nv['status.expire'] ? clearWheel : rebuildWheel,
  }
}
