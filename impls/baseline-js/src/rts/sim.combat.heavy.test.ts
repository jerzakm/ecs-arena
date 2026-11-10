// Behaviour tests through the Sim API and the SPEC §8 snapshot only.
// This file: banners, crowding, stuns, healing, deaths, morale, promotion, threat and veterans.
// "p" is the snapshot at the start of a tick, "c" the snapshot at its end. The fights are in sim-fixtures.ts.
import { describe, it } from 'vitest'
import { kernel } from '@ecs-arena/spec'
import { expect } from './fast-expect.ts'
import { BANNERED, FLEEING, OVERWHELMED, ROUTED, SMALL, VETERAN } from './testkit.ts'
import {
  BUFF, KIND, SEEDS, STUNNERS, type Step, Tape, aiOf, ambiguous, attacked, bannerOf, fights, fleeing, homeX, isCrit, leaves,
  memo, overwhelmedAt, slotOffsets, spawned, stepToward, steps, stepsOf, stunned, sum, survivingMembers, vanished, veteranFight,
} from './sim-fixtures.ts'

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
    for (let seed = 8; lost === 0 && seed < 60; seed++) check(stepsOf(seed, new Tape({ ...SMALL, garrisonCap: 0, ordersPerTeam: 0, seed })))
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
  function* deaths() {
    for (const s of steps()) if (!ambiguous(s)) for (const d of vanished(s)) if (d.kind !== KIND.MINION && !leaves(d)) yield { ...s, d }
  }

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
      let first = 0
      while (h.at(first).damage[0] + h.at(first).damage[1] === 0) first++
      const c = h.at(first), p = h.at(first - 1)
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
