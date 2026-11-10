import type { Ctx } from '../context.ts'
import { BUFF_NAME } from '../profiling.ts'
import type { Unit } from '../types.ts'

export const effectsSystem = (ctx: Ctx) => {
  const { k, add, begin, end, dirty, buffed, threatened } = ctx
  const { fx, BUFF } = k
  const naiveBuffs = ctx.isNaive('effects.buffs'), naiveThreat = ctx.isNaive('threat')

  const tickBuff = (u: Unit, b: number) => {
    u.buffs[b]--
    if (u.buffs[b] === 0) { add(`buff.remove.${BUFF_NAME[b]}`); dirty.add(u) }
    if (b === BUFF.BURN && u.buffs[b] % k.BURN_INTERVAL === 0) u.hp -= k.BURN_DAMAGE
  }

  const decay = (u: Unit) => {
    if (u.threat.length === 0) return
    for (let e_i = 0, e = u.threat[0]; e_i < u.threat.length; e = u.threat[++e_i]) e.amount -= Math.max(1, fx.div(e.amount, 4))
    add('rel.Threat.decay', u.threat.length)
    const kept = u.threat.filter((e) => e.amount > 0)
    add('rel.Threat.decayRemove', u.threat.length - kept.length)
    u.threat = kept
  }

  return () => {
    const { units, tick } = ctx
    begin('effects.buffs')
    if (naiveBuffs) {
      for (let b = 0; b < 3; b++) {
        for (let u_i = 0, u = units[0]; u_i < units.length; u = units[++u_i]) if (u.buffs[b] !== 0) tickBuff(u, b)
      }
      for (let u_i = 0, u = units[0]; u_i < units.length; u = units[++u_i]) {
        if (ctx.counters && (u.buffs[0] > 0 || u.buffs[1] > 0 || u.buffs[2] > 0)) add('q.effects.buffed')
        if (u.hp <= 0) u.dead = true
      }
    } else {
      // Only buffed units can change here: an unbuffed unit with no hp left was already marked dead by combat.
      for (const u of buffed) {
        if (ctx.counters) add('q.effects.buffed')
        for (let b = 0; b < 3; b++) if (u.buffs[b] !== 0) tickBuff(u, b)
        if (u.hp <= 0) u.dead = true
        if (u.buffs[0] === 0 && u.buffs[1] === 0 && u.buffs[2] === 0) buffed.delete(u)
      }
    }
    end('effects.buffs')
    if (tick % k.THREAT_DECAY_PERIOD === 0) {
      begin('threat')
      if (naiveThreat) for (let u_i = 0, u = units[0]; u_i < units.length; u = units[++u_i]) decay(u)
      else for (const u of threatened) { decay(u); if (u.threat.length === 0) threatened.delete(u) }
      end('threat')
    }
  }
}
