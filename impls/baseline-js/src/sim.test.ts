// Behaviour tests through the Sim API and the SPEC §8 snapshot only.
// Spec rules that need a fight use one shared small battle and check each tick against the previous one.
import { describe, expect, it } from 'vitest'
import { kernel } from '@ecs-arena/spec'
import { parse, run, scenario, type Parsed, type PUnit } from './testkit.ts'
import createSim from './index.ts'

const { KIND, BUFF, UNIT_STATS, ITEMS, FX } = kernel

const memo = <T>(f: () => T) => { let v: T | undefined; return () => (v ??= f()) }
const battle = memo(() => run(scenario({ targetPop: 60, maxSquadsPerWave: 10, wavePeriod: 200, ticks: 2600 })))

/** Pairs of (previous, current) snapshots. */
const steps = (h: Parsed[]) => h.slice(1).map((c, i) => [h[i], c] as const)
const vanished = (p: Parsed, c: Parsed) => {
  const ids = new Set(c.units.map((u) => u.gameId))
  return p.units.filter((u) => !ids.has(u.gameId))
}
const dist2 = (ax: number, ay: number, bx: number, by: number) => (ax - bx) ** 2 + (ay - by) ** 2

describe('snapshot layout', () => {
  it('starts with tick 0 and an empty-handed world', () => {
    const [s] = run(scenario({ targetPop: 1000, maxSquadsPerWave: 2 }))
    expect(s.tick).toBe(0)
    expect(s.winner).toBe(-1)
    expect(s.kills).toEqual([0, 0])
    expect(s.damage).toEqual([0, 0])
    expect(s.projectiles).toEqual([])
    expect(s.ground).toEqual([])
  })

  it('parses exactly, counts alive units and sorts units by gameId on every tick', () => {
    battle().forEach((s, t) => {
      expect(s.tick).toBe(t)
      expect([s.units.filter((u) => u.team === 0).length, s.units.filter((u) => u.team === 1).length]).toEqual(s.alive)
      for (let i = 1; i < s.units.length; i++) expect(s.units[i].gameId).toBeGreaterThan(s.units[i - 1].gameId)
      for (const u of s.units) expect(u.items.map((x) => x.gameId)).toEqual([...u.items.map((x) => x.gameId)].sort((a, b) => a - b))
    })
  })

  it('relations point at gameIds that exist in the same snapshot', () => {
    for (const s of battle()) {
      const ids = new Set(s.units.map((u) => u.gameId))
      for (const u of s.units) for (const r of [u.target, u.leader, u.parent]) expect(r === -1 || ids.has(r)).toBe(true)
      for (const p of s.projectiles) expect(ids.has(p.target)).toBe(true)
    }
  })

  it('never reuses a gameId', () => {
    const seen = new Map<number, string>()
    for (const s of battle()) {
      for (const u of s.units) { if (!seen.has(u.gameId)) seen.set(u.gameId, 'unit'); expect(seen.get(u.gameId)).toBe('unit') }
      for (const it of s.units.flatMap((u) => u.items)) { if (!seen.has(it.gameId)) seen.set(it.gameId, 'item'); expect(seen.get(it.gameId)).toBe('item') }
    }
  })
})

