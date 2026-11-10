// Behaviour tests through the Sim API and the SPEC §8 snapshot only.
// This file: shrines, surges, pickups, the winner, garrisons and commander orders.
// "p" is the snapshot at the start of a tick, "c" the snapshot at its end. The fights are in sim-fixtures.ts.
import { describe, it } from 'vitest'
import { PHASES, kernel } from '@ecs-arena/spec'
import { expect } from './fast-expect.ts'
import { GARRISONED, type PUnit, type Parsed, SMALL, parse, scenario } from './testkit.ts'
import createSim from './index.ts'
import {
  BUFF, FX, KIND, PURPOSE, SQUADS, Tape, distSq, fleeing, inRange, index, memo, randInt, run, steps, stunned, teamGameId,
} from './sim-fixtures.ts'

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
  const h = memo(() => new Tape(surgeScenario))

  it('spawns surgeBase * (shrine lead) squads for the leading team, up to surgeCap, and none on a tie', () => {
    let surged = 0, ties = 0, capped = 0, limited = 0
    const seen = new Set<number>()
    for (let t = 1; t < h().length; t++) {
      const c = h().at(t), p = h().at(t - 1)
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
