// SPEC §10 save and load. The save is a plain data tree: relations are gameIds, so nothing in it points into the live world.
// Normal code keeps that tree as the save. The naive code (regions `save` and `load`) round trips it through JSON text.
import type { Ctx } from './context.ts'
import { rebuildMembers } from './hierarchy.ts'
import type { GroundItem, Projectile, Unit } from './types.ts'
import { pushTo } from '../shared/util.ts'

type SavedUnit = Omit<Unit, 'garrison'> & { garrison: number }
interface Saved {
  tick: number; nextId: number; world: Ctx['world']
  shrines: { gameId: number; y: number; owner: number; progress: number; garrison: number[] }[]
  units: SavedUnit[]; projectiles: Projectile[]; groundItems: GroundItem[]
}

const copyUnit = (u: Unit | SavedUnit): SavedUnit => ({
  ...u, garrison: typeof u.garrison === 'number' ? u.garrison : (u.garrison?.gameId ?? -1),
  tref: undefined, pref: undefined, items: u.items.map((i) => ({ ...i })), buffs: [...u.buffs], threat: u.threat.map((e) => ({ ...e })),
  morale: u.morale && { ...u.morale }, chronicle: [...u.chronicle], trail: [...u.trail],
})

const copyWorld = (w: Ctx['world']): Ctx['world'] => ({ ...w, alive: [...w.alive], kills: [...w.kills], damage: [...w.damage], score: [...w.score], orders: [...w.orders] })

export const save = (ctx: Ctx): unknown => {
  ctx.begin('save')
  const data: Saved = {
    tick: ctx.tick, nextId: ctx.nextId, world: copyWorld(ctx.world),
    shrines: ctx.shrines.map((s) => ({ gameId: s.gameId, y: s.y, owner: s.owner, progress: s.progress, garrison: s.garrison.map((u) => u.gameId) })),
    units: ctx.units.map(copyUnit), projectiles: ctx.projectiles.map((p) => ({ ...p })), groundItems: ctx.groundItems.map((g) => ({ ...g })),
  }
  const state = ctx.isNaive('save') ? JSON.stringify(data) : data
  ctx.end('save')
  ctx.add('save.count'); ctx.add('save.units', data.units.length)
  return state
}

/** Replaces the live state in place (the systems keep references to the sets and the world object) and re-sends every unit to the kernel grid. */
export const load = (ctx: Ctx, state: unknown): void => {
  ctx.begin('load')
  // The form of the save decides, so a naive save loads in either mode. The naive load only adds the parse when the save is text.
  const d = (typeof state === 'string' ? JSON.parse(state) : ctx.isNaive('load') ? JSON.parse(JSON.stringify(state)) : state) as Saved
  const inGrid = (u: Unit) => !u.garrison || ctx.isNaive('garrison')
  for (let i = 0; i < ctx.units.length; i++) if (inGrid(ctx.units[i])) ctx.grid.remove(ctx.units[i].h)

  Object.assign(ctx.world, copyWorld(d.world))
  ctx.tick = d.tick; ctx.nextId = d.nextId
  const shrineById = new Map(d.shrines.map((s) => [s.gameId, { gameId: s.gameId, y: s.y, owner: s.owner, progress: s.progress, garrison: [] as Unit[] }]))
  ctx.shrines.length = 0
  for (const s of shrineById.values()) ctx.shrines.push(s)

  const { unitById, targeters, minionsOf, buffed, threatened, overwhelmed, dirty, members, veterans } = ctx
  for (const c of [unitById, targeters, minionsOf, buffed, threatened, overwhelmed, dirty, members, veterans]) c.clear()
  ctx.slots.length = 0; ctx.freeSlots.length = 0
  ctx.prevFleeing = new Set()
  const units: Unit[] = []
  for (let i = 0; i < d.units.length; i++) {
    const u = { ...copyUnit(d.units[i]), h: i, garrison: null } as Unit
    units.push(u)
    unitById.set(u.gameId, u)
    ctx.slots[i] = u
    if (u.target !== -1) { const s = targeters.get(u.target); if (s) s.add(u); else targeters.set(u.target, new Set([u])) }
    if (u.childOf !== -1) pushTo(minionsOf, u.childOf, u)
    if (u.buffs[0] > 0 || u.buffs[1] > 0 || u.buffs[2] > 0) buffed.add(u)
    if (u.threat.length > 0) threatened.add(u)
    if (u.overwhelmed) overwhelmed.add(u)
    if (u.veteran) veterans.add(u)
    if (u.fleeing) ctx.prevFleeing.add(u)
  }
  for (const s of d.shrines) {
    const shrine = shrineById.get(s.gameId)!
    for (const g of s.garrison) { const u = unitById.get(g)!; u.garrison = shrine; shrine.garrison.push(u) }
  }
  for (let i = 0; i < units.length; i++) {
    const u = units[i]
    if (u.target !== -1) u.tref = unitById.get(u.target)
    u.pref = unitById.get(u.memberOf !== -1 ? u.memberOf : u.childOf)
  }
  ctx.units = units
  if (!ctx.isNaive('links')) rebuildMembers(ctx)
  for (let i = 0; i < units.length; i++) if (inGrid(units[i])) ctx.grid.add(units[i].h, units[i].gameId, units[i].x, units[i].y)
  ctx.projectiles = d.projectiles.map((p) => ({ ...p }))
  ctx.groundItems = d.groundItems.map((g) => ({ ...g }))
  ctx.end('load')
  ctx.add('load.count')
}
