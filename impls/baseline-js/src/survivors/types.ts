/** Which of the four entity lists an entity lives in. `Ctx.lists` is indexed by it. */
export const ENT = { MOB: 0, PROJ: 1, PICKUP: 2, PART: 3 } as const
/** A timed tag of a mob. `stacks` is 0 except for BURNING. The list is in ascending tag id. */
export interface Timed { id: number; until: number; stacks: number }
export interface Mob {
  t: typeof ENT.MOB
  gameId: number; kind: number; x: number; y: number; vx: number; vy: number
  hp: number; shield: number; flags: number; affix: number; aux: number; summoner: number
  timed: Timed[]
  // scratch, 0 at every tick boundary unless noted
  dmgIn: number; healIn: number; clearIn: number
  h: number // grid handle
  prevHp: number // hp before the last resolve.damage, or hp at the end of the last resolve.changed in naive mode
  spd: number // mobSpeed, computed in ai.chase for the whole ai phase
  moved: boolean // moved since the last grid.update
  dead: boolean
}
export interface Proj {
  t: typeof ENT.PROJ
  gameId: number; weapon: number; owner: number; traits: number
  x: number; y: number; vx: number; vy: number
  ttl: number; pierceLeft: number; bounceLeft: number; hitMask: number; target: number
  dead: boolean
}
export interface Pickup {
  t: typeof ENT.PICKUP
  gameId: number; kind: number; x: number; y: number; value: number; ttl: number; attracted: number
  dead: boolean
}
export interface Particle {
  t: typeof ENT.PART
  gameId: number; kind: number; x: number; y: number; vx: number; vy: number; ttl: number
  dead: boolean
}
/** An entity with a ttl: the members of the ttl wheel. */
export type Ent = Proj | Pickup | Particle
/** The four entity lists, each in ascending gameId order, indexed by `ENT`. */
export type EntityLists = [mobs: Mob[], projs: Proj[], pickups: Pickup[], parts: Particle[]]
export interface Player { x: number; y: number; hp: number; iframes: number }
/** A hit that waits for `applyHits`: the mob, the stat block damage, the source of the crit draw and the traits of the HIT event. */
export interface Pending { m: Mob; dmg: number; source: number; traits: number }
