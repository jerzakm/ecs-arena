// SPEC-survivors §10. The save is a plain data tree. Links are gameIds, so nothing in it points into the live world.
// Normal code keeps that tree as the save. The naive code (regions `save` and `load`) round trips it through JSON text.
import type { survivors } from '@ecs-arena/spec'
import type { Ctx } from './context.ts'
import { refreshLoadout } from './loadout.ts'
import { ENT, type Mob, type Particle, type Pickup, type Proj } from './types.ts'
import { pushTo } from '../shared/util.ts'

interface Saved {
  tick: number; totals: survivors.kernel.Totals; player: Ctx['player']; held: Ctx['held']
  mobs: Mob[]; projs: Proj[]; pickups: Pickup[]; parts: Particle[]
}
const copyMob = (m: Mob): Mob => ({ ...m, timed: m.timed.map((t) => ({ ...t })) })
const readTree = (ctx: Ctx): Saved => {
  const [mobs, projs, pickups, parts] = ctx.lists
  return {
    tick: ctx.tick, totals: { ...ctx.totals, evt: [...ctx.totals.evt] }, player: { ...ctx.player }, held: ctx.held.map((h) => ({ ...h })),
    mobs: mobs.map(copyMob), projs: projs.map((p) => ({ ...p })),
    pickups: pickups.map((p) => ({ ...p })), parts: parts.map((p) => ({ ...p })),
  }
}

/** Replaces the live state in place and sends every mob to the grid again. Nothing of the discarded ticks stays. */
const writeTree = (ctx: Ctx, d: Saved) => {
  for (const m of ctx.lists[ENT.MOB]) ctx.grid.remove(m.h)
  ctx.tick = d.tick
  Object.assign(ctx.totals, d.totals, { evt: [...d.totals.evt] })
  Object.assign(ctx.player, d.player)
  ctx.held = d.held.map((h) => ({ ...h }))
  ctx.slots.length = 0; ctx.freeSlots.length = 0
  ctx.mobById.clear(); ctx.kids.clear(); ctx.gone.length = 0
  ctx.kindCount.fill(0); ctx.hostile = 0
  const mobs = d.mobs.map((s, i) => {
    const m = { ...copyMob(s), h: i, prevHp: s.hp, moved: false, dmgIn: 0, healIn: 0, clearIn: 0 }
    ctx.slots[i] = m
    ctx.mobById.set(m.gameId, m)
    ctx.kindCount[m.kind]++
    ctx.grid.add(i, m.gameId, m.x, m.y)
    return m
  })
  for (const m of mobs) if (m.summoner !== -1) pushTo(ctx.kids, m.summoner, m)
  const projs = d.projs.map((p) => ({ ...p }))
  for (const p of projs) if (p.weapon === -1) ctx.hostile++
  // The factories of ctx.churn hold ctx.lists, so the lists are replaced one by one.
  ctx.lists[ENT.MOB] = mobs
  ctx.lists[ENT.PROJ] = projs
  ctx.lists[ENT.PICKUP] = d.pickups.map((p) => ({ ...p }))
  ctx.lists[ENT.PART] = d.parts.map((p) => ({ ...p }))
  for (const l of ctx.ev) l.length = 0
  ctx.evAll.length = 0; ctx.changed.length = 0; ctx.pending.length = 0; ctx.evolved.length = 0
  ctx.picked = false
  refreshLoadout(ctx, false)
  ctx.tags.reschedule()
  ctx.churn.reschedule()
  ctx.dirty = 0
}

/** Builds `save`. The naive region `save` turns the tree into JSON text, and the normal code keeps the tree. */
export const createSave = (ctx: Ctx) => {
  const encode = ctx.nv.save ? (data: Saved): unknown => JSON.stringify(data) : (data: Saved): unknown => data
  return (): unknown => {
    ctx.begin('save')
    const state = encode(readTree(ctx))
    ctx.end('save')
    ctx.add('save.count')
    return state
  }
}

export const createLoad = (ctx: Ctx) => {
  // The form of the save decides, so a naive save loads in either mode. The naive load only adds the parse when the save is text.
  const reparse = ctx.nv.load ? (state: unknown) => JSON.parse(JSON.stringify(state)) : (state: unknown) => state
  return (state: unknown): void => {
    ctx.begin('load')
    writeTree(ctx, (typeof state === 'string' ? JSON.parse(state) : reparse(state)) as Saved)
    ctx.end('load')
    ctx.add('load.count')
  }
}
