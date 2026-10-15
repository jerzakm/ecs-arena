import type { Entity } from 'koota'
import type { CanonicalState } from '@ecs-arena/spec'
import { byGameId, type Context } from './context.ts'
import {
  Age, Bannered, Burn, Chronicle, Trail, Cooldown, Fleeing, Garrisoned, Ground, Haste, Health, ItemKind, KillCount, Kind, Metrics, Morale, Overwhelmed, Position, Projectile,
  Routed, Score, Shrine, Stats, Stun, Team, Unit, Veteran,
} from './components.ts'
import { ChildOf, Equips, GarrisonOf, LastHitBy, MemberOf, Targets, Threat } from './relations.ts'

/** SPEC §8 flags: Fleeing, Veteran, Routed, Overwhelmed, Bannered and Garrisoned, in bits 0 to 5. */
export const flagsOf = (e: Entity): number =>
  (e.has(Fleeing) ? 1 : 0) | (e.has(Veteran) ? 2 : 0) | (e.has(Routed) ? 4 : 0) | (e.has(Overwhelmed) ? 8 : 0) | (e.has(Bannered) ? 16 : 0) | (e.has(Garrisoned) ? 32 : 0)

export const snapshot = (ctx: Context): CanonicalState => {
  const { world, gid, sortedByGameId } = ctx
  const { BUFF } = ctx.k
  const m = world.get(Metrics)!, score = world.get(Score)!
  const s: number[] = [ctx.tickNow(), m.alive0, m.alive1, m.kills0, m.kills1, m.damage0, m.damage1, m.winner, score.shrines0, score.shrines1, m.orders0, m.orders1, m.renderChain]

  const shrines = sortedByGameId(Shrine)
  s.push(shrines.length)
  for (const { id, e } of shrines) {
    const sh = e.get(Shrine)!
    const held = world.query(GarrisonOf(e)).map(gid).sort((a, b) => a - b)
    s.push(id, sh.owner, sh.progress, held.length, ...held)
  }

  const units = sortedByGameId(Unit)
  s.push(units.length)
  for (const { id, e } of units) {
    const p = e.get(Position)!, h = e.get(Health)!, st = e.get(Stats)!
    const target = e.targetFor(Targets), leader = e.targetFor(MemberOf), parent = e.targetFor(ChildOf)
    s.push(
      id, e.get(Team)!.value, e.get(Kind)!.value, p.x, p.y, h.hp, h.maxHp, st.attack, st.armor, st.speed, e.get(Cooldown)!.value,
      target ? gid(target) : -1, leader ? gid(leader) : -1, parent ? gid(parent) : -1
    )
    const buffs: [number, number][] = []
    if (e.has(Stun)) buffs.push([BUFF.STUN, e.get(Stun)!.ticksLeft])
    if (e.has(Burn)) buffs.push([BUFF.BURN, e.get(Burn)!.ticksLeft])
    if (e.has(Haste)) buffs.push([BUFF.HASTE, e.get(Haste)!.ticksLeft])
    s.push(buffs.length)
    for (const [b, t] of buffs) s.push(b, t)
    const items = e.targetsFor(Equips).map((item) => ({ id: gid(item), e: item })).sort(byGameId)
    s.push(items.length)
    for (const it of items) s.push(it.id, it.e.get(ItemKind)!.value, e.get(Equips(it.e))!.quality)
    const hitBy = e.targetFor(LastHitBy)
    s.push(flagsOf(e), e.get(KillCount)!.value, hitBy ? gid(hitBy) : -1)
    const morale = e.get(Morale)
    s.push(morale ? morale.size0 : -1, morale ? morale.lost : -1)
    const edges = e.targetsFor(Threat).map((a) => ({ id: gid(a), amount: e.get(Threat(a))!.amount })).sort(byGameId)
    s.push(edges.length)
    for (const edge of edges) s.push(edge.id, edge.amount)
    const chronicle = e.get(Chronicle)?.kinds ?? []
    s.push(chronicle.length, ...chronicle)
    const trail = e.get(Trail)?.pts ?? []
    s.push(trail.length >> 1, ...trail)
  }

  const projectiles = sortedByGameId(Projectile)
  s.push(projectiles.length)
  for (const { id, e } of projectiles) {
    const p = e.get(Position)!, pr = e.get(Projectile)!, t = e.targetFor(Targets)
    s.push(id, pr.owner, t ? gid(t) : -1, p.x, p.y, e.get(Age)!.value, pr.speed, pr.volley)
  }

  const ground = sortedByGameId(Ground)
  s.push(ground.length)
  for (const { id, e } of ground) {
    const p = e.get(Position)!
    s.push(id, e.get(ItemKind)!.value, e.get(Ground)!.quality, p.x, p.y, e.get(Age)!.value)
  }
  return s
}
