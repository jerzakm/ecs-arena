import { CAP } from './components.ts'

/** An exclusive link as a plain SoA component: `to[subject]` is the target entity or -1, `from[target]` lists subjects when reversed. Why not bitECS relations: CAPABILITIES.md, "Why not relations". */
export interface Link { to: Int32Array; from?: number[][] }
const link = (reverse = false): Link => ({
  to: new Int32Array(CAP).fill(-1),
  from: reverse ? Array.from<number[]>({ length: CAP }) : undefined,
})

export const Targets = link()
export const ChildOf = link(true)
export const MemberOf = link(true)
/** Formation offset of a member from its leader, indexed by the member. */
export const offsetX = new Int32Array(CAP), offsetY = new Int32Array(CAP)
export const GarrisonOf = link(true)
export const LastHitBy = link()
export const FiredBy = link()
/** The leader or summoner of a unit: its `MemberOf` target, else its `ChildOf` target, else -1. */
export const parentOf = (e: number) => (MemberOf.to[e] !== -1 ? MemberOf.to[e] : ChildOf.to[e])
export const LINKS = [Targets, ChildOf, MemberOf, GarrisonOf, LastHitBy, FiredBy]

/** Items a unit holds, with the quality of each: parallel arrays, one pair for each unit that holds items ("array of arrays", as the bitECS docs show). */
export const Equips = { items: Array.from<number[]>({ length: CAP }), quality: Array.from<number[]>({ length: CAP }) }
export const itemCount = (e: number) => Equips.items[e]?.length ?? 0

/** Threat on a victim from each attacker: parallel arrays of attacker entity and amount. */
export const Threat = { attackers: Array.from<number[]>({ length: CAP }), amount: Array.from<number[]>({ length: CAP }) }
export const threatCount = (e: number) => Threat.attackers[e]?.length ?? 0
export const addThreat = (victim: number, attacker: number, amount: number) => {
  const list = (Threat.attackers[victim] ??= []), values = (Threat.amount[victim] ??= [])
  const i = list.indexOf(attacker)
  if (i === -1) { list.push(attacker); values.push(amount) } else values[i] = amount
}
export const removeThreat = (victim: number, attacker: number) => {
  const list = Threat.attackers[victim]
  const i = list ? list.indexOf(attacker) : -1
  if (i === -1) return
  list.splice(i, 1); Threat.amount[victim].splice(i, 1)
}
export const clearThreat = (victim: number) => {
  if (Threat.attackers[victim]) Threat.attackers[victim].length = Threat.amount[victim].length = 0
}

const unindex = (l: Link, s: number, t: number) => {
  const list = l.from![t]
  if (list) { const i = list.indexOf(s); if (i !== -1) list.splice(i, 1) }
}

export const setLink = (s: number, l: Link, t: number) => {
  const old = l.to[s]
  if (old === t) return
  if (l.from) {
    if (old !== -1) unindex(l, s, old)
    ;(l.from[t] ??= []).push(s)
  }
  l.to[s] = t
}

export const clearLink = (s: number, l: Link) => {
  const old = l.to[s]
  if (old === -1) return
  if (l.from) unindex(l, s, old)
  l.to[s] = -1
}

/** Empties every link and per-entity list. The stores are module-level, so a new sim and a `load` start from empty. */
export const resetStores = () => {
  for (const l of LINKS) { l.to.fill(-1); l.from?.fill(undefined as never) }
  Equips.items.fill(undefined as never); Equips.quality.fill(undefined as never)
  Threat.attackers.fill(undefined as never); Threat.amount.fill(undefined as never)
}
