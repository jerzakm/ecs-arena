// Behaviour tests through the Sim API and the SPEC §8 snapshot only.
// Rules that need a fight run the skirmish scenario once, then check every tick against the tick before it.
// "p" is the snapshot at the start of a tick, "c" the snapshot at its end.
import { describe, it } from 'vitest'
import { PHASES, kernel, type Scenario } from '@ecs-arena/spec'
import { expect } from './fast-expect.ts'
import { BANNERED, FLEEING, GARRISONED, OVERWHELMED, ROUTED, SMALL, VETERAN, parse, scenario, type Parsed, type PProjectile, type PUnit } from './testkit.ts'
import createSim from './index.ts'

/** Runs `sc.ticks` ticks and returns the parsed snapshot after each one. */
const run = (sc: Scenario): Parsed[] => {
  const sim = createSim(sc, kernel)
  return Array.from({ length: sc.ticks }, () => {
    for (const p of PHASES) sim.phases[p]()
    return parse(sim.snapshot())
  })
}

const { KIND, BUFF, UNIT_STATS, ITEMS, FX, SQUADS, PURPOSE, distSq, stepToward, randInt, teamGameId, isCrit } = kernel

const memo = <T>(f: () => T) => { let v: T | undefined; return () => (v ??= f()) }

const SEEDS = [SMALL.seed, 5]
const fights = memo(() => SEEDS.map((seed) => {
  const sc = { ...SMALL, garrisonCap: 0, ordersPerTeam: 0, seed }
  return { sc, h: run(sc) }
}))

interface Step { seed: number; t: number; h: Parsed[]; p: Parsed; c: Parsed; pm: Map<number, PUnit>; cm: Map<number, PUnit> }
const index = (s: Parsed) => new Map(s.units.map((u) => [u.gameId, u]))
const stepsOf = (seed: number, h: Parsed[]): Step[] => {
  const maps = h.map(index)
  return h.slice(1).map((c, i) => ({ seed, t: c.tick, h, p: h[i], c, pm: maps[i], cm: maps[i + 1] }))
}
const steps = memo(() => fights().flatMap(({ sc, h }) => stepsOf(sc.seed, h)))
/** A bigger fight with a different seed, for rules that need many kills by one unit. */
const veteranFight = memo(() => {
  const sc = { ...SMALL, garrisonCap: 0, ordersPerTeam: 0, seed: 11, targetPop: 300, maxSquadsPerWave: 30, ticks: 1500 }
  return stepsOf(sc.seed, run(sc))
})

const stunned = (u: PUnit) => u.buffs.some((b) => b.kind === BUFF.STUN)
const fleeing = (u: PUnit) => (u.flags & FLEEING) !== 0
const homeX = (team: number) => (team === 0 ? 0 : kernel.MAX_COORD)
const inRange = (a: { x: number; y: number }, b: { x: number; y: number }, r: number) => distSq(a.x, a.y, b.x, b.y) <= r * r
const vanished = (s: Step) => s.p.units.filter((u) => !s.cm.has(u.gameId))
/** SPEC 6.4 step 4: at least 6 enemy units target the victim. Targets after ai/target are the targets at the start of combat. */
const overwhelmedAt = (s: Step, v: PUnit) => s.c.units.filter((a) => a.target === v.gameId && a.team !== v.team).length >= kernel.OVERWHELM_ATTACKERS
/** A fleeing unit that starts its move on its home edge, or one step from it, leaves in that tick. */
const leaves = (u: PUnit) => fleeing(u) && Math.abs(u.x - homeX(u.team)) <= (stunned(u) ? 0 : u.speed)
/** A unit that was not fleeing and vanished beside its home edge may have died or have fled and left in the same tick. */
const ambiguous = (s: Step) => vanished(s).some((u) => !leaves(u) && Math.abs(u.x - homeX(u.team)) <= u.speed)
/** A unit that appears in this tick is invisible to the start-of-tick snapshot, so tests that replay a phase skip these ticks. */
const spawned = (s: Step) => s.c.units.some((u) => !s.pm.has(u.gameId))
const attacked = (p: PUnit, c: PUnit) => p.cooldown === 0 && c.cooldown === UNIT_STATS[c.kind].cooldown - 1
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)
/** SPEC §4 set bonus of a unit, from its items only. */
const setBonus = (u: PUnit, f: 'attack' | 'armor' | 'speed') => {
  const has = (k: number) => u.items.some((it) => it.kind === k)
  return sum(kernel.SETS.map((st) => (has(st.items[0]) && has(st.items[1]) ? st[f] : 0)))
}
const MELEE = new Set<number>([KIND.WARRIOR, KIND.MINION, KIND.WARLORD])
const STUNNERS = new Set<number>([KIND.WARRIOR, KIND.WARLORD])

