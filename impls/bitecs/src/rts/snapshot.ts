import { hasComponent, type World } from 'bitecs'
import type { CanonicalState } from '@ecs-arena/spec'
import type { Ctx } from './context.ts'
import {
  Age, Burn, Chronicle, Cooldown, FLAG_TAGS, Ground, Haste, Health, ItemKind, KillCount, Kind, Morale, Position, Projectile, Shrine,
  Stats, Stun, Team, Trail,
} from './components.ts'
import { GameId } from '../shared/components.ts'
import { Q } from './queries.ts'
import { ChildOf, Equips, GarrisonOf, LastHitBy, MemberOf, Targets, Threat } from './relations.ts'
import { byGameId, sortedByGameId } from '../shared/util.ts'

/** SPEC §8 flags: Fleeing, Veteran, Routed, Overwhelmed, Bannered and Garrisoned, in bits 0 to 5. */
export const flagsOf = (world: World, e: number): number => {
  let mask = 0
  for (let bit = 0; bit < FLAG_TAGS.length; bit++) if (hasComponent(world, e, FLAG_TAGS[bit])) mask |= 1 << bit
  return mask
}

const byItem = (a: { it: number }, b: { it: number }) => byGameId(a.it, b.it)
const byAttacker = (a: { attacker: number }, b: { attacker: number }) => byGameId(a.attacker, b.attacker)

export const snapshot = (ctx: Ctx): CanonicalState => {
  const { world } = ctx
  const { BUFF } = ctx.k
  const { metrics: m, score } = world
  const gidOf = (e: number) => (e === -1 ? -1 : GameId.id[e])
  const s: number[] = [
    world.tick, m.alive0, m.alive1, m.kills0, m.kills1, m.damage0, m.damage1, m.winner, score.shrines0, score.shrines1, m.orders0,
    m.orders1, m.renderChain,
  ]

  const shrines = sortedByGameId(ctx, Q.shrines)
  s.push(shrines.length)
  for (const e of shrines) {
    const held = (GarrisonOf.from[e] ?? []).slice().sort(byGameId).map(gidOf)
    s.push(GameId.id[e], Shrine.owner[e], Shrine.progress[e], held.length, ...held)
  }

  const units = sortedByGameId(ctx, Q.units)
  s.push(units.length)
  for (const e of units) {
    s.push(
      GameId.id[e], Team.value[e], Kind.value[e], Position.x[e], Position.y[e], Health.hp[e], Health.maxHp[e],
      Stats.attack[e], Stats.armor[e], Stats.speed[e], Cooldown.value[e],
      gidOf(Targets.to[e]), gidOf(MemberOf.to[e]), gidOf(ChildOf.to[e])
    )
    const buffs: [number, number][] = []
    if (hasComponent(world, e, Stun)) buffs.push([BUFF.STUN, Stun.ticksLeft[e]])
    if (hasComponent(world, e, Burn)) buffs.push([BUFF.BURN, Burn.ticksLeft[e]])
    if (hasComponent(world, e, Haste)) buffs.push([BUFF.HASTE, Haste.ticksLeft[e]])
    s.push(buffs.length)
    for (const [b, t] of buffs) s.push(b, t)
    const held = (Equips.items[e] ?? []).map((it, i) => ({ it, quality: Equips.quality[e][i] })).sort(byItem)
    s.push(held.length)
    for (const { it, quality } of held) s.push(GameId.id[it], ItemKind.value[it], quality)
    s.push(flagsOf(world, e), KillCount.value[e], gidOf(LastHitBy.to[e]))
    const morale = hasComponent(world, e, Morale)
    s.push(morale ? Morale.size0[e] : -1, morale ? Morale.lost[e] : -1)
    const edges = (Threat.attackers[e] ?? []).map((attacker, i) => ({ attacker, amount: Threat.amount[e][i] })).sort(byAttacker)
    s.push(edges.length)
    for (const edge of edges) s.push(GameId.id[edge.attacker], edge.amount)
    if (hasComponent(world, e, Chronicle)) {
      s.push(Chronicle.n[e])
      for (let i = 0; i < Chronicle.n[e]; i++) s.push(Chronicle.kinds[e][i])
    } else s.push(0)
    const pts = Trail.pts[e]
    s.push(Trail.n[e])
    for (let i = 0; i < 2 * Trail.n[e]; i++) s.push(pts[i])
  }

  const projectiles = sortedByGameId(ctx, Q.allProjectiles)
  s.push(projectiles.length)
  for (const e of projectiles) {
    s.push(
      GameId.id[e], Projectile.owner[e], gidOf(Targets.to[e]), Position.x[e], Position.y[e], Age.value[e], Projectile.speed[e],
      Projectile.volley[e],
    )
  }

  const ground = sortedByGameId(ctx, Q.ground)
  s.push(ground.length)
  for (const e of ground) s.push(GameId.id[e], ItemKind.value[e], Ground.quality[e], Position.x[e], Position.y[e], Age.value[e])
  return s
}
