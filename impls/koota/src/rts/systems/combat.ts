import type { Entity } from 'koota'
import type { Ctx } from '../context.ts'
import {
  Age, Burn, Clock, Dead, FiredBy, Fleeing, GameId, Haste, Health, LastHitBy, Metrics, Overwhelmed, Position, Projectile, Spent,
  Stats, Stun, Targets, Team, Threat, Unit,
} from '../traits.ts'
import { nextId } from '../entities.ts'
import { upsert } from '../../shared/util.ts'

interface Damage { victim: Entity; victimId: number; attacker: Entity | undefined; attackerId: number; team: number; value: number }
interface Incoming { damage: number; heal: number; stun: boolean; burn: boolean; haste: boolean }
interface Shot {
  id: number; j: number; shooter: Entity; target: Entity; x: number; y: number; team: number; kind: number; attack: number; crit: boolean
}

const byShooter = (a: Shot, b: Shot) => a.id - b.id || a.j - b.j
const byVictimThenAttacker = (a: Damage, b: Damage) => a.victimId - b.victimId || a.attackerId - b.attackerId

// koota 0.6.6 ignores `set(pair, updater)` (workarounds.ts), so the amount is read first and set as an object.
const raiseThreat = (victim: Entity, attacker: Entity, add: number, clamp: number) => {
  const amount = Math.min(clamp, (victim.get(Threat(attacker))?.amount ?? 0) + add)
  if (victim.has(Threat(attacker))) victim.set(Threat(attacker), { amount })
  else victim.add(Threat(attacker, { amount }))
}

