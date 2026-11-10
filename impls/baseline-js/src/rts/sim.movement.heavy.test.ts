// Behaviour tests through the Sim API and the SPEC §8 snapshot only.
// This file: movement, targeting, projectiles, buffs and trails.
// "p" is the snapshot at the start of a tick, "c" the snapshot at its end. The fights are in sim-fixtures.ts.
import { describe, it } from 'vitest'
import { kernel } from '@ecs-arena/spec'
import { expect } from './fast-expect.ts'
import { type PProjectile, type PUnit, SMALL } from './testkit.ts'
import {
  BUFF, FX, KIND, MELEE, type Rule, type Step, Tape, UNIT_STATS, aiOf, attacked, fights, fleeing, homeX, inRange, isCrit, memo,
  overwhelmedAt, slotOffsets, spawned, stepToward, steps, stepsOf, stunned, vanished, veteranFight,
} from './sim-fixtures.ts'

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
    for (let seed = 8; onTarget === 0 && seed < 60; seed++) check(stepsOf(seed, new Tape({ ...SMALL, garrisonCap: 0, ordersPerTeam: 0, seed })))
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
        const o = s.h.at(fired - 1).units.find((u) => u.gameId === pr.owner)
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
      for (const u0 of h.at(t0).units) {
        const b0 = u0.buffs.find((b) => b.kind === BUFF.BURN)
        const prev = h.at(t0 - 1).units.find((u) => u.gameId === u0.gameId)?.buffs.find((b) => b.kind === BUFF.BURN)
        if (!b0 || prev || b0.ticksLeft !== 59) continue
        const hpAt = (k: number) => h.at(t0 + k).units.find((u) => u.gameId === u0.gameId)?.hp
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
