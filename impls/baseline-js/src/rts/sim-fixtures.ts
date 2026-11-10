// Shared helpers of the behaviour tests (sim.*.heavy.test.ts): fights that run once, a tape of snapshots, and the rules that tests replay.
import { PHASES, type Scenario, kernel } from '@ecs-arena/spec'
import { FLEEING, type PUnit, type Parsed, SMALL, parse } from './testkit.ts'
import createSim from './index.ts'

/** Runs `sc.ticks` ticks and returns the parsed snapshot after each one. */
export const run = (sc: Scenario): Parsed[] => {
  const sim = createSim(sc, kernel)
  return Array.from({ length: sc.ticks }, () => {
    for (const p of PHASES) sim.phases[p]()
    return parse(sim.snapshot())
  })
}

export const { KIND, BUFF, UNIT_STATS, ITEMS, FX, SQUADS, PURPOSE, distSq, stepToward, randInt, teamGameId, isCrit } = kernel

export const memo = <T>(f: () => T) => { let v: T | undefined; return () => (v ??= f()) }

export const index = (s: Parsed) => new Map(s.units.map((u) => [u.gameId, u]))

/**
 * Runs `sc.ticks` ticks and keeps each snapshot as raw int32s, parsed again on access.
 * The parsed snapshots of every tick of a fight take about 800 MB, so the fights do not fit in a 2 GB heap.
 * The cache holds more ticks than the 61-tick burn window, so a test that slides over a fight parses each tick once.
 */
export class Tape {
  private readonly raw: Int32Array[] = []
  private readonly cache = new Map<number, { s: Parsed; m?: Map<number, PUnit> }>()
  constructor(sc: Scenario) {
    const sim = createSim(sc, kernel)
    for (let t = 0; t < sc.ticks; t++) {
      for (const p of PHASES) sim.phases[p]()
      const s = sim.snapshot()
      const a = Int32Array.from(s)
      if (a.some((v, i) => v !== s[i])) parse(s) // throws the int32 error that Int32Array.from hides
      this.raw.push(a)
    }
  }
  get length() { return this.raw.length }
  tick(i: number) { return this.raw[i][0] }
  private entry(i: number) {
    const e = this.cache.get(i) ?? { s: parse(this.raw[i]) }
    this.cache.delete(i)
    this.cache.set(i, e)
    if (this.cache.size > 128) this.cache.delete(this.cache.keys().next().value!)
    return e
  }
  at(i: number) { return this.entry(i).s }
  units(i: number) { const e = this.entry(i); return (e.m ??= index(e.s)) }
  *[Symbol.iterator]() { for (let i = 0; i < this.length; i++) yield this.at(i) }
}

export const SEEDS = [SMALL.seed, 5]
export const fights = memo(() => SEEDS.map((seed) => {
  const sc = { ...SMALL, garrisonCap: 0, ordersPerTeam: 0, seed }
  return { sc, h: new Tape(sc) }
}))

export interface Step { seed: number; t: number; h: Tape; p: Parsed; c: Parsed; pm: Map<number, PUnit>; cm: Map<number, PUnit> }
export const stepsOf = (seed: number, h: Tape): Step[] => Array.from({ length: h.length - 1 }, (_, i) => ({
  seed, t: h.tick(i + 1), h,
  get p() { return h.at(i) }, get c() { return h.at(i + 1) }, get pm() { return h.units(i) }, get cm() { return h.units(i + 1) },
}))
export const steps = memo(() => fights().flatMap(({ sc, h }) => stepsOf(sc.seed, h)))
/** A bigger fight with a different seed, for rules that need many kills by one unit. */
export const veteranFight = memo(() => {
  const sc = { ...SMALL, garrisonCap: 0, ordersPerTeam: 0, seed: 11, targetPop: 300, maxSquadsPerWave: 30, ticks: 1500 }
  return stepsOf(sc.seed, new Tape(sc))
})

export const stunned = (u: PUnit) => u.buffs.some((b) => b.kind === BUFF.STUN)
export const fleeing = (u: PUnit) => (u.flags & FLEEING) !== 0
export const homeX = (team: number) => (team === 0 ? 0 : kernel.MAX_COORD)
export const inRange = (a: { x: number; y: number }, b: { x: number; y: number }, r: number) => distSq(a.x, a.y, b.x, b.y) <= r * r
export const vanished = (s: Step) => s.p.units.filter((u) => !s.cm.has(u.gameId))
/** SPEC 6.4 step 4: at least 6 enemy units target the victim. Targets after ai/target are the targets at the start of combat. */
export const overwhelmedAt = (s: Step, v: PUnit) => s.c.units.filter((a) => a.target === v.gameId && a.team !== v.team).length >= kernel.OVERWHELM_ATTACKERS
/** A fleeing unit that starts its move on its home edge, or one step from it, leaves in that tick. */
export const leaves = (u: PUnit) => fleeing(u) && Math.abs(u.x - homeX(u.team)) <= (stunned(u) ? 0 : u.speed)
/** A unit that was not fleeing and vanished beside its home edge may have died or have fled and left in the same tick. */
export const ambiguous = (s: Step) => vanished(s).some((u) => !leaves(u) && Math.abs(u.x - homeX(u.team)) <= u.speed)
/** A unit that appears in this tick is invisible to the start-of-tick snapshot, so tests that replay a phase skip these ticks. */
export const spawned = (s: Step) => s.c.units.some((u) => !s.pm.has(u.gameId))
export const attacked = (p: PUnit, c: PUnit) => p.cooldown === 0 && c.cooldown === UNIT_STATS[c.kind].cooldown - 1
export const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)
/** SPEC §4 set bonus of a unit, from its items only. */
export const setBonus = (u: PUnit, f: 'attack' | 'armor' | 'speed') => {
  const has = (k: number) => u.items.some((it) => it.kind === k)
  return sum(kernel.SETS.map((st) => (has(st.items[0]) && has(st.items[1]) ? st[f] : 0)))
}
export const MELEE = new Set<number>([KIND.WARRIOR, KIND.MINION, KIND.WARLORD])
export const STUNNERS = new Set<number>([KIND.WARRIOR, KIND.WARLORD])

