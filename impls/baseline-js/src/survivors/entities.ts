// Creating and destroying mobs, projectiles, pickups and particles, and the grid search around them.
// A destroyed entity is marked dead and leaves its list at the next `compact` (SPEC-survivors §5).
// The naive `churn` region rebuilds the list at once.
import type { Ctx, CtxData } from './context.ts'
import { ENT, type Ent, type Mob, type Particle, type Pickup, type Proj } from './types.ts'
import { byGameId, pushTo } from '../shared/util.ts'

export const makeMob = (ctx: Ctx, kind: number, x: number, y: number, flags = 0): Mob => {
  const { k, slots, freeSlots } = ctx
  const h = freeSlots.length ? freeSlots.pop()! : slots.length
  const m: Mob = {
    t: ENT.MOB, gameId: ctx.totals.nextId++, kind, x, y, vx: 0, vy: 0, hp: k.mobMaxHp(kind, flags), shield: 0, flags, affix: 0, aux: 0,
    summoner: -1, timed: [],
    dmgIn: 0, healIn: 0, clearIn: 0, h, prevHp: 0, spd: 0, moved: false, dead: false,
  }
  m.prevHp = m.hp
  ctx.tags.addTag(m, k.STATUS.SPAWNING, ctx.tick + k.DUR.SPAWNING)
  ctx.lists[ENT.MOB].push(m)
  ctx.mobById.set(m.gameId, m)
  slots[h] = m
  ctx.kindCount[kind]++
  ctx.grid.add(h, m.gameId, x, y)
  return m
}

export const makeProj = (ctx: Ctx, f: Omit<Proj, 't' | 'gameId' | 'dead'>): Proj => {
  const p: Proj = { t: ENT.PROJ, gameId: ctx.totals.nextId++, ...f, dead: false }
  ctx.lists[ENT.PROJ].push(p)
  if (p.weapon === -1) ctx.hostile++
  ctx.churn.setWheel(p)
  return p
}

export const makePickup = (ctx: Ctx, kind: number, x: number, y: number, value: number): Pickup => {
  const ttl = ctx.tick + ctx.k.PICKUP_LIFE
  const p: Pickup = { t: ENT.PICKUP, gameId: ctx.totals.nextId++, kind, x, y, value, ttl, attracted: 0, dead: false }
  ctx.lists[ENT.PICKUP].push(p)
  ctx.churn.setWheel(p)
  return p
}

export const makePart = (ctx: Ctx, kind: number, x: number, y: number, vx: number, vy: number, ttl: number): Particle => {
  const p: Particle = { t: ENT.PART, gameId: ctx.totals.nextId++, kind, x, y, vx, vy, ttl, dead: false }
  ctx.lists[ENT.PART].push(p)
  ctx.churn.setWheel(p)
  return p
}

/** The mobs within `r` of a point, in gameId order unless `sorted` is false. */
export const near = (ctx: Ctx, x: number, y: number, r: number, sorted = true): Mob[] => {
  const out: Mob[] = []
  ctx.grid.forNear(x, y, r, (h) => out.push(ctx.slots[h]))
  return sorted ? out.sort(byGameId) : out
}

export interface Churn {
  destroy(e: Mob | Ent): void
  /** Takes the dead out of the lists that `destroy` marked. A system calls it when it is done with its loops. */
  compact(): void
  /** Lists a projectile, pickup or particle under the tick on which its ttl runs out. */
  setWheel(e: Ent): void
  /** Lists every entity with a ttl again. `load` calls it after it rebuilt the entities. */
  reschedule(): void
}

const alive = (e: { dead: boolean }) => !e.dead

export const createChurn = (ctx: CtxData): Churn => {
  const { k, nv, begin, end } = ctx
  // The same four lists, seen as lists of anything with a `dead` flag, so one loop can rebuild any of them.
  const lists: { dead: boolean }[][] = ctx.lists

  const release = (e: Mob | Ent) => {
    e.dead = true
    if (e.t === ENT.MOB) {
      ctx.grid.remove(e.h)
      ctx.freeSlots.push(e.h)
      ctx.mobById.delete(e.gameId)
      ctx.kindCount[e.kind]--
      if (ctx.kids.get(e.gameId)?.length) ctx.gone.push(e.gameId)
      const sibs = ctx.kids.get(e.summoner)
      if (sibs) { sibs.splice(sibs.indexOf(e), 1); if (sibs.length === 0) ctx.kids.delete(e.summoner) }
    } else if (e.t === ENT.PROJ && e.weapon === -1) ctx.hostile--
  }

  const destroyLater = (e: Mob | Ent) => {
    release(e)
    ctx.dirty |= 1 << e.t
  }
  // The naive code rebuilds the list after each destroy. The loops that run now keep the old list and skip the dead.
  const destroyNow = (e: Mob | Ent) => {
    release(e)
    begin('churn')
    lists[e.t] = lists[e.t].filter(alive)
    end('churn')
  }

  const compactDirty = () => {
    if (!ctx.dirty) return
    begin('churn')
    for (let t = 0; t < lists.length; t++) if (ctx.dirty & (1 << t)) lists[t] = lists[t].filter(alive)
    ctx.dirty = 0
    end('churn')
  }
  // destroyNow leaves nothing dirty.
  const compactNothing = () => {}

  const scheduleTtl = (e: Ent) => {
    if (e.ttl !== k.INF_TTL) pushTo(ctx.ttlWheel, e.ttl, e)
  }
  const scheduleNothing = () => {}

  const rebuildWheel = () => {
    ctx.ttlWheel.clear()
    const withTtl: Ent[][] = [ctx.lists[ENT.PROJ], ctx.lists[ENT.PICKUP], ctx.lists[ENT.PART]]
    for (const list of withTtl) for (const e of list) scheduleTtl(e)
  }
  const clearWheel = () => ctx.ttlWheel.clear()

  return {
    destroy: nv.churn ? destroyNow : destroyLater,
    compact: nv.churn ? compactNothing : compactDirty,
    setWheel: nv.churn ? scheduleNothing : scheduleTtl,
    reschedule: nv.churn ? clearWheel : rebuildWheel,
  }
}

/**
 * The function a system calls before a grid search. The normal code keeps the grid in step as mobs move (`grid.update`),
 * so it needs no call. The naive code sends every mob to the grid again.
 */
export const createResendGrid = (ctx: CtxData): (() => void) => {
  if (!ctx.nv['grid.update']) return () => {}
  return () => {
    ctx.begin('grid.update')
    const mobs = ctx.lists[ENT.MOB]
    for (let i = 0; i < mobs.length; i++) ctx.grid.update(mobs[i].h, mobs[i].x, mobs[i].y)
    ctx.end('grid.update')
  }
}
