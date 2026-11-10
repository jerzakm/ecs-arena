import type { Entity } from 'koota'
import type { Ctx } from '../context.ts'
import { Burn, Clock, Dead, Haste, Health, Stun, Threat } from '../traits.ts'

export const effectsSystem = (ctx: Ctx) => {
  const { k, world } = ctx
  const { fx } = k

  return () => {
    const expired: [Entity, typeof Stun | typeof Haste][] = []
    const dying: Entity[] = []
    world.query(Stun).updateEach(([b], e) => { if (--b.ticksLeft === 0) expired.push([e, Stun]) })
    world.query(Haste).updateEach(([b], e) => { if (--b.ticksLeft === 0) expired.push([e, Haste]) })
    const burnedOut: Entity[] = []
    world.query(Burn, Health).updateEach(([b, h], e) => {
      b.ticksLeft--
      if (b.ticksLeft % k.BURN_INTERVAL === 0) {
        h.hp -= k.BURN_DAMAGE
        if (h.hp <= 0) dying.push(e)
      }
      if (b.ticksLeft === 0) burnedOut.push(e)
    })
    for (const [e, buff] of expired) e.remove(buff)
    for (const e of burnedOut) e.remove(Burn)
    for (const e of dying) if (!e.has(Dead)) e.add(Dead)

    if (world.get(Clock)!.tick % k.THREAT_DECAY_PERIOD === 0) {
      const gone: [Entity, Entity][] = []
      for (const victim of world.query(Threat('*'))) {
        for (const attacker of victim.targetsFor(Threat)) {
          const amount = victim.get(Threat(attacker))!.amount
          const left = amount - Math.max(1, fx.div(amount, 4))
          if (left <= 0) gone.push([victim, attacker])
          else victim.set(Threat(attacker), { amount: left })
        }
      }
      for (const [victim, attacker] of gone) victim.remove(Threat(attacker))
    }
  }
}
