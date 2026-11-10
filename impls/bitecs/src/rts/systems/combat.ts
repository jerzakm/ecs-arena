import { addComponent, addComponents, hasComponent, query, removeComponent } from 'bitecs'
import type { Ctx } from '../context.ts'
import {
  Age, Burn, Cooldown, Dead, Fleeing, Haste, Health, Kind, Overwhelmed, Position, Projectile, Spent, Stats, Stun, Team,
} from '../components.ts'
import { GameId } from '../../shared/components.ts'
import { newEntity, nextId } from '../entities.ts'
import { Q } from '../queries.ts'
import { addThreat, FiredBy, LastHitBy, removeThreat, setLink, Targets, Threat } from '../relations.ts'

interface Damage { victim: number; victimId: number; attacker: number; attackerId: number; team: number; value: number }
interface Incoming { damage: number; heal: number; stun: boolean; burn: boolean; haste: boolean }
interface Shot {
  id: number; j: number; shooter: number; target: number; x: number; y: number; team: number; kind: number; attack: number; crit: boolean
}

const byShooter = (a: Shot, b: Shot) => a.id - b.id || a.j - b.j
const byVictimThenAttacker = (a: Damage, b: Damage) => a.victimId - b.victimId || a.attackerId - b.attackerId

const setBuff = (ctx: Ctx, e: number, buff: { ticksLeft: Int32Array }, ticksLeft: number) => {
  addComponent(ctx.world, e, buff)
  buff.ticksLeft[e] = ticksLeft
}