/** The start-of-tick target that SPEC §6.2 gives each unit that is not stunned. */
type Rule = 'none' | 'retaliation' | 'keep' | 'think' | 'idle' | 'heal-keep' | 'heal-think' | 'heal-idle'
const expectedTarget = (p: Parsed, pm: Map<number, PUnit>, u: PUnit, t: number): { id: number; rule: Rule; ties: number } => {
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

const aiCache = new WeakMap<Step, Map<number, ReturnType<typeof expectedTarget>>>()
const aiOf = (s: Step) => {
  let m = aiCache.get(s)
  if (!m) {
    m = new Map()
    for (const u of s.p.units) if (!stunned(u)) m.set(u.gameId, expectedTarget(s.p, s.pm, u, s.t))
    aiCache.set(s, m)
  }
  return m
}

/** Formation offset of each parented unit, derived from the spawn rules at the tick it first appears (SPEC §5.3). */
const slotOffsets = memo(() => {
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

describe('snapshot layout', () => {
  it('starts at tick 0 with 7 untaken shrines and no damage, kills or winner', () => {
    const [s] = run(scenario({ targetPop: 1000, maxSquadsPerWave: 2 }))
    expect(s.tick).toBe(0)
    expect(s.winner).toBe(-1)
    expect(s.kills).toEqual([0, 0])
    expect(s.damage).toEqual([0, 0])
    expect(s.score).toEqual([0, 0])
    expect(s.shrines).toEqual([1, 2, 3, 4, 5, 6, 7].map((gameId) => ({ gameId, owner: -1, progress: 0, garrison: [] })))
    expect(s.projectiles).toEqual([])
    expect(s.ground).toEqual([])
  })

  it('lists projectiles and ground items in gameId order, and sees both kinds of record', () => {
    let seen = 0
    for (const { c } of steps()) {
      for (const list of [c.projectiles, c.ground]) {
        expect(list.map((r) => r.gameId)).toEqual(list.map((r) => r.gameId).sort((a, b) => a - b))
        seen += list.length
      }
    }
    expect(seen).toBeGreaterThan(0)
  })

  it('rejects a value that is not an int32 integer', () => {
    const sim = createSim(scenario(), kernel)
    for (const p of PHASES) sim.phases[p]()
    const flat = sim.snapshot()
    expect(() => parse(flat)).not.toThrow()
    expect(() => parse(flat.map((v, i) => (i === 3 ? v + 0.5 : v)))).toThrow(/int32/)
    expect(() => parse(flat.map((v, i) => (i === 3 ? 2 ** 31 : v)))).toThrow(/int32/)
  })

  it('counts alive units, sorts by gameId, and keeps relations pointing at units that exist', () => {
    for (const s of steps()) {
      const c = s.c
      expect([c.units.filter((u) => u.team === 0).length, c.units.filter((u) => u.team === 1).length]).toEqual(c.alive)
      expect(c.score).toEqual([c.shrines.filter((x) => x.owner === 0).length, c.shrines.filter((x) => x.owner === 1).length])
      for (let i = 1; i < c.units.length; i++) expect(c.units[i].gameId).toBeGreaterThan(c.units[i - 1].gameId)
      for (const u of c.units) {
        for (const r of [u.target, u.leader, u.parent, u.lastHitBy]) expect(r === -1 || s.cm.has(r)).toBe(true)
        expect(u.items.map((x) => x.gameId)).toEqual(u.items.map((x) => x.gameId).sort((a, b) => a - b))
      }
      for (const p of c.projectiles) expect(s.cm.has(p.target)).toBe(true)
    }
  })

  it('never reuses a gameId across kinds', () => {
    const seen = new Map<number, string>()
    const claim = (id: number, kind: string) => { if (!seen.has(id)) seen.set(id, kind); expect(seen.get(id)).toBe(kind) }
    for (const s of fights()[0].h) {
      for (const sh of s.shrines) claim(sh.gameId, 'shrine')
      for (const u of s.units) { claim(u.gameId, 'unit'); for (const it of u.items) claim(it.gameId, 'item') }
      for (const p of s.projectiles) claim(p.gameId, 'projectile')
    }
  })

  it('makes lastHitBy an enemy unit, and shows -1 once that unit is gone', () => {
    let seen = 0
    for (const { c, cm } of steps()) for (const u of c.units) if (u.lastHitBy !== -1) { expect(cm.get(u.lastHitBy)!.team).toBe(1 - u.team); seen++ }
    expect(seen).toBeGreaterThan(0)
  })
})

describe('spawn order and warbands', () => {
  const s = run(scenario({ targetPop: 1000, maxSquadsPerWave: 6, wavePeriod: 1_000_000 }))[0]
  const team = (n: number) => s.units.filter((u) => u.team === n)

  it('gives shrines gameIds 1 to 7, then each unit its gameId followed by its own items', () => {
    const first = s.units[0]
    expect(first.gameId).toBe(8)
    s.units.forEach((u, i) => {
      u.items.forEach((it, k) => expect(it.gameId).toBe(u.gameId + 1 + k))
      if (i + 1 < s.units.length) expect(s.units[i + 1].gameId).toBe(u.gameId + 1 + u.items.length)
    })
  })

  it('spawns team 0 first, and a warlord before the first squad of each warband of 4 squads', () => {
    expect(s.units.map((u) => u.team)).toEqual(s.units.map((u) => u.team).sort())
    for (const n of [0, 1]) {
      const units = team(n)
      const warlords = units.filter((u) => u.kind === KIND.WARLORD)
      expect(warlords).toHaveLength(2)
      expect(units[0].kind).toBe(KIND.WARLORD)
      const leaders = (w: PUnit) => units.filter((u) => u.leader === w.gameId)
      expect(warlords.map((w) => leaders(w).length)).toEqual([4, 2])
      const band = units.filter((u) => u === warlords[0] || leaders(warlords[0]).some((l) => u === l || u.leader === l.gameId))
      expect(units.indexOf(warlords[1])).toBe(band.length)
      for (const w of warlords) expect(w.leader).toBe(-1)
    }
  })

  it('gives each squad leader Morale of its squad size, and a squad its member kinds in slot order', () => {
    for (const leader of s.units.filter((u) => u.moraleSize0 !== -1)) {
      const members = s.units.filter((u) => u.leader === leader.gameId)
      expect(leader.moraleSize0).toBe(1 + members.length)
      expect(leader.moraleLost).toBe(0)
      const squad = SQUADS.find((q) => q.leader === leader.kind && q.members.length === members.length && q.members.every((k, i) => members[i].kind === k))
      expect(squad).toBeDefined()
    }
    expect(s.units.filter((u) => u.moraleSize0 === -1 && u.leader !== -1).every((u) => u.kind !== KIND.WARLORD)).toBe(true)
  })

  // The snapshot follows the move phase of tick 0, where nobody has a target, so y is exact and x is one step off.
  it('places warlords, leaders and members by the formation rules', () => {
    const near = (a: number, b: number, tol: number) => expect(Math.abs(a - b)).toBeLessThanOrEqual(tol)
    for (const n of [0, 1]) {
      const facing = n === 0 ? 1 : -1
      const units = team(n)
      const by = new Map(units.map((u) => [u.gameId, u]))
      const warlords = units.filter((u) => u.kind === KIND.WARLORD)
      warlords.forEach((w, wi) => {
        expect(w.y).toBe(16 * FX + randInt(224, SMALL.seed, 0, teamGameId(n), PURPOSE.SPAWN_Y, wi) * FX)
        near(w.x, (n === 0 ? 8 : 248) * FX, w.speed)
        units.filter((u) => u.leader === w.gameId).forEach((l, j) => {
          expect(l.y).toBe(w.y + (2 * j - 3) * 4 * FX)
          near(l.x, w.x - facing * 4 * FX, w.speed + l.speed)
          units.filter((m) => m.leader === l.gameId).forEach((m, i) => {
            expect(m.y).toBe(l.y + ((i % 3) - 1) * 2 * FX)
            near(m.x, l.x - facing * (1 + Math.trunc(i / 3)) * 2 * FX, l.speed + m.speed)
          })
        })
      })
      expect(by.size).toBe(units.length)
    }
  })

  it('stops a team at targetPop and at maxSquadsPerWave, counting warlords and squads', () => {
    const leaders = (sc: Parameters<typeof scenario>[0]) => run(scenario(sc))[0].units.filter((u) => u.moraleSize0 !== -1)
    expect(leaders({ targetPop: 1000, maxSquadsPerWave: 3 })).toHaveLength(6)
    expect(leaders({ targetPop: 1, maxSquadsPerWave: 5 })).toHaveLength(2)
    const one = run(scenario({ targetPop: 1, maxSquadsPerWave: 5 }))[0]
    expect(one.units.filter((u) => u.kind === KIND.WARLORD)).toHaveLength(2)
  })

  it('spawns a new wave each wavePeriod while a team is below targetPop', () => {
    const h = run(scenario({ targetPop: 1000, maxSquadsPerWave: 1, wavePeriod: 5, ticks: 11 }))
    expect(h.map((x) => x.units.filter((u) => u.moraleSize0 !== -1).length)).toEqual([2, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6])
  })

  it('applies full hp and base stats at spawn', () => {
    for (const u of s.units) {
      expect(u.hp).toBe(UNIT_STATS[u.kind].maxHp)
      expect(u.cooldown).toBe(0)
      expect(u.attack).toBe(UNIT_STATS[u.kind].attack + sum(u.items.map((it) => ITEMS[it.kind].attack * it.quality)) + setBonus(u, 'attack'))
    }
  })
})

/** SPEC 6.13 from the snapshot: the root of the MemberOf and ChildOf chain is a warlord and the unit is not the root. */
const bannerOf = (byId: Map<number, PUnit>, u: PUnit): boolean => {
  let root = u
  for (let p = byId.get(root.leader !== -1 ? root.leader : root.parent); p; p = byId.get(root.leader !== -1 ? root.leader : root.parent)) root = p
  return root !== u && root.kind === KIND.WARLORD
}

describe('stats recompute', () => {
  const base = (u: PUnit, f: 'attack' | 'armor' | 'speed') => UNIT_STATS[u.kind][f] + sum(u.items.map((it) => ITEMS[it.kind][f] * it.quality)) + setBonus(u, f)

  it('derives attack, armor and speed from base, items, Veteran and Haste on every tick', () => {
    let hasted = 0, veterans = 0
    for (const { c, cm } of steps()) for (const u of c.units) {
      const haste = u.buffs.some((b) => b.kind === BUFF.HASTE)
      const vet = (u.flags & VETERAN) ? 2 * Math.min(3, Math.trunc(u.killCount / kernel.VETERAN_KILLS)) : 0
      expect(u.attack).toBe(base(u, 'attack') + vet)
      expect(u.armor).toBe(base(u, 'armor') + (bannerOf(cm, u) ? kernel.BANNER_ARMOR : 0))
      expect(u.speed).toBe(haste ? Math.trunc((base(u, 'speed') * 3) / 2) : base(u, 'speed'))
      if (haste) hasted++
      if (u.flags & VETERAN) veterans++
    }
    expect(hasted).toBeGreaterThan(0)
    expect(veterans).toBeGreaterThan(0)
  })

  it('shows a pickup in the stats of the same tick', () => {
    let pickups = 0
    for (const { p, c, cm } of steps()) {
      const ground = new Set(p.ground.map((g) => g.gameId))
      for (const u of c.units) for (const it of u.items) if (ground.has(it.gameId)) {
        pickups++
        expect(u.armor).toBe(base(u, 'armor') + (bannerOf(cm, u) ? kernel.BANNER_ARMOR : 0))
      }
    }
    expect(pickups).toBeGreaterThan(0)
  })
})

describe('movement', () => {
  const FAR = (team: number) => (team === 0 ? kernel.MAX_COORD : 0)

  it('moves every unit by SPEC §6.3, parents before children down all 4 levels', () => {
    const slots = slotOffsets()
    const depths = new Set<number>()
    let slotFollowers = 0
    for (const s of steps()) {
      if (spawned(s)) continue
      const ai = aiOf(s)
      const depthOf = (u: PUnit) => { let d = 0; for (let x: PUnit | undefined = u; x && (x.leader !== -1 || x.parent !== -1); d++) x = s.pm.get(x.leader !== -1 ? x.leader : x.parent); return d }
      for (const u of s.p.units) {
        const now = s.cm.get(u.gameId)
        if (!now) continue
        const targetId = stunned(u) ? u.target : ai.get(u.gameId)!.id
        const t = targetId === -1 ? undefined : s.pm.get(targetId)
        let goal: [number, number] | null
        if (stunned(u)) goal = null
        else if (fleeing(u)) goal = [homeX(u.team), u.y]
        else if (t && inRange(u, t, UNIT_STATS[u.kind].range)) goal = null
        else if (u.leader !== -1) {
          const slot = slots.get(`${s.seed}:${u.gameId}`)
          const parent = s.cm.get(u.leader)
          if (!slot || slot.parent !== u.leader || !parent) continue
          goal = [parent.x + slot.offX, parent.y + slot.offY]
          slotFollowers++
        } else if (t) goal = [t.x, t.y]
        else if (u.kind === KIND.MINION) { const summoner = s.cm.get(u.parent); if (!summoner) continue; goal = [summoner.x, summoner.y] }
        else goal = [FAR(u.team), u.y]
        const want = goal ? stepToward(u.x, u.y, goal[0], goal[1], u.speed) : [u.x, u.y]
        if (now.x !== want[0] || now.y !== want[1]) throw new Error(JSON.stringify({ t: s.t, u, now: [now.x, now.y], want, goal, targetId, stun: stunned(u), flee: fleeing(u) }))
        if (goal) depths.add(depthOf(u))
      }
    }
    expect([...depths].sort()).toEqual([0, 1, 2, 3])
    expect(slotFollowers).toBeGreaterThan(0)
  })

  it('gives a summoner member a minion at depth 3: minion, summoner member, squad leader, warlord', () => {
    let chains = 0
    for (const { c, cm } of steps()) for (const m of c.units) {
      if (m.kind !== KIND.MINION) continue
      const summoner = cm.get(m.parent)!
      const leader = summoner.leader === -1 ? undefined : cm.get(summoner.leader)
      const warlord = leader && leader.leader !== -1 ? cm.get(leader.leader) : undefined
      if (warlord?.kind === KIND.WARLORD && leader!.moraleSize0 !== -1) chains++
    }
    expect(chains).toBeGreaterThan(0)
  })
})

describe('targeting', () => {
  const targetStats = memo(() => {
    const rules = new Map<Rule, number>()
    let ties = 0, retaliationChanges = 0
    for (const s of steps()) {
      if (spawned(s)) continue
      for (const [id, e] of aiOf(s)) {
        const u = s.pm.get(id)!, now = s.cm.get(id)
        rules.set(e.rule, (rules.get(e.rule) ?? 0) + 1)
        ties += e.ties > 0 ? 1 : 0
        if (e.rule === 'retaliation' && e.id !== u.target) retaliationChanges++
        if (!now || (fleeing(now) && !fleeing(u))) continue
        if (e.id !== -1 && !s.cm.has(e.id)) continue
        expect(now.target).toBe(e.id)
      }
      for (const u of s.p.units) if (stunned(u)) {
        const now = s.cm.get(u.gameId)
        if (now && !fleeing(now) && s.cm.has(u.target)) expect(now.target).toBe(u.target)
      }
    }
    return { rules, ties, retaliationChanges }
  })

  it('picks the nearest valid enemy on a think tick, keeps a valid target, and idles between think ticks (every unit, every tick)', () => {
    const { rules } = targetStats()
    for (const r of ['think', 'keep', 'idle'] as const) expect(rules.get(r)).toBeGreaterThan(0)
  })

  it('has a healer keep a hurt ally in range, and otherwise choose the lowest hp / maxHp on a think tick, ties to the lowest gameId', () => {
    const { rules, ties } = targetStats()
    for (const r of ['heal-keep', 'heal-think', 'heal-idle'] as const) expect(rules.get(r)).toBeGreaterThan(0)
    expect(ties).toBeGreaterThan(0)
  })

  it('has a unit retaliate against its worst attacker of Threat 20 or more, over its current target', () => {
    const { rules, retaliationChanges } = targetStats()
    expect(rules.get('retaliation')).toBeGreaterThan(0)
    expect(retaliationChanges).toBeGreaterThan(0)
  })

  it('gives a fleeing unit and a summoner no target', () => {
    let seen = 0
    for (const { c } of steps()) for (const u of c.units) if (fleeing(u) || u.kind === KIND.SUMMONER) { expect(u.target).toBe(-1); seen++ }
    expect(seen).toBeGreaterThan(0)
  })

  it('never lets a unit that is not stunned keep an enemy target that was already fleeing at the start of the tick', () => {
    for (const s of steps()) for (const u of s.p.units) {
      const now = s.cm.get(u.gameId)
      const t = now ? s.cm.get(now.target) : undefined
      if (now && t && t.team !== u.team && !stunned(u)) expect(fleeing(s.pm.get(t.gameId) ?? t)).toBe(false)
    }
  })
})

describe('projectiles', () => {
  const fireTick = (s: Step, pr: PProjectile) => s.t - 1 - pr.age

  it('starts each new projectile at its owner position with age 0, aimed at the owner target, after the owner fires', () => {
    let fresh = 0
    for (const s of steps()) for (const pr of s.c.projectiles) {
      if (pr.age !== 0) continue
      const o = s.cm.get(pr.owner), was = s.pm.get(pr.owner)
      if (!o || !was) continue
      fresh++
      expect([pr.x, pr.y]).toEqual([o.x, o.y])
      if (!fleeing(o)) expect(pr.target).toBe(o.target)
      expect(attacked(was, o)).toBe(true)
      expect(o.kind === KIND.ARCHER || o.kind === KIND.MAGE).toBe(true)
    }
    expect(fresh).toBeGreaterThan(0)
  })

  it('fires an archer volley of 3 at speeds 2048, 1792 and 1536, and a mage shot of 1 at 2048', () => {
    let volleys = 0, mageShots = 0
    for (const s of steps()) {
      const fresh = s.c.projectiles.filter((pr) => pr.age === 0)
      const byOwner = new Map<number, PProjectile[]>()
      for (const pr of fresh) byOwner.set(pr.owner, [...(byOwner.get(pr.owner) ?? []), pr])
      for (const [id, prs] of byOwner) {
        const kind = (s.cm.get(id) ?? s.pm.get(id))?.kind
        if (kind === undefined) continue
        if (kind === KIND.ARCHER) {
          volleys++
          expect(prs.map((x) => x.speed)).toEqual([2048, 1792, 1536])
          expect(prs.map((x) => x.volley)).toEqual([1, 1, 1])
          expect(prs[1].gameId).toBe(prs[0].gameId + 1)
          expect(prs[2].gameId).toBe(prs[0].gameId + 2)
          expect(new Set(prs.map((x) => x.target)).size).toBe(1)
        } else {
          mageShots++
          expect(prs).toHaveLength(1)
          expect(prs[0]).toMatchObject({ speed: 2048, volley: 0 })
        }
      }
      for (let i = 1; i < fresh.length; i++) expect(fresh[i].gameId).toBeGreaterThan(fresh[i - 1].gameId)
    }
    expect(volleys).toBeGreaterThan(0)
    expect(mageShots).toBeGreaterThan(0)
  })

  it('moves a projectile toward its target at its own speed, and removes it in the tick it reaches the target', () => {
    let flying = 0, hits = 0
    for (const s of steps()) for (const pr of s.p.projectiles) {
      const t = s.cm.get(pr.target)
      if (!t) continue
      const at = stepToward(pr.x, pr.y, t.x, t.y, pr.speed)
      const now = s.c.projectiles.find((x) => x.gameId === pr.gameId)
      if (at[0] === t.x && at[1] === t.y) { expect(now).toBeUndefined(); hits++ }
      else if (pr.age + 1 < kernel.PROJECTILE_LIFETIME) { expect(now).toMatchObject({ x: at[0], y: at[1], age: pr.age + 1 }); flying++ }
    }
    expect(flying).toBeGreaterThan(0)
    expect(hits).toBeGreaterThan(0)
  })

  // A projectile that spawns on top of its target is rare, so more seeds run until one shows it.
  it('keeps a projectile that is created on its target position until the next tick', () => {
    let onTarget = 0
    const check = (list: Step[]) => {
      for (const s of list) for (const pr of s.c.projectiles) {
        if (pr.age !== 0) continue
        const t = s.cm.get(pr.target)
        if (t && t.x === pr.x && t.y === pr.y) onTarget++
        expect(s.c.projectiles.filter((x) => x.gameId === pr.gameId)).toHaveLength(1)
      }
    }
    check([...steps(), ...veteranFight()])
    for (let seed = 8; onTarget === 0 && seed < 60; seed++) check(stepsOf(seed, run({ ...SMALL, garrisonCap: 0, ordersPerTeam: 0, seed })))
    expect(onTarget).toBeGreaterThan(0)
  })

  // Every hit is predicted from the start-of-tick snapshot: stored attack and crit of the owner at fire time,
  // armor of the target at hit time. The sum must equal the world damage counter, so splash, volley half damage and melee are all exact.
  it('deals exact damage: mage splash to every enemy within 2 tiles, volley half, melee full, and the world counter matches', () => {
    let splash = 0, volley = 0, melee = 0, ticks = 0
    for (const s of steps()) {
      if (spawned(s) || vanished(s).length > 0 || s.c.units.some((u) => fleeing(u) && !fleeing(s.pm.get(u.gameId) ?? u))) continue
      const expected = [0, 0]
      let unknownOwner = false
      const scaled = (victim: PUnit, v: number) => (overwhelmedAt(s, victim) ? kernel.overwhelmDamage(v) : v)
      for (const pr of s.p.projectiles) {
        const t = s.cm.get(pr.target)!
        const at = stepToward(pr.x, pr.y, t.x, t.y, pr.speed)
        if (at[0] !== t.x || at[1] !== t.y) continue
        const fired = fireTick(s, pr)
        // An owner that spawned in the firing tick has no start-of-tick record, and its end-of-tick attack can differ (a pickup).
        const o = s.h[fired - 1].units.find((u) => u.gameId === pr.owner)
        if (!o) { unknownOwner = true; break }
        const crit = isCrit(s.seed, fired, pr.owner)
        if (o.kind === KIND.MAGE) {
          for (const v of s.c.units) if (v.team !== o.team && inRange(v, t, 2 * FX)) { expected[o.team] += scaled(v, kernel.damage(o.attack, s.pm.get(v.gameId)?.armor ?? v.armor, crit)); splash++ }
        } else { expected[o.team] += scaled(t, kernel.volleyDamage(o.attack, s.pm.get(t.gameId)!.armor, crit)); volley++ }
      }
      if (unknownOwner) continue
      for (const u of s.p.units) {
        const now = s.cm.get(u.gameId)!
        if (!MELEE.has(u.kind) || !attacked(u, now)) continue
        expected[u.team] += scaled(s.cm.get(now.target)!, kernel.damage(u.attack, s.pm.get(now.target)!.armor, isCrit(s.seed, s.t, u.gameId)))
        melee++
      }
      expect([s.c.damage[0] - s.p.damage[0], s.c.damage[1] - s.p.damage[1]]).toEqual(expected)
      ticks++
    }
    expect(ticks).toBeGreaterThan(100)
    expect(splash).toBeGreaterThan(0)
    expect(volley).toBeGreaterThan(0)
    expect(melee).toBeGreaterThan(0)
  })
})

describe('Banner', () => {
  // A banner falls only when a warlord dies or a leader flees from its warlord, which is rare, so more seeds run until one shows it.
  it('flags a unit exactly while the root of its chain is a warlord and it is not the root, every tick', () => {
    let on = 0, lost = 0
    const check = (list: Step[]) => {
      for (const s of list) for (const u of s.c.units) {
        const banner = bannerOf(s.cm, u)
        expect(!!(u.flags & BANNERED)).toBe(banner)
        if (banner) on++
        const was = s.pm.get(u.gameId)
        if (was && !banner && (was.flags & BANNERED)) lost++
      }
    }
    check([...steps(), ...veteranFight()])
    for (let seed = 8; lost === 0 && seed < 60; seed++) check(stepsOf(seed, run({ ...SMALL, garrisonCap: 0, ordersPerTeam: 0, seed })))
    expect(on).toBeGreaterThan(0)
    expect(lost).toBeGreaterThan(0)
  })
})

describe('Overwhelmed', () => {
  it('tags a unit exactly while 6 or more enemy units target it, and removes the tag when the count drops', () => {
    let tagged = 0, untaggedTargeted = 0, cleared = 0
    for (const s of [...steps(), ...veteranFight()]) {
      if (vanished(s).length > 0 || s.c.units.some((u) => fleeing(u) && !fleeing(s.pm.get(u.gameId) ?? u))) continue
      for (const v of s.c.units) {
        const on = !!(v.flags & OVERWHELMED)
        expect(on).toBe(overwhelmedAt(s, v))
        if (on) tagged++
        else if (s.c.units.some((a) => a.target === v.gameId && a.team !== v.team)) untaggedTargeted++
        if (!on && (s.pm.get(v.gameId)?.flags ?? 0) & OVERWHELMED) cleared++
      }
    }
    expect(tagged).toBeGreaterThan(0)
    expect(untaggedTargeted).toBeGreaterThan(0)
    expect(cleared).toBeGreaterThan(0)
  })
})

describe('crit stun', () => {
  const crits = memo(() => steps().flatMap((s) => s.p.units.flatMap((u) => {
    const now = s.cm.get(u.gameId)
    if (!now || !STUNNERS.has(u.kind) || !attacked(u, now) || !isCrit(s.seed, s.t, u.gameId)) return []
    return [{ s, attacker: now }]
  })))

  it('stuns the target of a warrior or warlord crit for 20 ticks', () => {
    let stuns = 0
    for (const { s, attacker } of crits()) {
      const t = s.cm.get(attacker.target)
      if (!t) continue
      expect(t.buffs.find((b) => b.kind === BUFF.STUN)?.ticksLeft).toBe(19)
      stuns++
    }
    expect(stuns).toBeGreaterThan(0)
  })

  it('stuns only through such a crit', () => {
    const sources = new Set(crits().map(({ s, attacker }) => `${s.seed}:${s.t}:${attacker.target}`))
    for (const s of steps()) for (const u of spawned(s) || vanished(s).length > 0 ? [] : s.c.units) {
      if (u.buffs.some((b) => b.kind === BUFF.STUN && b.ticksLeft === 19)) expect(sources.has(`${s.seed}:${s.t}:${u.gameId}`)).toBe(true)
    }
  })

  it('keeps a stunned unit still, without a cooldown reset, a shot or a damage hit', () => {
    let held = 0
    for (const s of steps()) for (const u of s.p.units) {
      const now = s.cm.get(u.gameId)
      if (!now || !stunned(u)) continue
      held++
      expect([now.x, now.y]).toEqual([u.x, u.y])
      expect(now.cooldown).toBe(Math.max(0, u.cooldown - 1))
      expect(s.c.projectiles.some((pr) => pr.owner === u.gameId && pr.age === 0)).toBe(false)
    }
    expect(held).toBeGreaterThan(0)
  })
})

describe('healer', () => {
  it('heals its target by its attack value without armor, and hastes it', () => {
    let heals = 0
    for (const s of steps()) {
      const quiet = s.c.damage[0] === s.p.damage[0] && s.c.damage[1] === s.p.damage[1]
      const healed = new Map<number, number>()
      for (const u of s.p.units) {
        const now = s.cm.get(u.gameId)
        if (u.kind !== KIND.HEALER || !now || !attacked(u, now) || !s.cm.has(now.target)) continue
        const t = s.cm.get(now.target)!
        expect(t.buffs.find((b) => b.kind === BUFF.HASTE)?.ticksLeft).toBe(39)
        healed.set(t.gameId, (healed.get(t.gameId) ?? 0) + u.attack)
        heals++
      }
      if (!quiet) continue
      for (const [id, amount] of healed) {
        const old = s.pm.get(id)!, now = s.cm.get(id)!
        if (old.buffs.some((b) => b.kind === BUFF.BURN) || !s.pm.has(id)) continue
        expect(now.hp).toBe(Math.min(now.maxHp, old.hp + amount))
      }
    }
    expect(heals).toBeGreaterThan(0)
  })
})

describe('death cascade', () => {
  const deaths = () => steps().filter((s) => !ambiguous(s)).flatMap((s) => vanished(s).filter((d) => d.kind !== KIND.MINION && !leaves(d)).map((d) => ({ ...s, d })))

  it('clears Targets to a dead unit and removes projectiles aimed at it', () => {
    let aimedAt = 0
    for (const { p, c, d } of deaths()) {
      for (const u of c.units) expect(u.target).not.toBe(d.gameId)
      expect(c.projectiles.filter((x) => x.target === d.gameId)).toEqual([])
      if (p.projectiles.some((x) => x.target === d.gameId)) aimedAt++
    }
    expect(aimedAt).toBeGreaterThan(0)
  })

  it('destroys the minions of a dead summoner in the same tick', () => {
    let cascades = 0
    for (const { p, c, d } of deaths()) {
      expect(c.units.filter((u) => u.parent === d.gameId)).toEqual([])
      if (d.kind === KIND.SUMMONER && p.units.some((u) => u.parent === d.gameId)) cascades++
    }
    expect(cascades).toBeGreaterThan(0)
  })

  it('drops the lowest-gameId item at the death position and destroys the others', () => {
    let drops = 0
    for (const { c, d } of deaths()) {
      if (d.items.length === 0) continue
      const [first, ...rest] = d.items
      const held = new Set(c.units.flatMap((u) => u.items.map((i) => i.gameId)))
      const ground = c.ground.find((g) => g.gameId === first.gameId)
      if (ground) {
        expect(ground).toMatchObject({ kind: first.kind, quality: first.quality })
        expect(held.has(first.gameId)).toBe(false)
      } else expect(held.has(first.gameId)).toBe(true)
      for (const it of rest) {
        expect(held.has(it.gameId)).toBe(false)
        expect(c.ground.some((g) => g.gameId === it.gameId)).toBe(false)
      }
      drops++
    }
    expect(drops).toBeGreaterThan(0)
  })

  it('credits a kill to the enemy team for each dead non-minion, and for nothing else that is destroyed', () => {
    for (const s of steps()) {
      if (ambiguous(s)) continue
      const dead = vanished(s).filter((d) => d.kind !== KIND.MINION && !leaves(d))
      expect(s.c.kills[0] - s.p.kills[0]).toBe(dead.filter((d) => d.team === 1).length)
      expect(s.c.kills[1] - s.p.kills[1]).toBe(dead.filter((d) => d.team === 0).length)
    }
  })

  it('keeps ground items where they are until picked up', () => {
    for (const { p, c } of steps()) for (const g of p.ground) {
      const now = c.ground.find((x) => x.gameId === g.gameId)
      if (now) expect([now.x, now.y, now.age]).toEqual([g.x, g.y, g.age + 1])
    }
  })
})

describe('morale, rout and fleeing', () => {
  it('counts a loss for each member that dies, 2 for each dead parent of a leader, and routs a squad at lost * 3 >= size0 * 2', () => {
    let losses = 0, warlordLosses = 0
    for (const s of steps()) {
      if (ambiguous(s)) continue
      const dead = vanished(s).filter((u) => !leaves(u) && u.kind !== KIND.MINION)
      for (const u of s.p.units) {
        const now = s.cm.get(u.gameId)
        if (!now || u.moraleSize0 === -1) continue
        const members = dead.filter((d) => d.leader === u.gameId && d.moraleSize0 === -1)
        const parentDead = dead.some((d) => d.gameId === u.leader)
        expect(now.moraleLost - u.moraleLost).toBe(members.length + (parentDead ? 2 : 0))
        losses += members.length
        warlordLosses += parentDead ? 1 : 0
      }
      for (const u of s.c.units) if (u.moraleSize0 !== -1) expect((u.flags & ROUTED) !== 0).toBe(u.moraleLost * 3 >= u.moraleSize0 * 2)
    }
    expect(losses).toBeGreaterThan(0)
    expect(warlordLosses).toBeGreaterThan(0)
  })

  it('makes the whole squad Fleeing in the tick its leader is Routed, and nothing else', () => {
    let routs = 0, squadSizes = 0
    for (const s of steps()) {
      for (const u of s.p.units) {
        const now = s.cm.get(u.gameId)
        if (!now || (u.flags & ROUTED) || !(now.flags & ROUTED)) continue
        routs++
        expect(fleeing(now)).toBe(true)
        const members = s.p.units.filter((m) => m.leader === u.gameId && m.moraleSize0 === -1)
        for (const m of members) { const mc = s.cm.get(m.gameId); if (mc) { expect(fleeing(mc)).toBe(true); squadSizes++ } }
      }
      for (const u of s.c.units) {
        if (u.kind === KIND.MINION || u.kind === KIND.WARLORD) expect(fleeing(u)).toBe(false)
        if (fleeing(u) && u.moraleSize0 === -1) expect(s.cm.get(u.leader)!.flags & ROUTED).toBeTruthy()
        if (u.flags & ROUTED) expect(fleeing(u)).toBe(true)
      }
    }
    expect(routs).toBeGreaterThan(0)
    expect(squadSizes).toBeGreaterThan(routs)
  })

  it('never recovers: Fleeing, Routed and Veteran stay on a surviving unit', () => {
    for (const s of steps()) for (const u of s.p.units) {
      const now = s.cm.get(u.gameId)
      if (now) expect(now.flags & u.flags & (FLEEING | VETERAN | ROUTED)).toBe(u.flags & (FLEEING | VETERAN | ROUTED))
    }
  })

  it('clears Targets and Threat of a unit that starts fleeing, and a leader leaves its warlord', () => {
    let fled = 0, hadThreat = 0, hadParent = 0
    for (const s of steps()) for (const u of s.p.units) {
      const now = s.cm.get(u.gameId)
      if (!now || fleeing(u) || !fleeing(now)) continue
      fled++
      expect(now.target).toBe(-1)
      expect(now.threat).toEqual([])
      if (u.threat.length > 0) hadThreat++
      if (now.moraleSize0 !== -1) { expect(now.leader).toBe(-1); if (u.leader !== -1) hadParent++ }
    }
    expect(fled).toBeGreaterThan(0)
    expect(hadThreat).toBeGreaterThan(0)
    expect(hadParent).toBeGreaterThan(0)
  })

  it('keeps no Threat edge and no parent on a fleeing unit that leads a squad', () => {
    for (const { c } of steps()) for (const u of c.units) if (fleeing(u)) { expect(u.threat).toEqual([]); if (u.moraleSize0 !== -1) expect(u.leader).toBe(-1) }
  })
})

describe('leaving', () => {
  it('removes a fleeing unit that reaches its home edge, with its minions and items, and no kill or drop', () => {
    let left = 0
    for (const s of steps()) {
      const leavers = vanished(s).filter(leaves)
      for (const u of leavers) {
        left++
        for (const it of u.items) {
          expect(s.c.ground.some((g) => g.gameId === it.gameId)).toBe(false)
          expect(s.c.units.some((x) => x.items.some((i) => i.gameId === it.gameId))).toBe(false)
        }
        expect(s.c.units.filter((x) => x.parent === u.gameId)).toEqual([])
      }
      for (const u of s.c.units) if (fleeing(u)) expect(u.x).not.toBe(homeX(u.team))
    }
    expect(left).toBeGreaterThan(0)
  })

  it('moves a fleeing unit toward its home edge at its own y', () => {
    let moved = 0
    for (const s of steps()) for (const u of s.p.units) {
      const now = s.cm.get(u.gameId)
      if (!now || !fleeing(u) || stunned(u)) continue
      expect([now.x, now.y]).toEqual(stepToward(u.x, u.y, homeX(u.team), u.y, u.speed))
      moved++
    }
    expect(moved).toBeGreaterThan(0)
  })
})

/** Members that stay under `d` when it goes: a squad leader that flees in the same tick has already left its warlord. */
const survivingMembers = (s: Step, d: PUnit) =>
  s.p.units.filter((m) => m.leader === d.gameId && s.cm.has(m.gameId) && !(m.moraleSize0 !== -1 && fleeing(s.cm.get(m.gameId)!)))

describe('promotion', () => {
  it('promotes the lowest-gameId surviving member, who takes the parent, the morale and the others', () => {
    let squadHeads = 0, warbandHeads = 0
    for (const s of steps()) for (const d of vanished(s)) {
      const alive = survivingMembers(s, d)
      if (alive.length === 0) continue
      if (d.leader !== -1 && !s.cm.has(d.leader)) continue
      const head = s.cm.get(alive[0].gameId)!
      expect(head.leader).toBe(fleeing(head) ? -1 : d.leader)
      for (const m of alive.slice(1)) expect(s.cm.get(m.gameId)!.leader).toBe(head.gameId)
      if (d.moraleSize0 !== -1 && alive[0].moraleSize0 === -1) {
        expect(head.moraleSize0).toBe(d.moraleSize0)
        if (d.flags & ROUTED) expect(head.flags & ROUTED).toBeTruthy()
      }
      if (d.kind === KIND.WARLORD) expect(head.moraleSize0).not.toBe(-1)
      if (d.leader !== -1 && d.moraleSize0 !== -1) warbandHeads++
      else squadHeads++
    }
    expect(squadHeads).toBeGreaterThan(0)
    expect(warbandHeads).toBeGreaterThan(0)
  })

  it('keeps the dead leader slot: the promoted head walks to the old offset from the warlord next tick', () => {
    const slots = slotOffsets()
    let checked = 0
    const all = steps()
    for (const s of all) for (const d of vanished(s)) {
      const slot = slots.get(`${s.seed}:${d.gameId}`)
      if (!slot || slot.parent !== d.leader || d.moraleSize0 === -1 || d.leader === -1 || leaves(d)) continue
      const alive = survivingMembers(s, d)
      const next = all.find((x) => x.seed === s.seed && x.t === s.t + 1)
      if (alive.length === 0 || !next) continue
      const head = s.cm.get(alive[0].gameId)!
      const after = next.cm.get(head.gameId), warlord = next.cm.get(d.leader)
      if (!after || !warlord || head.leader !== d.leader || stunned(head) || fleeing(head) || after.leader !== head.leader) continue
      if (aiOf(next).get(head.gameId)?.id !== -1 || head.speed !== after.speed) continue
      expect([after.x, after.y]).toEqual(stepToward(head.x, head.y, warlord.x + slot.offX, warlord.y + slot.offY, head.speed))
      checked++
    }
    expect(checked).toBeGreaterThan(0)
  })
})

describe('Threat', () => {
  it('holds at most 4 edges, in attacker order, each to an enemy that exists, between 1 and 1,000,000', () => {
    let full = 0
    for (const { c, cm } of steps()) for (const u of c.units) {
      expect(u.threat.length).toBeLessThanOrEqual(4)
      if (u.threat.length === 4) full++
      u.threat.forEach((e, i) => {
        if (i > 0) expect(e.attacker).toBeGreaterThan(u.threat[i - 1].attacker)
        expect(cm.get(e.attacker)!.team).toBe(1 - u.team)
        expect(e.amount).toBeGreaterThanOrEqual(1)
        expect(e.amount).toBeLessThanOrEqual(1_000_000)
      })
    }
    expect(full).toBeGreaterThan(0)
  })

  it('adds the damage of the first hits as Threat, one edge for each attacker', () => {
    for (const seed of SEEDS) {
      const h = fights().find((f) => f.sc.seed === seed)!.h
      const first = h.findIndex((s) => s.damage[0] + s.damage[1] > 0)
      const c = h[first], p = h[first - 1]
      expect(first % 20).not.toBe(0)
      expect(p.units.every((u) => u.threat.length === 0)).toBe(true)
      const total = sum(c.units.flatMap((u) => u.threat.map((e) => e.amount)))
      expect(total).toBe(c.damage[0] + c.damage[1] - p.damage[0] - p.damage[1])
      expect(total).toBeGreaterThan(0)
    }
  })

  it('only grows between decay ticks, and shrinks by max(1, amount / 4) at a decay tick that brings no damage', () => {
    let grown = 0, decayed = 0, removed = 0
    const left = (a: number) => a - Math.max(1, Math.trunc(a / 4))
    for (const s of steps()) for (const u of s.p.units) {
      const now = s.cm.get(u.gameId)
      if (!now) continue
      for (const e of u.threat) {
        if (!s.cm.has(e.attacker)) continue
        const after = now.threat.find((x) => x.attacker === e.attacker)
        const hurt = s.c.damage[1 - u.team] !== s.p.damage[1 - u.team]
        if (s.t % 20 !== 0) {
          if (after) { expect(after.amount).toBeGreaterThanOrEqual(e.amount); grown++ }
        } else if (!hurt && !fleeing(now)) {
          if (after) { expect(after.amount).toBe(left(e.amount)); decayed++ }
          else { expect(left(e.amount)).toBeLessThanOrEqual(0); removed++ }
        }
      }
    }
    expect(grown).toBeGreaterThan(0)
    expect(decayed).toBeGreaterThan(0)
    expect(removed).toBeGreaterThan(0)
  })

  it('evicts the lowest-amount edge when a victim has more than 4, so a kept edge is never below an evicted one', () => {
    let evictions = 0
    for (const s of steps()) {
      if (s.t % 20 === 0) continue
      for (const u of s.p.units) {
        const now = s.cm.get(u.gameId)
        if (!now || u.threat.length < 4) continue
        const gone = u.threat.filter((e) => s.cm.has(e.attacker) && !now.threat.some((x) => x.attacker === e.attacker))
        if (gone.length === 0 || fleeing(now)) continue
        evictions++
        for (const kept of now.threat) for (const g of gone) expect(kept.amount).toBeGreaterThanOrEqual(g.amount)
      }
    }
    expect(evictions).toBeGreaterThan(0)
  })
})

describe('Trail', () => {
  it('appends the new position of each unit that moved, drops the oldest point at TRAIL_POINTS, and leaves a unit that stayed alone', () => {
    let grew = 0, capped = 0, stayed = 0
    for (const s of steps()) for (const u of s.c.units) {
      const old = s.pm.get(u.gameId)
      if (!old) { expect(u.trailCount).toBeLessThanOrEqual(1); continue }
      if (u.x === old.x && u.y === old.y) {
        expect(u.trailCount).toBe(old.trailCount); expect([u.trailNewestX, u.trailNewestY]).toEqual([old.trailNewestX, old.trailNewestY]); stayed++
      } else {
        expect(u.trailCount).toBe(Math.min(kernel.TRAIL_POINTS, old.trailCount + 1))
        expect([u.trailNewestX, u.trailNewestY]).toEqual([u.x, u.y])
        grew++
        if (old.trailCount === kernel.TRAIL_POINTS) capped++
      }
    }
    expect(grew).toBeGreaterThan(0)
    expect(capped).toBeGreaterThan(0)
    expect(stayed).toBeGreaterThan(0)
  })
})

describe('Veteran and chronicle', () => {
  it('makes a unit a Veteran at VETERAN_KILLS kills and gives it a chronicle with the promotion mark', () => {
    let promoted = 0
    for (const s of steps()) for (const u of s.c.units) {
      expect((u.flags & VETERAN) !== 0).toBe(u.killCount >= kernel.VETERAN_KILLS)
      if (!(u.flags & VETERAN)) expect(u.chronicleCount).toBe(0)
      else expect(u.chronicleCount).toBeGreaterThanOrEqual(1)
      const old = s.pm.get(u.gameId)
      if (old && !(old.flags & VETERAN) && (u.flags & VETERAN)) { expect(u.chronicle).toEqual([-1]); promoted++ }
    }
    expect(promoted).toBeGreaterThan(0)
  })

  it('appends one victim kind for each kill, oldest first, and keeps the last CHRONICLE_MAX entries', () => {
    let appended = 0, capped = 0
    for (const s of veteranFight()) {
      const kinds = vanished(s).filter((v) => !leaves(v)).map((v) => v.kind)
      for (const u of s.p.units) {
        const now = s.cm.get(u.gameId)
        if (!now || !(u.flags & VETERAN)) continue
        const gained = now.killCount - u.killCount
        expect(gained).toBeGreaterThanOrEqual(0)
        expect(now.chronicleCount).toBe(Math.min(kernel.CHRONICLE_MAX, u.chronicleCount + gained))
        const old = Math.max(0, now.chronicle.length - gained) // the entries of the tick before that are still in the tail
        expect(now.chronicle.slice(0, old)).toEqual(u.chronicle.slice(u.chronicle.length - old))
        for (const k of now.chronicle.slice(old)) expect(kinds).toContain(k)
        appended += gained
        if (u.chronicleCount + gained > kernel.CHRONICLE_MAX) capped++
      }
    }
    expect(appended).toBeGreaterThan(0)
    expect(capped).toBeGreaterThan(0)
  })

  it('credits killCount only for units that were destroyed in that tick', () => {
    for (const s of steps()) {
      if (spawned(s)) continue // a unit that spawns and dies in one tick can give a kill and is in no snapshot
      const gained = sum(s.p.units.flatMap((u) => { const now = s.cm.get(u.gameId); return now ? [now.killCount - u.killCount] : [] }))
      expect(gained).toBeLessThanOrEqual(vanished(s).filter((v) => !leaves(v)).length)
    }
  })
})

describe('shrines and Score', () => {
  it('moves progress by the clamped unit difference within 4 tiles and sets the owner at the limit, every tick', () => {
    const max = kernel.SHRINE_PROGRESS_MAX
    const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))
    const captures = [0, 0]
    for (const { p, c } of steps()) c.shrines.forEach((sh, i) => {
      const near = c.units.filter((u) => !fleeing(u) && inRange(u, { x: 128 * FX, y: (16 + 32 * i) * FX }, 4 * FX))
      const step = clamp(near.filter((u) => u.team === 0).length - near.filter((u) => u.team === 1).length, -5, 5)
      const progress = clamp(p.shrines[i].progress + step, -max, max)
      expect(sh.progress).toBe(progress)
      expect(sh.owner).toBe(progress === max ? 0 : progress === -max ? 1 : p.shrines[i].owner)
      if (sh.owner !== p.shrines[i].owner) captures[sh.owner]++
    })
    expect(captures[0]).toBeGreaterThan(0)
    expect(captures[1]).toBeGreaterThan(0)
  })
})

describe('surge', () => {
  const surgeScenario = scenario({ targetPop: 170, maxSquadsPerWave: 15, wavePeriod: 1_000_000, surgePeriod: 60, surgeBase: 3, surgeCap: 215, ticks: 1000 })
  const h = memo(() => run(surgeScenario))

  it('spawns surgeBase * (shrine lead) squads for the leading team, up to surgeCap, and none on a tie', () => {
    let surged = 0, ties = 0, capped = 0, limited = 0
    const seen = new Set<number>()
    for (const [t, c] of h().entries()) {
      if (t === 0) continue
      const p = h()[t - 1]
      for (const team of [0, 1]) {
        const fresh = c.units.filter((u) => u.team === team && !p.units.some((x) => x.gameId === u.gameId) && u.kind !== KIND.MINION)
        const lead = p.score[team] - p.score[1 - team]
        if (t % 60 !== 0 || lead <= 0) { expect(fresh).toEqual([]); if (t % 60 === 0 && p.score[0] === p.score[1]) ties++; continue }
        const leaders = fresh.filter((u) => u.moraleSize0 !== -1)
        expect(leaders.length).toBeLessThanOrEqual(3 * lead)
        let alive = p.alive[team]
        fresh.forEach((u, i) => {
          const startsSquad = u.kind === KIND.WARLORD || (u.moraleSize0 !== -1 && fresh[i - 1]?.kind !== KIND.WARLORD)
          if (startsSquad) expect(alive).toBeLessThan(215)
          alive++
        })
        leaders.forEach((l, s) => {
          const squad = SQUADS[randInt(4, surgeScenario.seed, t, teamGameId(team), PURPOSE.SURGE_KIND, s)]
          expect(l.kind).toBe(squad.leader)
          expect(c.units.filter((u) => u.leader === l.gameId && u.kind !== KIND.MINION).map((u) => u.kind)).toEqual([...squad.members])
        })
        if (leaders.length === 3 * lead) limited++
        else { expect(alive).toBeGreaterThanOrEqual(215); capped++ }
        seen.add(t)
        surged++
      }
    }
    expect(surged).toBeGreaterThan(0)
    expect(ties).toBeGreaterThan(0)
    expect(limited).toBeGreaterThan(0)
    expect(capped).toBeGreaterThan(0)
  })
})

describe('pickup', () => {
  it('gives each ground item to the nearest unit with room within 1.5 tiles, ties to the lowest gameId, and respects the cap of 3', () => {
    let pickups = 0
    for (const { p, c } of steps()) {
      for (const u of c.units) expect(u.items.length).toBeLessThanOrEqual(3)
      const ground = new Set(p.ground.map((g) => g.gameId))
      const holder = new Map<number, number>()
      for (const u of c.units) for (const it of u.items) if (ground.has(it.gameId)) holder.set(it.gameId, u.gameId)
      const room = new Map(c.units.map((u) => [u.gameId, u.items.length - u.items.filter((i) => ground.has(i.gameId)).length]))
      for (const g of [...p.ground].sort((a, b) => a.gameId - b.gameId)) {
        let best: PUnit | undefined, bestD = 0
        for (const u of c.units) {
          const d = distSq(g.x, g.y, u.x, u.y)
          if (room.get(u.gameId)! >= 3 || d > 1.5 * FX * 1.5 * FX) continue
          if (!best || d < bestD || (d === bestD && u.gameId < best.gameId)) { best = u; bestD = d }
        }
        expect(holder.get(g.gameId)).toBe(best?.gameId)
        if (best) { room.set(best.gameId, room.get(best.gameId)! + 1); pickups++ }
      }
    }
    expect(pickups).toBeGreaterThan(0)
  })

  it('keeps the quality of a picked-up item and despawns ground items at age 300', () => {
    for (const { p, c } of steps()) {
      for (const g of p.ground) {
        const now = c.ground.find((x) => x.gameId === g.gameId)
        const taker = c.units.flatMap((u) => u.items).find((i) => i.gameId === g.gameId)
        if (taker) expect(taker).toMatchObject({ kind: g.kind, quality: g.quality })
        if (!now && !taker) expect(g.age + 1).toBe(300)
      }
      for (const g of c.ground) expect(g.age).toBeLessThan(300)
    }
  })
})

describe('buffs', () => {
  const FULL = [20, 60, 40]
  const buffSteps = () => steps().flatMap((s) => s.c.units.flatMap((u) => u.buffs.map((b) => ({ b, was: s.pm.get(u.gameId)?.buffs.find((x) => x.kind === b.kind) }))))

  it('counts ticksLeft down by one per tick and starts a new buff one tick into its duration', () => {
    for (const { b, was } of buffSteps()) {
      if (was) expect([was.ticksLeft - 1, FULL[b.kind] - 1]).toContain(b.ticksLeft)
      else expect(b.ticksLeft).toBe(FULL[b.kind] - 1)
    }
  })

  it('resets a repeated buff to the full duration', () => {
    const refreshed = buffSteps().filter(({ b, was }) => was && b.ticksLeft > was.ticksLeft)
    expect(refreshed.length).toBeGreaterThan(0)
    for (const { b } of refreshed) expect(b.ticksLeft).toBe(FULL[b.kind] - 1)
  })

  it('removes a buff after its last tick unless a new hit renews it', () => {
    for (const s of steps()) for (const u of s.c.units) {
      for (const ob of s.pm.get(u.gameId)?.buffs ?? []) {
        const now = u.buffs.find((b) => b.kind === ob.kind)
        if (ob.ticksLeft === 1 && now) expect(now.ticksLeft).toBe(FULL[ob.kind] - 1)
      }
    }
  })

  // An undisturbed burn: hp only changes by exactly -2, on the ticks where ticksLeft % 10 == 0,
  // including the tick that removes the buff.
  it('burns 2 damage when ticksLeft % 10 == 0, six times in a full burn', () => {
    let clean = 0
    for (const { h } of fights()) for (let t0 = 1; t0 < h.length - 61; t0++) {
      for (const u0 of h[t0].units) {
        const b0 = u0.buffs.find((b) => b.kind === BUFF.BURN)
        const prev = h[t0 - 1].units.find((u) => u.gameId === u0.gameId)?.buffs.find((b) => b.kind === BUFF.BURN)
        if (!b0 || prev || b0.ticksLeft !== 59) continue
        const hpAt = (k: number) => h[t0 + k].units.find((u) => u.gameId === u0.gameId)?.hp
        let ok = true, burnTicks = 0
        for (let k = 1; k <= 59 && ok; k++) {
          const left = 59 - k
          const dhp = hpAt(k) === undefined || hpAt(k - 1) === undefined ? NaN : hpAt(k)! - hpAt(k - 1)!
          if (left % 10 === 0) { ok = dhp === -2; burnTicks++ } else ok = dhp === 0
        }
        if (ok && burnTicks === 6) clean++
      }
    }
    expect(clean).toBeGreaterThan(0)
  })
})

describe('winner', () => {
  it.each([[112, 0], [140, 1]])('seed %i: stays -1 while both teams have units, is set once to the team that still has units, and never changes', (seed, team) => {
    const h = run(scenario({ seed, ticks: 1600 }))
    const at = h.findIndex((s) => s.winner !== -1)
    expect(at).toBeGreaterThan(0)
    expect(h[at].alive[1 - team]).toBe(0)
    expect(h[at].alive[team]).toBeGreaterThan(0)
    expect(h[at].winner).toBe(team)
    expect(h[at - 1].alive[1 - team]).toBeGreaterThan(0)
    for (const s of h.slice(at)) expect(s.winner).toBe(team)
    for (const s of h.slice(0, at)) expect(s.winner).toBe(-1)
  })

  it('does not name a winner at tick 0', () => {
    expect(run(scenario({ targetPop: 1000, maxSquadsPerWave: 2 }))[0].winner).toBe(-1)
  })
})

describe('Garrison', () => {
  const cap = SMALL.garrisonCap
  const garrisoned = (u: PUnit) => (u.flags & GARRISONED) !== 0
  const shrinePos = (i: number) => ({ x: 128 * FX, y: (16 + 32 * i) * FX })
  const d2 = (u: PUnit, i: number) => distSq(u.x, u.y, shrinePos(i).x, shrinePos(i).y)

  // One streaming pass over many fights with garrisons on. It keeps two snapshots at a time, since the parsed
  // history of four fights does not fit in memory. Each rule collects its violations, and each test reads its own.
  const pass = memo(() => {
    const bad: Record<string, string[]> = {}
    const seen: Record<string, number> = { listed: 0, entered: 0, ownerChanged: 0, held: 0, burned: 0, exitOwner: 0, exitFlee: 0, counted: 0 }
    const rule = (name: string, ok: boolean, info: () => string) => { if (!ok) (bad[name] ??= []).push(info()) }
    for (const seed of [SMALL.seed, 11, 13, 21, 5, 7, 9, 17, 19, 23, 29, 31, 37, 41, 43, 47, 53, 59, 61]) {
      const sc = { ...SMALL, seed }
      const sim = createSim(sc, kernel)
      const tickOf = () => { for (const ph of PHASES) sim.phases[ph](); return parse(sim.snapshot()) }
      let p = tickOf()
      for (let t = 1; t < sc.ticks; t++) {
        const c = tickOf()
        const cm = index(c)
        const at = `seed ${seed} tick ${c.tick}`
        const targeted = new Set([...c.units.map((u) => u.target), ...c.projectiles.map((q) => q.target)])
        const listed = new Set<number>()
        c.shrines.forEach((sh, i) => {
          rule('lists', sh.garrison.every((id, k) => k === 0 || id > sh.garrison[k - 1]) && sh.garrison.length <= cap, () => `${at} shrine ${i}`)
          for (const id of sh.garrison) {
            const u = cm.get(id)
            rule('lists', !!u && garrisoned(u) && u.team === sh.owner && inRange(u, shrinePos(i), 4 * FX) && !fleeing(u), () => `${at} unit ${id}`)
            listed.add(id)
            seen.listed++
          }
          if (sh.owner === -1) { rule('fills', sh.garrison.length === 0, () => `${at} shrine ${i} unowned`); return }
          const eligible = c.units.filter((u) => u.team === sh.owner && !fleeing(u) && inRange(u, shrinePos(i), 4 * FX))
          rule('fills', sh.garrison.length === Math.min(cap, eligible.length), () => `${at} shrine ${i}`)
          const before = new Set(p.shrines[i].owner === sh.owner ? p.shrines[i].garrison : [])
          const fresh = eligible.filter((u) => garrisoned(u) && !before.has(u.gameId))
          const left = eligible.filter((u) => !garrisoned(u))
          for (const a of fresh) for (const b of left) rule('fills', d2(a, i) < d2(b, i) || (d2(a, i) === d2(b, i) && a.gameId < b.gameId), () => `${at} order ${a.gameId} ${b.gameId}`)
          seen.entered += fresh.length
          if (p.shrines[i].owner !== sh.owner) seen.ownerChanged++
        })
        rule('lists', c.units.filter(garrisoned).length === listed.size, () => `${at} flag count`)
        for (const u of c.units) {
          if (fleeing(u)) rule('exits', !garrisoned(u), () => `${at} fleeing unit ${u.gameId} garrisoned`)
          if (garrisoned(u)) rule('still', u.target === -1 && !targeted.has(u.gameId), () => `${at} unit ${u.gameId} targeted`)
        }
        for (const u of p.units) {
          const now = cm.get(u.gameId)
          if (!garrisoned(u) || !now) continue
          rule('still', now.x === u.x && now.y === u.y && now.target === -1, () => `${at} unit ${u.gameId} moved`)
          seen.held++
          const burn = u.buffs.some((b) => b.kind === BUFF.BURN)
          rule('quiet', u.hp - now.hp === 0 || (u.hp - now.hp === kernel.BURN_DAMAGE && burn), () => `${at} unit ${u.gameId} hp ${u.hp} -> ${now.hp}`)
          rule('quiet', now.cooldown <= u.cooldown, () => `${at} unit ${u.gameId} cooldown`)
          if (now.hp < u.hp) seen.burned++
        }
        p.shrines.forEach((sh, i) => {
          const changed = sh.owner !== c.shrines[i].owner
          for (const id of sh.garrison) {
            const now = cm.get(id)
            if (!now) continue
            if (changed) { rule('exits', !garrisoned(now), () => `${at} unit ${id} stays after a capture`); seen.exitOwner++ }
            else if (!garrisoned(now)) { rule('exits', fleeing(now), () => `${at} unit ${id} left for no reason`); seen.exitFlee++ }
          }
        })
        const max = kernel.SHRINE_PROGRESS_MAX
        c.shrines.forEach((sh, i) => {
          const near = c.units.filter((u) => !fleeing(u) && inRange(u, shrinePos(i), 4 * FX))
          const step = Math.max(-5, Math.min(5, near.filter((u) => u.team === 0).length - near.filter((u) => u.team === 1).length))
          rule('capture', sh.progress === Math.max(-max, Math.min(max, p.shrines[i].progress + step)), () => `${at} shrine ${i}`)
          if (p.shrines[i].garrison.length > 0) seen.counted++
        })
        p = c
      }
    }
    return { bad, seen }
  })

  it('lists the garrisoned units under their shrine in gameId order: owner team, within 4 tiles, not fleeing, at most garrisonCap', () => {
    expect(pass().bad.lists ?? []).toEqual([])
    expect(pass().seen.listed).toBeGreaterThan(0)
  })

  it('tops each owned shrine up to garrisonCap from the owner units within 4 tiles, nearest first, ties to the lowest gameId', () => {
    expect(pass().bad.fills ?? []).toEqual([])
    expect(pass().seen.entered).toBeGreaterThan(0)
    expect(pass().seen.ownerChanged).toBeGreaterThan(0)
  })

  it('holds a garrisoned unit still, without a target, and no unit or projectile targets it', () => {
    expect(pass().bad.still ?? []).toEqual([])
    expect(pass().seen.held).toBeGreaterThan(0)
  })

  it('takes no attack, heal or splash: hp falls only by burn and the cooldown never restarts', () => {
    expect(pass().bad.quiet ?? []).toEqual([])
    expect(pass().seen.burned).toBeGreaterThan(0)
  })

  it('leaves the garrison only when its shrine changes owner or the unit flees, and a fleeing unit is never garrisoned', () => {
    expect(pass().bad.exits ?? []).toEqual([])
    expect(pass().seen.exitOwner).toBeGreaterThan(0)
    expect(pass().seen.exitFlee).toBeGreaterThan(0)
  })

  it('counts garrisoned units toward the capture of their shrine, like any unit within 4 tiles', () => {
    expect(pass().bad.capture ?? []).toEqual([])
    expect(pass().seen.counted).toBeGreaterThan(0)
  })
})

describe('Commander orders', () => {
  const dense = { ...SMALL, targetPop: 300, maxSquadsPerWave: 30, garrisonCap: 0, ordersPerTeam: 40, ticks: 700 }
  const idsOf = (s: Parsed) => [...s.shrines.map((x) => x.gameId), ...s.units.flatMap((u) => [u.gameId, ...u.items.map((i) => i.gameId)]), ...s.projectiles.map((q) => q.gameId), ...s.ground.map((g) => g.gameId)]

  // The key range n is the gameId counter at the start of ai/target. A snapshot only shows the ids that exist, so n is
  // searched from the highest existing id upward, and a tick passes when one n explains every target and both counters.
  const pass = memo(() => {
    const bad: string[] = []
    let effective = 0, ticksWithOrders = 0
    const sim = createSim(dense, kernel)
    let before = parse(sim.snapshot())
    for (let t = 0; t < dense.ticks; t++) {
      sim.phases.spawn()
      const s1 = parse(sim.snapshot())
      sim.phases['ai/target']()
      const s2 = parse(sim.snapshot())
      for (const ph of PHASES.slice(2)) sim.phases[ph]()
      if (t % kernel.ORDER_PERIOD === 0 && t > 0) {
        const units = index(s1), after = index(s2)
        const top = Math.max(...idsOf(s1))
        const delta = [s2.orders[0] - s1.orders[0], s2.orders[1] - s1.orders[1]]
        let found = false, hits = 0
        for (let n = top + 1; n <= top + 400 && !found; n++) {
          const targets = new Map<number, number>()
          const count = [0, 0]
          const pick = (team: number, role: number, k: number, own: boolean) => {
            for (let p = 0; p < kernel.ORDER_PROBES; p++) {
              const u = units.get(kernel.orderKey(n, dense.seed, t, team, role, k, p))
              if (u && (u.team === team) === own) return u
            }
          }
          for (const team of [0, 1]) for (let k = 0; k < dense.ordersPerTeam; k++) {
            const subj = pick(team, PURPOSE.ORDER_SUBJECT, k, true), obj = pick(team, PURPOSE.ORDER_OBJECT, k, false)
            if (!subj || !obj || stunned(subj) || fleeing(subj) || subj.kind === KIND.HEALER || subj.kind === KIND.SUMMONER || fleeing(obj)) continue
            targets.set(subj.gameId, obj.gameId)
            count[team]++
          }
          if (count[0] !== delta[0] || count[1] !== delta[1]) continue
          if ([...targets].every(([sk, ok]) => after.get(sk)?.target === ok)) { found = true; hits = count[0] + count[1] }
        }
        if (!found) bad.push(`tick ${t}: no n explains delta ${delta}`)
        effective += hits
        if (hits > 0) ticksWithOrders++
      }
      before = s2
    }
    void before
    return { bad, effective, ticksWithOrders }
  })

  it('gives each team ordersPerTeam draws every 10 ticks: a subject that can act targets its object, and a dead key changes nothing', () => {
    expect(pass().bad).toEqual([])
    expect(pass().ticksWithOrders).toBeGreaterThan(20)
    expect(pass().effective).toBeGreaterThan(60)
  })

  it('changes orders0 and orders1 only on ticks that are a multiple of 10, and never decreases them', () => {
    const h = run(dense)
    let moved = 0
    h.slice(1).forEach((c, i) => {
      const p = h[i]
      for (const team of [0, 1]) {
        expect(c.orders[team]).toBeGreaterThanOrEqual(p.orders[team])
        if (c.tick % kernel.ORDER_PERIOD !== 0) expect(c.orders[team]).toBe(p.orders[team])
        else moved += c.orders[team] - p.orders[team]
      }
    })
    expect(moved).toBeGreaterThan(0)
  })

  it('gives no order when ordersPerTeam is 0', () => {
    expect(run({ ...dense, ordersPerTeam: 0, ticks: 300 }).every((c) => c.orders[0] === 0 && c.orders[1] === 0)).toBe(true)
  })
})

describe('Render extraction', () => {
  /** SPEC §6.15 written out separately from the kernel: FNV-1a over the little-endian bytes of the buffer. */
  const fold = (chain: number, ints: number[]) => {
    const bytes = new DataView(new ArrayBuffer(4 * ints.length))
    ints.forEach((v, i) => bytes.setInt32(4 * i, v, true))
    let h = chain >>> 0
    for (let i = 0; i < 4 * ints.length; i++) h = Math.imul(h ^ bytes.getUint8(i), 0x01000193) >>> 0
    return h | 0
  }
  const bufferOf = (s: Parsed) => [s.units.length, ...s.units.flatMap((u) => [u.gameId, u.kind, u.team, u.x, u.y, Math.trunc((u.hp * 255) / u.maxHp), u.flags, u.trailCount, u.trailOldestX, u.trailOldestY])]

  it('starts renderChain at 0x811c9dc5 and folds the buffer of every tick into it, flags included', () => {
    const sim = createSim(scenario(), kernel)
    expect(parse(sim.snapshot()).renderChain).toBe(0x811c9dc5 | 0)
    let chain = 0x811c9dc5 | 0
    let flagged = 0
    for (const s of fights()[0].h) {
      chain = fold(chain, bufferOf(s))
      expect(s.renderChain).toBe(chain)
      if (s.units.some((u) => u.flags !== 0)) flagged++
    }
    expect(flagged).toBeGreaterThan(0)
  })

  it('folds the garrison fights too: units that hold garrison and order flags are in the buffer', () => {
    const h = run({ ...SMALL, ticks: 600 })
    let chain = 0x811c9dc5 | 0
    for (const s of h) { chain = fold(chain, bufferOf(s)); expect(s.renderChain).toBe(chain) }
    expect(h.some((s) => s.units.some((u) => (u.flags & GARRISONED) !== 0))).toBe(true)
  })

  it('changes renderChain on every tick, so a run that skips one buffer ends with another value', () => {
    const chains = fights()[0].h.map((s) => s.renderChain)
    expect(new Set(chains).size).toBe(chains.length)
  })
})

describe('determinism', () => {
  it('replays the same snapshots for the same scenario', () => {
    const sc = scenario({ targetPop: 30, maxSquadsPerWave: 5, wavePeriod: 50, ticks: 60 })
    const a = createSim(sc, kernel), b = createSim(sc, kernel)
    for (let t = 0; t < 60; t++) {
      for (const ph of PHASES) { a.phases[ph](); b.phases[ph]() }
      expect(a.snapshot()).toEqual(b.snapshot())
    }
    expect(parse(a.snapshot()).units.length).toBeGreaterThan(0)
  })
})