export const combatSystem = (ctx: Ctx) => {
  const { k, world, q, scenario } = ctx
  const { KIND, BUFF, UNIT_STATS, inRange } = k
  const { seed } = scenario

  return () => {
    const { tick } = world.get(Clock)!
    const damages: Damage[] = []
    const incoming = new Map<Entity, Incoming>()
    const incomingOf = (e: Entity) => {
      let i = incoming.get(e)
      if (!i) incoming.set(e, i = { damage: 0, heal: 0, stun: false, burn: false, haste: false })
      return i
    }
    // Overwhelmed: 6 or more enemy units target the victim at the start of combat.
    const fanIn = new Map<Entity, number>()
    for (const a of world.query(Unit, Targets('*'))) {
      const v = a.targetFor(Targets)!
      if (a.get(Team)!.value !== v.get(Team)!.value) fanIn.set(v, (fanIn.get(v) ?? 0) + 1)
    }
    const over = new Set<Entity>()
    for (const [v, n] of fanIn) if (n >= k.OVERWHELM_ATTACKERS) over.add(v)
    for (const e of world.query(Overwhelmed)) if (!over.has(e)) e.remove(Overwhelmed)
    for (const e of over) if (!e.has(Overwhelmed)) e.add(Overwhelmed)

    const hurt = (victim: Entity, attacker: Entity | undefined, attackerId: number, team: number, value: number) => {
      if (over.has(victim)) value = k.overwhelmDamage(value)
      incomingOf(victim).damage += value
      damages.push({ victim, victimId: victim.get(GameId)!.id, attacker, attackerId, team, value })
    }

    const spent: Entity[] = []
    world.query(q.projectiles).readEach(([pr, p], e) => {
      const t = e.targetFor(Targets)
      if (!t) return
      const tp = t.get(Position)!
      if (p.x !== tp.x || p.y !== tp.y) return
      spent.push(e)
      const crit = pr.crit === 1
      const shooter = e.targetFor(FiredBy)
      if (pr.ownerKind === KIND.MAGE) {
        ctx.grid.forNear(p.x, p.y, k.SPLASH_RADIUS, (h) => {
          if (ctx.teamAt[h] === pr.ownerTeam) return
          const v = ctx.unitAt[h]
          hurt(v, shooter, pr.owner, pr.ownerTeam, k.damage(pr.attack, v.get(Stats)!.armor, crit))
          incomingOf(v).burn = true
        })
      } else {
        const armor = t.get(Stats)!.armor
        hurt(t, shooter, pr.owner, pr.ownerTeam, pr.volley ? k.volleyDamage(pr.attack, armor, crit) : k.damage(pr.attack, armor, crit))
      }
    })
    for (const e of spent) e.add(Spent)

    const shots: Shot[] = []
    world.query(q.attackers).updateEach(([g, kindT, teamT, p, s, cd], e) => {
      const kind = kindT.value
      if (cd.value !== 0 || kind === KIND.SUMMONER) return
      const t = e.targetFor(Targets)
      if (!t) return
      const tp = t.get(Position)!
      if (!inRange(p.x, p.y, tp.x, tp.y, UNIT_STATS[kind].range)) return
      const crit = k.isCrit(seed, tick, g.id)
      if (kind === KIND.WARRIOR || kind === KIND.MINION || kind === KIND.WARLORD) {
        hurt(t, e, g.id, teamT.value, k.damage(s.attack, t.get(Stats)!.armor, crit))
        if (crit && kind !== KIND.MINION) incomingOf(t).stun = true
      } else if (kind === KIND.MAGE || kind === KIND.ARCHER) {
        const volley = kind === KIND.ARCHER ? k.VOLLEY_SIZE : 1
        for (let j = 0; j < volley; j++) {
          shots.push({ id: g.id, j, shooter: e, target: t, x: p.x, y: p.y, team: teamT.value, kind, attack: s.attack, crit })
        }
      } else {
        const i = incomingOf(t)
        i.heal += s.attack
        i.haste = true
      }
      cd.value = UNIT_STATS[kind].cooldown
    })
    shots.sort(byShooter)
    for (const s of shots) {
      const volley = s.kind === KIND.ARCHER
      world.spawn(
        GameId({ id: nextId(ctx) }), Position({ x: s.x, y: s.y }), Age,
        Projectile({
          owner: s.id, ownerTeam: s.team, ownerKind: s.kind, attack: s.attack, crit: s.crit ? 1 : 0,
          speed: k.PROJECTILE_SPEED - (volley ? k.VOLLEY_SPEED_STEP * s.j : 0), volley: volley ? 1 : 0,
        }),
        Targets(s.target), FiredBy(s.shooter)
      )
    }

    world.query(q.cooldowns).updateEach(([cd]) => { if (cd.value > 0) cd.value-- })

    for (const [e, inc] of incoming) {
      const h = e.get(Health)!
      const hp = Math.min(h.maxHp, h.hp - inc.damage + inc.heal)
      e.set(Health, { hp })
      if (hp <= 0) e.add(Dead)
      if (inc.stun) upsert(e, Stun, { ticksLeft: k.BUFF_DURATION[BUFF.STUN] })
      if (inc.burn) upsert(e, Burn, { ticksLeft: k.BUFF_DURATION[BUFF.BURN] })
      if (inc.haste) upsert(e, Haste, { ticksLeft: k.BUFF_DURATION[BUFF.HASTE] })
    }

    damages.sort(byVictimThenAttacker)
    for (let i = 0; i < damages.length;) {
      const victim = damages[i].victim
      const sums: { attacker: Entity; id: number; amount: number }[] = []
      for (; i < damages.length && damages[i].victim === victim; i++) {
        const { attacker, attackerId, value } = damages[i]
        if (!attacker) continue
        const last = sums[sums.length - 1]
        if (last && last.id === attackerId) last.amount += value
        else sums.push({ attacker, id: attackerId, amount: value })
      }
      let top: (typeof sums)[number] | undefined
      for (const s of sums) if (!top || s.amount > top.amount) top = s
      if (top) victim.add(LastHitBy(top.attacker))
      if (victim.has(Fleeing)) continue
      for (const s of sums) {
        raiseThreat(victim, s.attacker, s.amount, k.THREAT_CLAMP)
      }
      const edges = victim.targetsFor(Threat).map((a) => ({ a, id: a.get(GameId)!.id, amount: victim.get(Threat(a))!.amount }))
      while (edges.length > k.THREAT_MAX_EDGES) {
        let worst = 0
        edges.forEach((e, n) => {
          const w = edges[worst]
          if (e.amount < w.amount || (e.amount === w.amount && e.id > w.id)) worst = n
        })
        victim.remove(Threat(edges[worst].a))
        edges.splice(worst, 1)
      }
    }

    const dealt = [0, 0]
    for (const d of damages) dealt[d.team] += d.value
    world.set(Metrics, (m) => ({ damage0: (m.damage0 + dealt[0]) | 0, damage1: (m.damage1 + dealt[1]) | 0 }))
  }
}
