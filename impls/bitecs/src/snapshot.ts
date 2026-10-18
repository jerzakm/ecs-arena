import { hasComponent, type World } from 'bitecs'
import type { CanonicalState } from '@ecs-arena/spec'
import { type Context } from './context.ts'
import {
  Age, Bannered, Burn, Chronicle, Cooldown, Fleeing, Garrisoned, Ground, Haste, Health, ItemKind, KillCount, Kind, Morale, Overwhelmed, Position, Projectile,
  Routed, Shrine, Stats, Stun, Team, Trail, Unit, Veteran,
} from './components.ts'
import { ChildOf, Equips, GarrisonOf, LastHitBy, MemberOf, Targets, Threat } from './relations.ts'

/** SPEC §8 flags: Fleeing, Veteran, Routed, Overwhelmed, Bannered and Garrisoned, in bits 0 to 5. */
export const flagsOf = (world: World, e: number): number =>
  (hasComponent(world, e, Fleeing) ? 1 : 0) | (hasComponent(world, e, Veteran) ? 2 : 0) | (hasComponent(world, e, Routed) ? 4 : 0)
  | (hasComponent(world, e, Overwhelmed) ? 8 : 0) | (hasComponent(world, e, Bannered) ? 16 : 0) | (hasComponent(world, e, Garrisoned) ? 32 : 0)

export const snapshot = (ctx: Context): CanonicalState => {
  const { world, gid, sortedByGameId } = ctx
  const { BUFF } = ctx.k
  const { metrics: m, score } = world
  const gidOf = (e: number) => (e === -1 ? -1 : gid(e))
  const s: number[] = [world.clock, m.alive0, m.alive1, m.kills0, m.kills1, m.damage0, m.damage1, m.winner, score.shrines0, score.shrines1, m.orders0, m.orders1, m.renderChain]

  const shrines = sortedByGameId(Shrine)
  s.push(shrines.length)
  for (const e of shrines) {
    const held = (GarrisonOf.from![e] ?? []).map(gid).sort((a, b) => a - b)
    s.push(gid(e), Shrine.owner[e], Shrine.progress[e], held.length, ...held)
  }

  const units = sortedByGameId(Unit)
  s.push(units.length)
  for (const e of units) {
    s.push(
      gid(e), Team.value[e], Kind.value[e], Position.x[e], Position.y[e], Health.hp[e], Health.maxHp[e], Stats.attack[e], Stats.armor[e], Stats.speed[e], Cooldown.value[e],
      gidOf(Targets.to[e]), gidOf(MemberOf.to[e]), gidOf(ChildOf.to[e])
    )
    const buffs: [number, number][] = []
    if (hasComponent(world, e, Stun)) buffs.push([BUFF.STUN, Stun.ticksLeft[e]])
    if (hasComponent(world, e, Burn)) buffs.push([BUFF.BURN, Burn.ticksLeft[e]])
    if (hasComponent(world, e, Haste)) buffs.push([BUFF.HASTE, Haste.ticksLeft[e]])
    s.push(buffs.length)
    for (const [b, t] of buffs) s.push(b, t)
    const held = (Equips.items[e] ?? []).map((it, i) => ({ it, id: gid(it), quality: Equips.quality[e][i] })).sort((a, b) => a.id - b.id)
    s.push(held.length)
    for (const { it, id, quality } of held) s.push(id, ItemKind.value[it], quality)
    s.push(flagsOf(world, e), KillCount.value[e], gidOf(LastHitBy.to[e]))
    const morale = hasComponent(world, e, Morale)
    s.push(morale ? Morale.size0[e] : -1, morale ? Morale.lost[e] : -1)
    const edges = (Threat.attackers[e] ?? []).map((a, i) => ({ id: gid(a), amount: Threat.amount[e][i] })).sort((a, b) => a.id - b.id)
    s.push(edges.length)
    for (const edge of edges) s.push(edge.id, edge.amount)
    if (hasComponent(world, e, Chronicle)) {
      s.push(Chronicle.n[e])
      for (let i = 0; i < Chronicle.n[e]; i++) s.push(Chronicle.kinds[e][i])
    } else s.push(0)
    const pts = Trail.pts[e]
    s.push(Trail.n[e])
    for (let i = 0; i < 2 * Trail.n[e]; i++) s.push(pts[i])
  }

  const projectiles = sortedByGameId(Projectile)
  s.push(projectiles.length)
  for (const e of projectiles) {
    s.push(gid(e), Projectile.owner[e], gidOf(Targets.to[e]), Position.x[e], Position.y[e], Age.value[e], Projectile.speed[e], Projectile.volley[e])
  }

  const ground = sortedByGameId(Ground)
  s.push(ground.length)
  for (const e of ground) s.push(gid(e), ItemKind.value[e], Ground.quality[e], Position.x[e], Position.y[e], Age.value[e])
  return s
}
