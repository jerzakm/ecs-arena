import type { CanonicalState } from '@ecs-arena/spec'
import { byGameId, type Context } from './context.ts'

export const snapshot = (ctx: Context): CanonicalState => {
  const { world, shrines, units, projectiles, groundItems, unitById } = ctx
  const s: number[] = [
    world.tick, world.alive[0], world.alive[1], world.kills[0], world.kills[1], world.damage[0], world.damage[1], world.winner,
    world.score[0], world.score[1], shrines.length,
  ]
  for (let sh_i = 0, sh = shrines[0]; sh_i < shrines.length; sh = shrines[++sh_i]) s.push(sh.gameId, sh.owner, sh.progress)
  s.push(units.length)
  for (let u_i = 0, u = units[0]; u_i < units.length; u = units[++u_i]) {
    s.push(u.gameId, u.team, u.kind, u.x, u.y, u.hp, u.maxHp, u.attack, u.armor, u.speed, u.cooldown, u.target, u.memberOf, u.childOf)
    const active = [0, 1, 2].filter((b) => u.buffs[b] > 0)
    s.push(active.length)
    for (let b_i = 0, b = active[0]; b_i < active.length; b = active[++b_i]) s.push(b, u.buffs[b])
    s.push(u.items.length)
    for (let it_i = 0, it = u.items[0]; it_i < u.items.length; it = u.items[++it_i]) s.push(it.gameId, it.kind, it.quality)
    s.push((u.fleeing ? 1 : 0) | (u.veteran ? 2 : 0) | (u.routed ? 4 : 0) | (u.overwhelmed ? 8 : 0), u.killCount, unitById.has(u.lastHitBy) ? u.lastHitBy : -1)
    s.push(u.morale ? u.morale.size0 : -1, u.morale ? u.morale.lost : -1)
    s.push(u.threat.length)
    for (let e_i = 0, e = u.threat[0]; e_i < u.threat.length; e = u.threat[++e_i]) s.push(e.attacker, e.amount)
    s.push(u.chronicle.length, ...u.chronicle)
  }
  s.push(projectiles.length)
  for (let p_i = 0, p = projectiles[0]; p_i < projectiles.length; p = projectiles[++p_i]) s.push(p.gameId, p.owner, p.target, p.x, p.y, p.age, p.speed, p.volley ? 1 : 0)
  s.push(groundItems.length)
  for (const g of [...groundItems].sort(byGameId)) s.push(g.gameId, g.kind, g.quality, g.x, g.y, g.age)
  return s
}
