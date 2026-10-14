import { BUFF_NAME, type Context } from '../context.ts'
import { sampleEntities } from '../profiling.ts'
import type { DamageIntent, Edge, Unit } from '../types.ts'

export const combatSystem = (ctx: Context) => {
  const { k, scenario, add, dirty, unitById, world, isStunned, inRange, targetOf } = ctx
  const { seed } = scenario
  const { BUFF, KIND, UNIT_STATS } = k

  const applyBuff = (u: Unit, b: number) => {
    if (ctx.counters) {
      if (u.buffs[b] > 0) add(`buff.refresh.${BUFF_NAME[b]}`)
      else { add(`buff.add.${BUFF_NAME[b]}`); dirty?.add(u.gameId) }
    }
    u.buffs[b] = k.BUFF_DURATION[b]
  }

  const addThreat = (victim: Unit, attacker: number, amount: number) => {
    const i = victim.threat.findIndex((e) => e.attacker >= attacker)
    if (i !== -1 && victim.threat[i].attacker === attacker) {
      victim.threat[i].amount = Math.min(k.THREAT_CLAMP, victim.threat[i].amount + amount)
      add('rel.Threat.accumulate')
    } else {
      victim.threat.splice(i === -1 ? victim.threat.length : i, 0, { attacker, amount: Math.min(k.THREAT_CLAMP, amount) })
      add('rel.Threat.add')
    }
  }

  const evictThreat = (victim: Unit) => {
    while (victim.threat.length > k.THREAT_MAX_EDGES) {
      let worst = 0
      victim.threat.forEach((e, i) => {
        const w = victim.threat[worst]
        if (e.amount < w.amount || (e.amount === w.amount && e.attacker > w.attacker)) worst = i
      })
      victim.threat.splice(worst, 1)
      add('rel.Threat.evict')
    }
  }

  return () => {
    const { units, projectiles, tick } = ctx
    const intents: DamageIntent[] = []
    for (let u_i = 0, u = units[0]; u_i < units.length; u = units[++u_i]) { u.dmgIn = 0; u.healIn = 0; u.stunIn = false; u.burnIn = false; u.hasteIn = false }

    const addDamage = (victim: Unit, attacker: number, team: number, value: number) => {
      victim.dmgIn += value
      intents.push({ victim, attacker, team, value })
    }

    add('q.combat.projectiles', projectiles.length)
    for (let p_i = 0, p = projectiles[0]; p_i < projectiles.length; p = projectiles[++p_i]) {
      const t = unitById.get(p.target)
      if (!t || p.x !== t.x || p.y !== t.y) continue
      p.spent = true
      add('q.combat.hits')
      if (p.ownerKind === KIND.MAGE) {
        ctx.grid.forNear(p.x, p.y, k.SPLASH_RADIUS, (h) => {
          const v = ctx.slots[h]
          if (v.team === p.ownerTeam) return
          addDamage(v, p.owner, p.ownerTeam, k.damage(p.attack, v.armor, p.crit))
          v.burnIn = true
        }, 'splash')
      } else if (p.volley) addDamage(t, p.owner, p.ownerTeam, k.volleyDamage(p.attack, t.armor, p.crit))
      else addDamage(t, p.owner, p.ownerTeam, k.damage(p.attack, t.armor, p.crit))
    }

    const fire = (u: Unit, speed: number, crit: boolean, volley: boolean) => {
      add('create.projectile')
      projectiles.push({
        gameId: ctx.nextId++, owner: u.gameId, target: u.target, x: u.x, y: u.y, age: 0, speed, volley,
        ownerTeam: u.team, ownerKind: u.kind, attack: u.attack, crit, spent: false,
      })
    }
    for (let u_i = 0, u = units[0]; u_i < units.length; u = units[++u_i]) {
      if (isStunned(u) || u.fleeing || u.cooldown !== 0 || u.kind === KIND.SUMMONER) continue
      const t = targetOf(u)
      if (!t || !inRange(u.x, u.y, t.x, t.y, UNIT_STATS[u.kind].range)) continue
      const crit = k.isCrit(seed, tick, u.gameId)
      if (u.kind === KIND.WARRIOR || u.kind === KIND.MINION || u.kind === KIND.WARLORD) {
        addDamage(t, u.gameId, u.team, k.damage(u.attack, t.armor, crit))
        if (crit && u.kind !== KIND.MINION) t.stunIn = true
      } else if (u.kind === KIND.MAGE) {
        fire(u, k.PROJECTILE_SPEED, crit, false)
      } else if (u.kind === KIND.ARCHER) {
        for (let j = 0; j < k.VOLLEY_SIZE; j++) fire(u, k.PROJECTILE_SPEED - k.VOLLEY_SPEED_STEP * j, crit, true)
      } else {
        t.healIn += u.attack
        t.hasteIn = true
      }
      u.cooldown = UNIT_STATS[u.kind].cooldown
      add('q.combat.attackers')
    }

    for (let u_i = 0, u = units[0]; u_i < units.length; u = units[++u_i]) if (u.cooldown > 0) u.cooldown--

    // Resolve. Buffs from this phase start now, a repeat resets ticksLeft.
    for (let u_i = 0, u = units[0]; u_i < units.length; u = units[++u_i]) {
      u.hp = Math.min(u.maxHp, u.hp - u.dmgIn + u.healIn)
      if (u.hp <= 0) u.dead = true
      if (u.stunIn) applyBuff(u, BUFF.STUN)
      if (u.burnIn) applyBuff(u, BUFF.BURN)
      if (u.hasteIn) applyBuff(u, BUFF.HASTE)
    }

    intents.sort((a, b) => a.victim.gameId - b.victim.gameId || a.attacker - b.attacker)
    for (let i = 0; i < intents.length;) {
      const victim = intents[i].victim
      const sums: Edge[] = []
      for (; i < intents.length && intents[i].victim === victim; i++) {
        const { attacker, value } = intents[i]
        if (!unitById.has(attacker)) continue
        const last = sums[sums.length - 1]
        if (last && last.attacker === attacker) last.amount += value
        else sums.push({ attacker, amount: value })
      }
      let best: Edge | undefined
      for (let s_i = 0, s = sums[0]; s_i < sums.length; s = sums[++s_i]) if (!best || s.amount > best.amount) best = s
      if (best) victim.lastHitBy = best.attacker
      if (victim.fleeing) continue
      for (let s_i = 0, s = sums[0]; s_i < sums.length; s = sums[++s_i]) addThreat(victim, s.attacker, s.amount)
      evictThreat(victim)
    }

    for (let d_i = 0, d = intents[0]; d_i < intents.length; d = intents[++d_i]) world.damage[d.team] = (world.damage[d.team] + d.value) | 0
    sampleEntities(ctx)
  }
}
