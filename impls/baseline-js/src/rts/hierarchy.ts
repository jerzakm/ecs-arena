import type { Ctx } from './context.ts'
import type { Unit } from './types.ts'
import { pushTo } from '../shared/util.ts'

// The inverse of MemberOf. The normal code keeps it in step with every change of `memberOf`.
// The naive code (region `links`) keeps nothing and scans.
export const addMember = (ctx: Ctx, parent: number, u: Unit) => {
  if (ctx.isNaive('links')) return
  ctx.begin('links')
  pushTo(ctx.members, parent, u)
  ctx.end('links')
}

/** Takes `u` out of the list of its parent. Call it before `u.memberOf` changes or `u` is destroyed. */
export const dropMember = (ctx: Ctx, u: Unit) => {
  if (u.memberOf === -1 || ctx.isNaive('links')) return
  ctx.begin('links')
  const list = ctx.members.get(u.memberOf)
  if (list) {
    const i = list.indexOf(u)
    if (i !== -1) list.splice(i, 1)
    if (list.length === 0) ctx.members.delete(u.memberOf)
  }
  ctx.end('links')
}

export const rebuildMembers = (ctx: Ctx) => {
  ctx.members.clear()
  for (const u of ctx.units) if (u.memberOf !== -1) {
    pushTo(ctx.members, u.memberOf, u)
  }
}

/** The parent found through the gameId map, not through `u.pref`. Only the naive code and the profile counters use it. */
export const parentById = (ctx: Ctx, u: Unit): Unit | undefined => ctx.unitById.get(u.memberOf !== -1 ? u.memberOf : u.childOf)
