import { BUFF_NAME, type Context } from '../context.ts'
import { sampleEntities } from '../profiling.ts'
import type { DamageIntent, Edge, Unit } from '../types.ts'

export const combatSystem = (ctx: Context) => {
  const { k, scenario, add, begin, end, dirty, buffed, threatened, unitById, world, isStunned, inRange, targetOf, overwhelmed } = ctx
  const naiveFanIn = ctx.isNaive('combat.fanIn')
  const { seed } = scenario
  const { BUFF, KIND, UNIT_STATS } = k

  const applyBuff = (u: Unit, b: number) => {
    if (u.buffs[b] > 0) add(`buff.refresh.${BUFF_NAME[b]}`)
    else { add(`buff.add.${BUFF_NAME[b]}`); dirty.add(u) }
    u.buffs[b] = k.BUFF_DURATION[b]
    buffed.add(u)
  }

  const addThreat = (victim: Unit, attacker: number, amount: number) => {
    const th = victim.threat
    let i = 0
    while (i < th.length && th[i].attacker < attacker) i++
    if (i < th.length && th[i].attacker === attacker) {
      th[i].amount = Math.min(k.THREAT_CLAMP, th[i].amount + amount)
      add('rel.Threat.accumulate')
    } else {
      th.splice(i, 0, { attacker, amount: Math.min(k.THREAT_CLAMP, amount) })
      add('rel.Threat.add')
    }
  }

  const evictThreat = (victim: Unit) => {
    const th = victim.threat
    while (th.length > k.THREAT_MAX_EDGES) {
      let worst = 0
      for (let i = 1; i < th.length; i++) {
        const e = th[i], w = th[worst]
        if (e.amount < w.amount || (e.amount === w.amount && e.attacker > w.attacker)) worst = i
      }
      th.splice(worst, 1)
      add('rel.Threat.evict')
    }
  }

  return () => {
    const { units, projectiles, tick } = ctx
    const intents: DamageIntent[] = []
    for (let u_i = 0, u = units[0]; u_i < units.length; u = units[++u_i]) { u.dmgIn = 0; u.healIn = 0; u.stunIn = false; u.burnIn = false; u.hasteIn = false }

    // Overwhelmed: 6 or more enemy units target the victim at the start of combat.
    begin('combat.fanIn')
    if (naiveFanIn) {
      const counts = new Map<Unit, number>()
      for (let u_i = 0, u = units[0]; u_i < units.length; u = units[++u_i]) u.overwhelmed = false
      for (let u_i = 0, u = units[0]; u_i < units.length; u = units[++u_i]) {
        const v = u.target === -1 ? undefined : unitById.get(u.target)
        if (v && v.team !== u.team) counts.set(v, (counts.get(v) ?? 0) + 1)
      }
      for (const [v, n] of counts) if (n >= k.OVERWHELM_ATTACKERS) v.overwhelmed = true
    } else {
      for (const u of overwhelmed) u.overwhelmed = false
      overwhelmed.clear()
      for (const [id, set] of ctx.targeters) {
        if (set.size < k.OVERWHELM_ATTACKERS) continue
        const v = unitById.get(id)
        if (!v) continue
        let n = 0
        for (const a of set) if (a.team !== v.team) n++
        if (n >= k.OVERWHELM_ATTACKERS) { v.overwhelmed = true; overwhelmed.add(v) }
      }
    }
    end('combat.fanIn')

    const addDamage = (victim: Unit, attacker: number, team: number, value: number) => {
      if (victim.overwhelmed) { value = k.overwhelmDamage(value); add('rule.overwhelmed') }
      victim.dmgIn += value
      intents.push({ victim, attacker, team, value })
    }

    ctx.resendGrid()
    add('q.combat.projectiles', projectiles.length)
    for (let p_i = 0, p = projectiles[0]; p_i < projectiles.length; p = projectiles[++p_i]) {
      const t = unitById.get(p.target)
      if (!t || p.x !== t.x || p.y !== t.y) continue
      p.spent = true
      add('q.combat.hits')
      if (p.ownerKind === KIND.MAGE) {
        ctx.grid.forNear(p.x, p.y, k.SPLASH_RADIUS, (h) => {
          const v = ctx.slots[h]
          if (v.team === p.ownerTeam || v.garrison) return
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

    const writes: { victim: Unit; sums: Edge[] }[] = []
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
      writes.push({ victim, sums })
    }
    begin('threat')
    for (let w_i = 0, w = writes[0]; w_i < writes.length; w = writes[++w_i]) {
      const { victim, sums } = w
      for (let s_i = 0, s = sums[0]; s_i < sums.length; s = sums[++s_i]) addThreat(victim, s.attacker, s.amount)
      evictThreat(victim)
      if (sums.length > 0) threatened.add(victim)
    }
    end('threat')

    for (let d_i = 0, d = intents[0]; d_i < intents.length; d = intents[++d_i]) world.damage[d.team] = (world.damage[d.team] + d.value) | 0
    sampleEntities(ctx)
  }
}