/** The start-of-tick target that SPEC §6.2 gives each unit that is not stunned. */
export type Rule = 'none' | 'retaliation' | 'keep' | 'think' | 'idle' | 'heal-keep' | 'heal-think' | 'heal-idle'
export const expectedTarget = (p: Parsed, pm: Map<number, PUnit>, u: PUnit, t: number): { id: number; rule: Rule; ties: number } => {
  const st = UNIT_STATS[u.kind]
  const think = (u.gameId + t) % kernel.THINK_INTERVAL === 0
  const cur = u.target === -1 ? undefined : pm.get(u.target)
  if (fleeing(u) || u.kind === KIND.SUMMONER) return { id: -1, rule: 'none', ties: 0 }
  if (u.kind === KIND.HEALER) {
    if (cur && cur.hp < cur.maxHp && inRange(u, cur, st.range)) return { id: cur.gameId, rule: 'heal-keep', ties: 0 }
    if (!think) return { id: -1, rule: 'heal-idle', ties: 0 }
    let best: PUnit | undefined, ties = 0
    for (const v of p.units) {
      if (v.team !== u.team || v === u || v.hp >= v.maxHp || !inRange(u, v, st.range)) continue
      if (!best) { best = v; continue }
      const a = v.hp * best.maxHp, b = best.hp * v.maxHp
      if (a === b) ties++
      if (a < b || (a === b && v.gameId < best.gameId)) best = v
    }
    return { id: best?.gameId ?? -1, rule: 'heal-think', ties }
  }
  const valid = (v: PUnit) => v.team !== u.team && !fleeing(v) && inRange(u, v, st.sight)
  let retaliate: PUnit | undefined, amount = 0
  for (const e of u.threat) {
    const a = pm.get(e.attacker)
    if (e.amount < 20 || !a || !valid(a)) continue
    if (!retaliate || e.amount > amount || (e.amount === amount && a.gameId < retaliate.gameId)) { retaliate = a; amount = e.amount }
  }
  if (retaliate) return { id: retaliate.gameId, rule: 'retaliation', ties: 0 }
  if (cur && valid(cur)) return { id: cur.gameId, rule: 'keep', ties: 0 }
  if (!think) return { id: -1, rule: 'idle', ties: 0 }
  let best: PUnit | undefined, bestD = 0
  for (const v of p.units) {
    if (!valid(v)) continue
    const d = distSq(u.x, u.y, v.x, v.y)
    if (!best || d < bestD || (d === bestD && v.gameId < best.gameId)) { best = v; bestD = d }
  }
  return { id: best?.gameId ?? -1, rule: 'think', ties: 0 }
}

export const aiCache = new WeakMap<Step, Map<number, ReturnType<typeof expectedTarget>>>()
export const aiOf = (s: Step) => {
  let m = aiCache.get(s)
  if (!m) {
    m = new Map()
    for (const u of s.p.units) if (!stunned(u)) m.set(u.gameId, expectedTarget(s.p, s.pm, u, s.t))
    aiCache.set(s, m)
  }
  return m
}

/** Formation offset of each parented unit, derived from the spawn rules at the tick it first appears (SPEC §5.3). */
export const slotOffsets = memo(() => {
  const slots = new Map<string, { parent: number; offX: number; offY: number }>()
  for (const { sc, h } of fights()) {
    const seen = new Set<number>()
    for (const s of h) {
      const rank = new Map<number, number>()
      const byId = new Map(s.units.map((x) => [x.gameId, x]))
      for (const u of s.units) {
        if (seen.has(u.gameId)) continue
        seen.add(u.gameId)
        if (u.leader === -1) continue
        const i = rank.get(u.leader) ?? 0
        rank.set(u.leader, i + 1)
        const facing = u.team === 0 ? 1 : -1
        if (byId.get(u.leader)!.kind === KIND.WARLORD) slots.set(`${sc.seed}:${u.gameId}`, { parent: u.leader, offX: -facing * 4 * FX, offY: (2 * i - 3) * 4 * FX })
        else slots.set(`${sc.seed}:${u.gameId}`, { parent: u.leader, offX: -facing * (1 + Math.trunc(i / 3)) * 2 * FX, offY: ((i % 3) - 1) * 2 * FX })
      }
    }
  }
  return slots
})

/** SPEC 6.13 from the snapshot: the root of the MemberOf and ChildOf chain is a warlord and the unit is not the root. */
export const bannerOf = (byId: Map<number, PUnit>, u: PUnit): boolean => {
  let root = u
  for (let p = byId.get(root.leader !== -1 ? root.leader : root.parent); p; p = byId.get(root.leader !== -1 ? root.leader : root.parent)) root = p
  return root !== u && root.kind === KIND.WARLORD
}

/** Members that stay under `d` when it goes: a squad leader that flees in the same tick has already left its warlord. */
export const survivingMembers = (s: Step, d: PUnit) =>
  s.p.units.filter((m) => m.leader === d.gameId && s.cm.has(m.gameId) && !(m.moraleSize0 !== -1 && fleeing(s.cm.get(m.gameId)!)))