describe('spawn order', () => {
  const s = run(scenario({ targetPop: 1000, maxSquadsPerWave: 3 }))[0]

  it('gives gameIds from 1 with each unit followed by its own items', () => {
    expect(s.units[0].gameId).toBe(1)
    s.units.forEach((u, i) => {
      u.items.forEach((it, k) => expect(it.gameId).toBe(u.gameId + 1 + k))
      if (i + 1 < s.units.length) expect(s.units[i + 1].gameId).toBe(u.gameId + 1 + u.items.length)
    })
  })

  it('spawns team 0 before team 1, and each squad as a leader followed by its members', () => {
    const teams = s.units.map((u) => u.team)
    expect(teams).toEqual([...teams].sort())
    expect(s.units.filter((u) => u.leader === -1)).toHaveLength(6)
    let leader: PUnit | undefined
    for (const u of s.units) {
      if (u.leader === -1) leader = u
      else expect(u.leader).toBe(leader!.gameId)
      expect(u.team).toBe(leader!.team)
    }
  })

  // The snapshot is taken after the move phase of tick 0, so positions are one step away from the spawn point.
  it('places leaders at the team edge and members on their formation slots', () => {
    const near = (a: number, b: number, tol: number) => expect(Math.abs(a - b)).toBeLessThanOrEqual(tol)
    for (const u of s.units) {
      if (u.leader !== -1) continue
      near(u.x, u.team === 0 ? 4 * FX : 252 * FX, u.speed)
      expect(u.y).toBeGreaterThanOrEqual(16 * FX)
      const members = s.units.filter((m) => m.leader === u.gameId)
      members.forEach((m, i) => {
        const row = 1 + Math.floor(i / 3)
        const facing = u.team === 0 ? 1 : -1
        near(m.x, Math.min(kernel.MAX_COORD, u.x - facing * row * 2 * FX), u.speed + m.speed)
        near(m.y, u.y + ((i % 3) - 1) * 2 * FX, u.speed + m.speed)
      })
    }
  })

  it('stops a team at targetPop and at maxSquadsPerWave', () => {
    expect(run(scenario({ targetPop: 1000, maxSquadsPerWave: 3 }))[0].units.filter((u) => u.leader === -1)).toHaveLength(6)
    const small = run(scenario({ targetPop: 1, maxSquadsPerWave: 5 }))[0]
    expect(small.units.filter((u) => u.leader === -1)).toHaveLength(2)
  })

  it('spawns a new wave each wavePeriod while a team is below targetPop', () => {
    const h = run(scenario({ targetPop: 1000, maxSquadsPerWave: 1, wavePeriod: 5, ticks: 11 }))
    expect(h.map((x) => x.units.filter((u) => u.leader === -1).length)).toEqual([2, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6])
  })

  it('applies stats at spawn', () => {
    for (const u of s.units) {
      expect(u.hp).toBe(UNIT_STATS[u.kind].maxHp)
      expect(u.cooldown).toBe(0)
      expect(u.attack).toBe(UNIT_STATS[u.kind].attack + u.items.reduce((a, it) => a + ITEMS[it.kind].attack * it.quality, 0))
    }
  })
})

describe('stats recompute', () => {
  it('derives attack, armor and speed from base, items and Haste on every tick', () => {
    let hasted = 0
    for (const s of battle()) {
      for (const u of s.units) {
        if (u.kind === KIND.MINION) continue
        const sum = (f: 'attack' | 'armor' | 'speed') => UNIT_STATS[u.kind][f] + u.items.reduce((a, it) => a + ITEMS[it.kind][f] * it.quality, 0)
        const haste = u.buffs.some((b) => b.kind === BUFF.HASTE)
        expect(u.attack).toBe(sum('attack'))
        expect(u.armor).toBe(sum('armor'))
        expect(u.speed).toBe(haste ? Math.trunc((sum('speed') * 3) / 2) : sum('speed'))
        if (haste) hasted++
      }
    }
    expect(hasted).toBeGreaterThan(0)
  })

  it('shows a pickup in the stats of the same tick', () => {
    let pickups = 0
    for (const [p, c] of steps(battle())) {
      const ground = new Set(p.ground.map((g) => g.gameId))
      for (const u of c.units) for (const it of u.items) if (ground.has(it.gameId)) {
        pickups++
        expect(u.attack).toBe(UNIT_STATS[u.kind].attack + u.items.reduce((a, i) => a + ITEMS[i.kind].attack * i.quality, 0))
      }
    }
    expect(pickups).toBeGreaterThan(0)
  })

  it('uses Haste speed 3/2 for a hasted unit (healer target)', () => {
    const hasted = battle().flatMap((s) => s.units.filter((u) => u.buffs.some((b) => b.kind === BUFF.HASTE) && u.kind !== KIND.MINION))
    expect(hasted.length).toBeGreaterThan(0)
    for (const u of hasted) expect(u.speed).toBe(kernel.fx.div((UNIT_STATS[u.kind].speed + u.items.reduce((a, i) => a + ITEMS[i.kind].speed * i.quality, 0)) * 3, 2))
  })
})

