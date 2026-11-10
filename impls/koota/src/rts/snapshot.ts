import type { Entity, Relation } from 'koota'
import type { CanonicalState } from '@ecs-arena/spec'
import type { Ctx } from './context.ts'
import {
  Age, Burn, ChildOf, Chronicle, Clock, Cooldown, Equips, FLAG_TAGS, GameId, GarrisonOf, Ground, Haste, Health, ItemKind, KillCount, Kind,
  LastHitBy, MemberOf, Metrics, Morale, Position, Projectile, Score, Shrine, Stats, Stun, Targets, Team, Threat, Trail, Unit,
} from './traits.ts'
import { byGameId, maskOf, sortedByGameId } from '../shared/util.ts'

/** The gameId of the target of a relation, or -1 when the entity has none. */
const link = (e: Entity, relation: Relation): number => {
  const target = e.targetFor(relation)
  return target ? target.get(GameId)!.id : -1
}

const gameIdOf = (e: Entity) => e.get(GameId)!.id
const rowOf = (e: Entity) => ({ gameId: gameIdOf(e), e })

export const snapshot = (ctx: Ctx): CanonicalState => {
  const { world } = ctx
  const { BUFF } = ctx.k
  const m = world.get(Metrics)!, score = world.get(Score)!
  const s: number[] = [
    world.get(Clock)!.tick, m.alive0, m.alive1, m.kills0, m.kills1, m.damage0, m.damage1, m.winner, score.shrines0, score.shrines1,
    m.orders0, m.orders1, m.renderChain,
  ]

  const shrines = sortedByGameId(world, GameId, Shrine)
  s.push(shrines.length)
  for (const { gameId, e } of shrines) {
    const sh = e.get(Shrine)!
    const held = world.query(GarrisonOf(e)).map(rowOf).sort(byGameId)
    s.push(gameId, sh.owner, sh.progress, held.length, ...held.map((g) => g.gameId))
  }

  const units = sortedByGameId(world, GameId, Unit)
  s.push(units.length)
  for (const { gameId, e } of units) {
    const p = e.get(Position)!, h = e.get(Health)!, st = e.get(Stats)!
    s.push(
      gameId, e.get(Team)!.value, e.get(Kind)!.value, p.x, p.y, h.hp, h.maxHp, st.attack, st.armor, st.speed, e.get(Cooldown)!.value,
      link(e, Targets), link(e, MemberOf), link(e, ChildOf),
    )
    const buffs: [number, number][] = []
    if (e.has(Stun)) buffs.push([BUFF.STUN, e.get(Stun)!.ticksLeft])
    if (e.has(Burn)) buffs.push([BUFF.BURN, e.get(Burn)!.ticksLeft])
    if (e.has(Haste)) buffs.push([BUFF.HASTE, e.get(Haste)!.ticksLeft])
    s.push(buffs.length)
    for (const [b, t] of buffs) s.push(b, t)
    const items = e.targetsFor(Equips).map(rowOf).sort(byGameId)
    s.push(items.length)
    for (const it of items) s.push(it.gameId, it.e.get(ItemKind)!.value, e.get(Equips(it.e))!.quality)
    s.push(maskOf(e, FLAG_TAGS), e.get(KillCount)!.value, link(e, LastHitBy))
    const morale = e.get(Morale)
    s.push(morale ? morale.size0 : -1, morale ? morale.lost : -1)
    const edges = e.targetsFor(Threat).map((a) => ({ gameId: gameIdOf(a), amount: e.get(Threat(a))!.amount })).sort(byGameId)
    s.push(edges.length)
    for (const edge of edges) s.push(edge.gameId, edge.amount)
    const chronicle = e.get(Chronicle)?.kinds ?? []
    s.push(chronicle.length, ...chronicle)
    const trail = e.get(Trail)?.pts ?? []
    s.push(trail.length >> 1, ...trail)
  }

  const projectiles = sortedByGameId(world, GameId, Projectile)
  s.push(projectiles.length)
  for (const { gameId, e } of projectiles) {
    const p = e.get(Position)!, pr = e.get(Projectile)!
    s.push(gameId, pr.owner, link(e, Targets), p.x, p.y, e.get(Age)!.value, pr.speed, pr.volley)
  }

  const ground = sortedByGameId(world, GameId, Ground)
  s.push(ground.length)
  for (const { gameId, e } of ground) {
    const p = e.get(Position)!
    s.push(gameId, e.get(ItemKind)!.value, e.get(Ground)!.quality, p.x, p.y, e.get(Age)!.value)
  }
  return s
}
