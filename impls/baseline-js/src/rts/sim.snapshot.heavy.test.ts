// Behaviour tests through the Sim API and the SPEC §8 snapshot only.
// This file: the SPEC §8 snapshot, spawning, stats recompute, render extraction and determinism.
// "p" is the snapshot at the start of a tick, "c" the snapshot at its end. The fights are in sim-fixtures.ts.
import { describe, it } from 'vitest'
import { PHASES, kernel } from '@ecs-arena/spec'
import { expect } from './fast-expect.ts'
import { GARRISONED, type PUnit, type Parsed, SMALL, VETERAN, parse, scenario } from './testkit.ts'
import createSim from './index.ts'
import {
  BUFF, FX, ITEMS, KIND, PURPOSE, SQUADS, UNIT_STATS, bannerOf, fights, randInt, run, setBonus, steps, sum, teamGameId,
} from './sim-fixtures.ts'

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
    const chains = Array.from(fights()[0].h, (s) => s.renderChain)
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