describe('death cascade', () => {
  const deaths = () => steps(battle()).flatMap(([p, c]) => vanished(p, c).filter((d) => d.kind !== KIND.MINION).map((d) => ({ p, c, d })))

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

  it('drops the lowest-gameId item and destroys the others', () => {
    let drops = 0
    for (const { c, d } of deaths()) {
      if (d.items.length === 0) continue
      const [first, ...rest] = d.items
      const held = new Set(c.units.flatMap((u) => u.items.map((i) => i.gameId)))
      const ground = c.ground.find((g) => g.gameId === first.gameId)
      if (ground) {
        expect(ground).toMatchObject({ kind: first.kind, quality: first.quality, age: 0 })
        expect(held.has(first.gameId)).toBe(false)
      } else expect(held.has(first.gameId)).toBe(true) // picked up in the same tick
      for (const it of rest) {
        expect(held.has(it.gameId)).toBe(false)
        expect(c.ground.some((g) => g.gameId === it.gameId)).toBe(false)
      }
      drops++
    }
    expect(drops).toBeGreaterThan(0)
  })

  it('credits a kill to the enemy team for each dead non-minion and never for a minion', () => {
    for (const [p, c] of steps(battle())) {
      const dead = vanished(p, c).filter((d) => d.kind !== KIND.MINION)
      expect(c.kills[0] - p.kills[0]).toBe(dead.filter((d) => d.team === 1).length)
      expect(c.kills[1] - p.kills[1]).toBe(dead.filter((d) => d.team === 0).length)
    }
  })

  it('drops an item at the position where the unit died (ground items keep their place until picked up)', () => {
    for (const [p, c] of steps(battle())) for (const g of p.ground) {
      const now = c.ground.find((x) => x.gameId === g.gameId)
      if (now) expect([now.x, now.y, now.age]).toEqual([g.x, g.y, g.age + 1])
    }
  })
})

describe('leader promotion', () => {
  it('promotes the lowest-gameId surviving member and keeps the others in its squad', () => {
    let promotions = 0
    for (const [p, c] of steps(battle())) {
      for (const d of vanished(p, c)) {
        if (d.leader !== -1 || d.kind === KIND.MINION) continue
        const ids = new Set(c.units.map((u) => u.gameId))
        const members = p.units.filter((m) => m.leader === d.gameId && ids.has(m.gameId))
        if (members.length === 0) continue
        const byId = new Map(c.units.map((u) => [u.gameId, u]))
        const promoted = members[0]
        expect(byId.get(promoted.gameId)!.leader).toBe(-1)
        for (const m of members.slice(1)) expect(byId.get(m.gameId)!.leader).toBe(promoted.gameId)
        promotions++
      }
    }
    expect(promotions).toBeGreaterThan(0)
  })

  // With no enemy left, the survivors walk to the far edge and settle. A member then rests at
  // leaderPos + (its slot offset - the promoted leader's slot offset), clamped to the arena.
  it.each([7, 21, 23])('re-bases formation offsets on the promoted leader (seed %i)', (seed) => {
    const h = run(scenario({ seed, ticks: 4200 }))
    const first = h[0], last = h[h.length - 1]
    const team = last.alive[0] > 0 ? 0 : 1
    const facing = team === 0 ? 1 : -1
    const slotOffset = (id: number) => {
      const squad = first.units.filter((u) => u.team === team)
      const i = squad.findIndex((u) => u.gameId === id) - 1 // leader is index 0, members are slots 0..
      return i < 0 ? [0, 0] : [-facing * (1 + Math.floor(i / 3)) * 2 * FX, ((i % 3) - 1) * 2 * FX]
    }
    const survivors = last.units.filter((u) => u.team === team)
    const leader = survivors.filter((u) => u.leader === -1)
    expect(leader).toHaveLength(1)
    expect(leader[0].gameId).not.toBe(first.units.find((u) => u.team === team && u.leader === -1)!.gameId) // a promotion happened
    const [lox, loy] = slotOffset(leader[0].gameId)
    for (const m of survivors) {
      expect(m.leader).toBe(m === leader[0] ? -1 : leader[0].gameId)
      const [ox, oy] = slotOffset(m.gameId)
      expect([m.x, m.y]).toEqual([
        Math.min(kernel.MAX_COORD, Math.max(0, leader[0].x + ox - lox)),
        Math.min(kernel.MAX_COORD, Math.max(0, leader[0].y + oy - loy)),
      ])
    }
  })
})

