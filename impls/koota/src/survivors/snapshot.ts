import type { Entity, Relation } from 'koota'
import { survivors, type CanonicalState } from '@ecs-arena/spec'
import { heldList } from './loadout.ts'
import { affixOf, flagsOf, traitsOf } from './tags.ts'
import {
  Aux, FiredBy, GameId, Hp, Iframes, Kind, Mob, Particle, Pickup, Position, Projectile, Shield, SummonedBy, TIMED, Targets, Totals, Ttl,
  Velocity,
} from './traits.ts'
import { sortedByGameId } from '../shared/util.ts'
import type { Ctx } from './context.ts'

/** The gameId that a relation of `e` points to, or -1 when the pair is gone because the target was destroyed. */
const link = (e: Entity, relation: Relation): number => {
  const t = e.targetFor(relation)
  return t ? t.get(GameId)!.id : -1
}

/** SPEC-survivors §8. A link to an entity that does not exist is -1: koota drops the pair when the target is destroyed. */
export const snapshot = (ctx: Ctx): CanonicalState => {
  const { k, world, player } = ctx
  const pp = player.get(Position)!
  const held = heldList(ctx)
  const iframes = player.get(Iframes)?.until ?? 0
  const s: number[] = [
    ...survivors.kernel.worldHeader(world.get(Totals)!),
    pp.x, pp.y, player.get(Hp)!.hp, iframes ? 1 << k.STATUS.IFRAMES : 0, iframes, held.length,
  ]
  for (const h of held) s.push(h.id, h.level, h.cd)

  const mobs = sortedByGameId(world, GameId, Mob)
  s.push(mobs.length)
  for (const { gameId, e } of mobs) {
    const p = e.get(Position)!, v = e.get(Velocity)!
    s.push(gameId, e.get(Kind)!.value, p.x, p.y, v.x, v.y, e.get(Hp)!.hp, e.get(Shield)!.value, flagsOf(e), affixOf(e), e.get(Aux)!.value)
    const timed: number[] = []
    for (let t = 0; t < TIMED.length; t++) {
      const d = e.get(TIMED[t])
      if (d) timed.push(t, d.until, 'stacks' in d ? d.stacks : 0)
    }
    s.push(timed.length / 3, ...timed, link(e, SummonedBy))
  }

  const projectiles = sortedByGameId(world, GameId, Projectile)
  s.push(projectiles.length)
  for (const { gameId, e } of projectiles) {
    const pr = e.get(Projectile)!, p = e.get(Position)!, v = e.get(Velocity)!
    s.push(
      gameId, pr.weapon, link(e, FiredBy), traitsOf(e), p.x, p.y, v.x, v.y, e.get(Ttl)!.value, pr.pierceLeft, pr.bounceLeft, pr.hitMask,
      link(e, Targets),
    )
  }

  const pickups = sortedByGameId(world, GameId, Pickup)
  s.push(pickups.length)
  for (const { gameId, e } of pickups) {
    const pk = e.get(Pickup)!, p = e.get(Position)!
    s.push(gameId, pk.kind, p.x, p.y, pk.value, e.get(Ttl)!.value, pk.attracted)
  }

  const parts = sortedByGameId(world, GameId, Particle)
  s.push(parts.length)
  for (const { gameId, e } of parts) {
    const pt = e.get(Particle)!, p = e.get(Position)!, v = e.get(Velocity)!
    s.push(gameId, pt.kind, p.x, p.y, v.x, v.y, e.get(Ttl)!.value)
  }
  return s
}
