import { survivors, type CanonicalState } from '@ecs-arena/spec'
import type { Ctx } from './context.ts'
/** SPEC-survivors §8. A link to an entity that does not exist is -1. */
export const snapshot = (ctx: Ctx): CanonicalState => {
  const { totals, player, held, mobById } = ctx
  const [mobs, projs, pickups, parts] = ctx.lists
  const live = (id: number) => (id === 1 || mobById.has(id) ? id : -1)
  const s: number[] = [
    ...survivors.kernel.worldHeader(totals),
    player.x, player.y, player.hp, player.iframes ? 1 << ctx.k.STATUS.IFRAMES : 0, player.iframes, held.length,
  ]
  for (let i = 0; i < held.length; i++) s.push(held[i].id, held[i].level, held[i].cd)
  s.push(mobs.length)
  for (let i = 0; i < mobs.length; i++) {
    const m = mobs[i]
    s.push(m.gameId, m.kind, m.x, m.y, m.vx, m.vy, m.hp, m.shield, m.flags, m.affix, m.aux, m.timed.length)
    for (let j = 0; j < m.timed.length; j++) s.push(m.timed[j].id, m.timed[j].until, m.timed[j].stacks)
    s.push(m.summoner === -1 ? -1 : live(m.summoner))
  }
  s.push(projs.length)
  for (let i = 0; i < projs.length; i++) {
    const p = projs[i]
    s.push(p.gameId, p.weapon, p.owner === -1 ? -1 : live(p.owner), p.traits, p.x, p.y, p.vx, p.vy, p.ttl)
    s.push(p.pierceLeft, p.bounceLeft, p.hitMask, p.target === -1 ? -1 : live(p.target))
  }
  s.push(pickups.length)
  for (let i = 0; i < pickups.length; i++) {
    const p = pickups[i]
    s.push(p.gameId, p.kind, p.x, p.y, p.value, p.ttl, p.attracted)
  }
  s.push(parts.length)
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i]
    s.push(p.gameId, p.kind, p.x, p.y, p.vx, p.vy, p.ttl)
  }
  return s
}
