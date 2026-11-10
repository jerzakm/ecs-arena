// Links between units as plain SoA components, not bitECS relations (CAPABILITIES.md, "Why not relations").
import { CAP } from './components.ts'

type Lists = number[][]
const lists = (): Lists => Array.from<number[]>({ length: CAP })
/** An exclusive link: `to[subject]` is the target entity or -1, `from[target]` lists subjects when reversed. */
export interface Link { to: Int32Array; from?: Lists }
export interface ReverseLink extends Link { from: Lists }
const link = (): Link => ({ to: new Int32Array(CAP).fill(-1) })
const reverseLink = (): ReverseLink => ({ ...link(), from: lists() })

export const Targets = link()
export const ChildOf = reverseLink()
/** The leader of a member. `offsetX` and `offsetY` are the formation offset of the member from its leader, indexed by the member. */
export const MemberOf = { ...reverseLink(), offsetX: new Int32Array(CAP), offsetY: new Int32Array(CAP) }
export const GarrisonOf = reverseLink()
export const LastHitBy = link()
export const FiredBy = link()
/** The leader or summoner of a unit: its `MemberOf` target, else its `ChildOf` target, else -1. */
export const parentOf = (e: number) => (MemberOf.to[e] !== -1 ? MemberOf.to[e] : ChildOf.to[e])
export const LINKS = [Targets, ChildOf, MemberOf, GarrisonOf, LastHitBy, FiredBy]

/** Items a unit holds, with the quality of each: parallel arrays for each unit that holds items (the bitECS docs' "array of arrays"). */
export const Equips = { items: lists(), quality: lists() }
export const itemCount = (e: number) => Equips.items[e]?.length ?? 0

/** Threat on a victim from each attacker: parallel arrays of attacker entity and amount. */
export const Threat = { attackers: lists(), amount: lists() }
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

const unindex = (from: Lists, s: number, t: number) => {
  const list = from[t]
  if (list) { const i = list.indexOf(s); if (i !== -1) list.splice(i, 1) }
}

export const setLink = (s: number, l: Link, t: number) => {
  const old = l.to[s]
  if (old === t) return
  const { from } = l
  if (from) {
    if (old !== -1) unindex(from, s, old)
    ;(from[t] ??= []).push(s)
  }
  l.to[s] = t
}

export const clearLink = (s: number, l: Link) => {
  const old = l.to[s]
  if (old === -1) return
  if (l.from) unindex(l.from, s, old)
  l.to[s] = -1
}

/** Empties every link and per-entity list. The stores are module-level, so a new sim and a `load` start from empty. */
export const resetStores = () => {
  // The stores are filled sparsely, so a slot can be undefined. Widening the parameter type lets fill(undefined) type-check.
  const clear = (a: (number[] | undefined)[]) => a.fill(undefined)
  for (const l of LINKS) { l.to.fill(-1); if (l.from) clear(l.from) }
  clear(Equips.items); clear(Equips.quality); clear(Threat.attackers); clear(Threat.amount)
}
