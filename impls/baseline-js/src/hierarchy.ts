import type { Context } from './context.ts'
import type { Unit } from './types.ts'

// The inverse of MemberOf. The normal code keeps it in step with every change of `memberOf`. The naive code (region `links`) keeps nothing and scans.
export const addMember = (ctx: Context, parent: number, u: Unit) => {
  if (ctx.isNaive('links')) return
  ctx.begin('links')
  const list = ctx.members.get(parent)
  if (list) list.push(u)
  else ctx.members.set(parent, [u])
  ctx.end('links')
}

/** Takes `u` out of the list of its parent. Call it before `u.memberOf` changes or `u` is destroyed. */
export const dropMember = (ctx: Context, u: Unit) => {
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

export const rebuildMembers = (ctx: Context) => {
  ctx.members.clear()
  for (const u of ctx.units) if (u.memberOf !== -1) {
    const list = ctx.members.get(u.memberOf)
    if (list) list.push(u)
    else ctx.members.set(u.memberOf, [u])
  }
}
