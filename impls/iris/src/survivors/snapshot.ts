import {
  EXPERIMENTAL_queryColumns as queryColumns, getComponent, getComponentValue, getRelationTargets, getResource, hasComponent,
} from 'iris-ecs'
import { type CanonicalState, survivors } from '@ecs-arena/spec'
import { GameId } from '../shared/components.ts'
import { Attracted, Aux, Burning, ChildOf, IFrames, PlayerHp, Position, Run, STATUS_TAGS, Summoned, TIMED } from './components.ts'
import type { Ctx } from './context.ts'
import { heldList } from './loadout.ts'
import { snapMobs, snapParts, snapPickups, snapProjs } from './queries.ts'
import { traitsOf } from './tags.ts'

const { STATUS } = survivors.kernel

/** One entity of the snapshot: its gameId and the ints that go out. */
interface Rec { id: number; v: number[] }

/** SPEC-survivors §8. A link to an entity that does not exist is -1. */
export const snapshot = (ctx: Ctx): CanonicalState => {
  const { world, player } = ctx
  const live = (id: number) => (id === -1 || ctx.entityOf.has(id) ? id : -1)
  const held = heldList(ctx)
  const pos = getComponent(world, player, Position)!
  const iframes = hasComponent(world, player, IFrames) ? getComponentValue(world, player, IFrames, 'until') : 0
  const s: number[] = [
    ...survivors.kernel.worldHeader(getResource(world, Run)!),
    pos.x, pos.y, getComponentValue(world, player, PlayerHp, 'hp')!,
    hasComponent(world, player, IFrames) ? 1 << STATUS.IFRAMES : 0, iframes, held.length,
  ]
  for (const h of held) s.push(h.id, h.level, h.cd)

  const flush = (recs: Rec[]) => {
    s.push(recs.length)
    recs.sort((a, b) => a.id - b.id)
    for (const r of recs) for (const v of r.v) s.push(v)
  }
  const mobs: Rec[] = []
  queryColumns(world, snapMobs, (entities, [id, kind, p, vel, hp, affix]) => {
    const e0 = entities[0]
    // The tags are the same for the whole archetype, so one read gives the flags and the timed statuses of every mob in it.
    const present: number[] = []
    let flags = 0
    for (let sid = 0; sid < STATUS_TAGS.length; sid++) {
      if (!hasComponent(world, e0, STATUS_TAGS[sid])) continue
      flags |= 1 << sid
      if (sid < TIMED.length) present.push(sid)
    }
    const hasAux = hasComponent(world, e0, Aux), summoned = hasComponent(world, e0, Summoned)
    for (let i = 0; i < entities.length; i++) {
      const e = entities[i]
      const v = [
        id.id[i], kind.value[i], p.x[i], p.y[i], vel.x[i], vel.y[i], hp.hp[i], hp.shield[i], flags, affix.bits[i],
        hasAux ? getComponentValue(world, e, Aux, 'value')! : 0, present.length,
      ]
      for (const sid of present) {
        const stacks = sid === STATUS.BURNING ? getComponentValue(world, e, Burning, 'stacks')! : 0
        v.push(sid, getComponentValue(world, e, TIMED[sid], 'until')!, stacks)
      }
      const parent = summoned ? getRelationTargets(world, e, ChildOf)[0] : undefined
      v.push(parent === undefined ? -1 : getComponentValue(world, parent, GameId, 'id')!)
      mobs.push({ id: id.id[i], v })
    }
  })
  flush(mobs)

  const projs: Rec[] = []
  queryColumns(world, snapProjs, (entities, [proj, id, p, vel, ttl]) => {
    const traits = traitsOf(world, entities[0])
    for (let i = 0; i < entities.length; i++) {
      projs.push({
        id: id.id[i],
        v: [
          id.id[i], proj.weapon[i], live(proj.owner[i]), traits, p.x[i], p.y[i], vel.x[i], vel.y[i], ttl.at[i], proj.pierceLeft[i],
          proj.bounceLeft[i], proj.hitMask[i], live(proj.target[i]),
        ],
      })
    }
  })
  flush(projs)

  const pickups: Rec[] = []
  queryColumns(world, snapPickups, (entities, [pickup, id, p, ttl]) => {
    const attracted = hasComponent(world, entities[0], Attracted) ? 1 : 0
    for (let i = 0; i < entities.length; i++) {
      pickups.push({ id: id.id[i], v: [id.id[i], pickup.kind[i], p.x[i], p.y[i], pickup.value[i], ttl.at[i], attracted] })
    }
  })
  flush(pickups)

  const parts: Rec[] = []
  queryColumns(world, snapParts, (entities, [part, id, p, vel, ttl]) => {
    for (let i = 0; i < entities.length; i++) {
      parts.push({ id: id.id[i], v: [id.id[i], part.kind[i], p.x[i], p.y[i], vel.x[i], vel.y[i], ttl.at[i]] })
    }
  })
  flush(parts)
  return s
}