export const combatSystem = (ctx: Ctx) => {
  const { k, world, scenario } = ctx
  const { KIND, BUFF, UNIT_STATS, inRange } = k
  const { seed } = scenario
  return () => {
    const tick = world.tick
    const damages: Damage[] = []
    const incoming = new Map<number, Incoming>()
    const incomingOf = (e: number) => {
      let i = incoming.get(e)
      if (!i) incoming.set(e, i = { damage: 0, heal: 0, stun: false, burn: false, haste: false })
      return i
    }
    // Overwhelmed: 6 or more enemy units target the victim at the start of combat.
    const fanIn = new Map<number, number>()
    for (const a of query(world, Q.units)) {
      const v = Targets.to[a]
      if (v !== -1 && Team.value[a] !== Team.value[v]) fanIn.set(v, (fanIn.get(v) ?? 0) + 1)
    }
    const over = new Set<number>()
    for (const [v, n] of fanIn) if (n >= k.OVERWHELM_ATTACKERS) over.add(v)
    const flagged = Array.from(query(world, Q.overwhelmed))
    for (const e of flagged) if (!over.has(e)) removeComponent(world, e, Overwhelmed)
    for (const e of over) addComponent(world, e, Overwhelmed)

    const hurt = (victim: number, attacker: number, attackerId: number, team: number, value: number) => {
      if (over.has(victim)) value = k.overwhelmDamage(value)
      incomingOf(victim).damage += value
      damages.push({ victim, victimId: GameId.id[victim], attacker, attackerId, team, value })
    }

    const spent: number[] = []
    for (const e of query(world, Q.projectiles)) {
      const t = Targets.to[e]
      if (t === -1) continue
      if (Position.x[e] !== Position.x[t] || Position.y[e] !== Position.y[t]) continue
      spent.push(e)
      const crit = Projectile.crit[e] === 1
      const shooter = FiredBy.to[e]
      const ownerTeam = Projectile.ownerTeam[e], attack = Projectile.attack[e], owner = Projectile.owner[e]
      if (Projectile.ownerKind[e] === KIND.MAGE) {
        ctx.grid.forNear(Position.x[e], Position.y[e], k.SPLASH_RADIUS, (h) => {
          if (Team.value[h] === ownerTeam) return
          hurt(h, shooter, owner, ownerTeam, k.damage(attack, Stats.armor[h], crit))
          incomingOf(h).burn = true
        })
      } else {
        const armor = Stats.armor[t]
        hurt(t, shooter, owner, ownerTeam, Projectile.volley[e] ? k.volleyDamage(attack, armor, crit) : k.damage(attack, armor, crit))
      }
    }
    for (const e of spent) addComponent(world, e, Spent)

    const shots: Shot[] = []
    for (const e of query(world, Q.attackers)) {
      const kind = Kind.value[e]
      if (Cooldown.value[e] !== 0 || kind === KIND.SUMMONER) continue
      const t = Targets.to[e]
      if (t === -1) continue
      const px = Position.x[e], py = Position.y[e]
      if (!inRange(px, py, Position.x[t], Position.y[t], UNIT_STATS[kind].range)) continue
      const id = GameId.id[e], team = Team.value[e], attack = Stats.attack[e]
      const crit = k.isCrit(seed, tick, id)
      if (kind === KIND.WARRIOR || kind === KIND.MINION || kind === KIND.WARLORD) {
        hurt(t, e, id, team, k.damage(attack, Stats.armor[t], crit))
        if (crit && kind !== KIND.MINION) incomingOf(t).stun = true
      } else if (kind === KIND.MAGE || kind === KIND.ARCHER) {
        const volley = kind === KIND.ARCHER ? k.VOLLEY_SIZE : 1
        for (let j = 0; j < volley; j++) shots.push({ id, j, shooter: e, target: t, x: px, y: py, team, kind, attack, crit })
      } else {
        const i = incomingOf(t)
        i.heal += attack
        i.haste = true
      }
      Cooldown.value[e] = UNIT_STATS[kind].cooldown
    }
    shots.sort(byShooter)
    for (const s of shots) {
      const volley = s.kind === KIND.ARCHER
      const p = newEntity(ctx)
      addComponents(world, p, [GameId, Position, Age, Projectile])
      GameId.id[p] = nextId(ctx); Position.x[p] = s.x; Position.y[p] = s.y; Age.value[p] = 0
      Projectile.owner[p] = s.id; Projectile.ownerTeam[p] = s.team; Projectile.ownerKind[p] = s.kind; Projectile.attack[p] = s.attack
      Projectile.crit[p] = s.crit ? 1 : 0; Projectile.volley[p] = volley ? 1 : 0
      Projectile.speed[p] = k.PROJECTILE_SPEED - (volley ? k.VOLLEY_SPEED_STEP * s.j : 0)
      setLink(p, Targets, s.target)
      setLink(p, FiredBy, s.shooter)
    }

    for (const e of query(world, Q.cooldowns)) if (Cooldown.value[e] > 0) Cooldown.value[e]--

    for (const [e, inc] of incoming) {
      const hp = Math.min(Health.maxHp[e], Health.hp[e] - inc.damage + inc.heal)
      Health.hp[e] = hp
      if (hp <= 0) addComponent(world, e, Dead)
      if (inc.stun) setBuff(ctx, e, Stun, k.BUFF_DURATION[BUFF.STUN])
      if (inc.burn) setBuff(ctx, e, Burn, k.BUFF_DURATION[BUFF.BURN])
      if (inc.haste) setBuff(ctx, e, Haste, k.BUFF_DURATION[BUFF.HASTE])
    }

    damages.sort(byVictimThenAttacker)
    for (let i = 0; i < damages.length;) {
      const victim = damages[i].victim
      const sums: { attacker: number; id: number; amount: number }[] = []
      for (; i < damages.length && damages[i].victim === victim; i++) {
        const { attacker, attackerId, value } = damages[i]
        if (attacker === -1) continue
        const last = sums[sums.length - 1]
        if (last && last.id === attackerId) last.amount += value
        else sums.push({ attacker, id: attackerId, amount: value })
      }
      let top: (typeof sums)[number] | undefined
      for (const s of sums) if (!top || s.amount > top.amount) top = s
      if (top) setLink(victim, LastHitBy, top.attacker)
      if (hasComponent(world, victim, Fleeing)) continue
      for (const s of sums) {
        const at = Threat.attackers[victim]?.indexOf(s.attacker) ?? -1
        addThreat(victim, s.attacker, Math.min(k.THREAT_CLAMP, (at === -1 ? 0 : Threat.amount[victim][at]) + s.amount))
      }
      const edges = (Threat.attackers[victim] ?? []).map((a, i) => ({ a, id: GameId.id[a], amount: Threat.amount[victim][i] }))
      while (edges.length > k.THREAT_MAX_EDGES) {
        let worst = 0
        edges.forEach((e, n) => {
          const w = edges[worst]
          if (e.amount < w.amount || (e.amount === w.amount && e.id > w.id)) worst = n
        })
        removeThreat(victim, edges[worst].a)
        edges.splice(worst, 1)
      }
    }

    const dealt = [0, 0]
    for (const d of damages) dealt[d.team] += d.value
    world.metrics.damage0 = (world.metrics.damage0 + dealt[0]) | 0
    world.metrics.damage1 = (world.metrics.damage1 + dealt[1]) | 0
  }
}
