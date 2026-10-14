import { BUFF_NAME, type Context } from '../context.ts'

export const effectsSystem = (ctx: Context) => {
  const { k, add, dirty } = ctx
  const { fx, BUFF } = k

  return () => {
    const { units, tick } = ctx
    for (let u_i = 0, u = units[0]; u_i < units.length; u = units[++u_i]) {
      if (ctx.counters && (u.buffs[0] > 0 || u.buffs[1] > 0 || u.buffs[2] > 0)) add('q.effects.buffed')
      for (let b = 0; b < 3; b++) {
        if (u.buffs[b] === 0) continue
        u.buffs[b]--
        if (u.buffs[b] === 0) { add(`buff.remove.${BUFF_NAME[b]}`); dirty?.add(u.gameId) }
        if (b === BUFF.BURN && u.buffs[b] % k.BURN_INTERVAL === 0) u.hp -= k.BURN_DAMAGE
      }
      if (u.hp <= 0) u.dead = true
    }
    if (tick % k.THREAT_DECAY_PERIOD === 0) {
      for (let u_i = 0, u = units[0]; u_i < units.length; u = units[++u_i]) {
        if (u.threat.length === 0) continue
        for (let e_i = 0, e = u.threat[0]; e_i < u.threat.length; e = u.threat[++e_i]) e.amount -= Math.max(1, fx.div(e.amount, 4))
        add('rel.Threat.decay', u.threat.length)
        const kept = u.threat.filter((e) => e.amount > 0)
        add('rel.Threat.decayRemove', u.threat.length - kept.length)
        u.threat = kept
      }
    }
  }
}