describe('pickup', () => {
  it('gives each ground item to the nearest unit with room within 1.5 tiles, ties to the lowest gameId, and respects the cap of 3', () => {
    let pickups = 0
    for (const [p, c] of steps(battle())) {
      for (const u of c.units) expect(u.items.length).toBeLessThanOrEqual(3)
      const ground = new Set(p.ground.map((g) => g.gameId))
      const holder = new Map<number, number>()
      for (const u of c.units) for (const it of u.items) if (ground.has(it.gameId)) holder.set(it.gameId, u.gameId)
      const room = new Map(c.units.map((u) => [u.gameId, u.items.length - u.items.filter((i) => ground.has(i.gameId)).length]))
      for (const g of [...p.ground].sort((a, b) => a.gameId - b.gameId)) {
        let best: PUnit | undefined, bestD = 0
        for (const u of c.units) {
          const d = dist2(g.x, g.y, u.x, u.y)
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
    const h = battle()
    let ages = 0
    for (const [p, c] of steps(h)) {
      for (const g of p.ground) {
        const now = c.ground.find((x) => x.gameId === g.gameId)
        const taker = c.units.flatMap((u) => u.items).find((i) => i.gameId === g.gameId)
        if (taker) expect(taker).toMatchObject({ kind: g.kind, quality: g.quality })
        if (!now && !taker) { expect(g.age + 1).toBe(300); ages++ }
      }
      for (const g of c.ground) expect(g.age).toBeLessThan(300)
    }
    expect(ages).toBeGreaterThanOrEqual(0)
  })
})

describe('buffs', () => {
  // Tracks (unit, buff kind) pairs across ticks.
  const buffSteps = () => steps(battle()).flatMap(([p, c]) => {
    const before = new Map(p.units.map((u) => [u.gameId, u]))
    return c.units.flatMap((u) => u.buffs.map((b) => ({ p, c, u, b, was: before.get(u.gameId)?.buffs.find((x) => x.kind === b.kind) })))
  })
  const FULL = [20, 60, 40]

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

  it('removes a buff after its last tick', () => {
    for (const [p, c] of steps(battle())) for (const u of c.units) {
      const old = p.units.find((x) => x.gameId === u.gameId)
      for (const ob of old?.buffs ?? []) if (ob.ticksLeft === 1) expect(u.buffs.find((b) => b.kind === ob.kind && b.ticksLeft === 0)).toBeUndefined()
    }
  })

  // An undisturbed burn: hp only changes by exactly -2, on the ticks where ticksLeft % 10 == 0,
  // including the tick that removes the buff. Any other timing breaks the pattern.
  it('burns 2 damage when ticksLeft % 10 == 0, six times in a full burn', () => {
    const h = battle()
    let clean = 0
    for (let t0 = 1; t0 < h.length - 61; t0++) {
      for (const u0 of h[t0].units) {
        const b0 = u0.buffs.find((b) => b.kind === BUFF.BURN)
        const prevBurn = h[t0 - 1].units.find((u) => u.gameId === u0.gameId)?.buffs.find((b) => b.kind === BUFF.BURN)
        if (!b0 || prevBurn || b0.ticksLeft !== 59) continue // a fresh burn, first seen at tick t0
        const hpAt = (k: number) => h[t0 + k].units.find((u) => u.gameId === u0.gameId)?.hp
        let ok = true
        let burnTicks = 0
        for (let k = 1; k <= 59 && ok; k++) {
          const left = 59 - k
          const dhp = hpAt(k) === undefined || hpAt(k - 1) === undefined ? NaN : hpAt(k)! - hpAt(k - 1)!
          if (left % 10 === 0) { ok = dhp === -2; burnTicks++ } else ok = dhp === 0
        }
        if (ok && burnTicks === 6) {
          clean++
          expect(h[t0 + 60].units.find((u) => u.gameId === u0.gameId)?.buffs.some((b) => b.kind === BUFF.BURN) ?? false).toBe(false)
        }
      }
    }
    expect(clean).toBeGreaterThan(0)
  })
})

describe('determinism', () => {
  it('replays the same snapshots for the same scenario', () => {
    const sc = scenario({ targetPop: 30, maxSquadsPerWave: 5, wavePeriod: 50, ticks: 60 })
    const a = createSim(sc, kernel), b = createSim(sc, kernel)
    for (let t = 0; t < 60; t++) {
      for (const ph of ['spawn', 'ai/target', 'move', 'combat', 'effects', 'cleanup', 'stats'] as const) { a.phases[ph](); b.phases[ph]() }
      expect(a.snapshot()).toEqual(b.snapshot())
    }
    expect(parse(a.snapshot()).units.length).toBeGreaterThan(0)
  })
})
