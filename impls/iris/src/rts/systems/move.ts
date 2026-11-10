import {
  collectEntities, defineSystem, type EntityId, type EXPERIMENTAL_ColumnsTuple, EXPERIMENTAL_queryColumns as queryColumns,
  getComponentValue, hasComponent, setComponentValue,
} from 'iris-ecs'
import { Fleeing, MemberOf, Position, Projectile, Start, Targets } from '../components.ts'
import type { Ctx } from '../context.ts'
import { summonerOf, targetOf } from '../links.ts'
import { moversLoose, moversMember, moversMinion, projectiles, starts } from '../queries.ts'

/** The columns of a mover group. Only the `MemberOf` group has the last one. */
type Cols = readonly [...EXPERIMENTAL_ColumnsTuple<typeof moversLoose>, EXPERIMENTAL_ColumnsTuple<typeof moversMember>[6]?]

/** The `Sim.moveStart` step: iris has no double-buffered stores, so `Start` copies `Position` before `move`. */
export const moveStartSystem = (ctx: Ctx) => {
  const { world } = ctx
  return defineSystem('move.start', () => {
    queryColumns(world, starts, (entities, [pos, start]) => {
      for (let i = 0; i < entities.length; i++) {
        start.x[i] = pos.x[i]
        start.y[i] = pos.y[i]
      }
    })
  })
}

export const moveSystem = (ctx: Ctx) => {
  const { k, world } = ctx
  const { KIND, UNIT_STATS, stepToward } = k

  return defineSystem('move', () => {
    // Depth is memoized for the phase, since siblings share their parent chain.
    const depth = new Map<EntityId, number>()
    const depthOf = (e: EntityId): number => {
      let d = depth.get(e)
      if (d === undefined) {
        const p = targetOf(ctx, e, MemberOf) ?? summonerOf(world, e)
        depth.set(e, d = p !== undefined ? depthOf(p) + 1 : 0)
      }
      return d
    }
    // One column pass reads every mover into the parallel arrays and buckets its index by depth. A unit's own position does not change
    // before its turn. The new positions go back in a second column pass, in the same order, so a mover that reads a mover parent reads
    // it from `xs` and `ys`.
    const ents: EntityId[] = [], kinds: number[] = [], teams: number[] = [], speeds: number[] = [], xs: number[] = [], ys: number[] = []
    const fleeing: boolean[] = [], trails: number[][] = [], targets: number[] = [], leaders: number[] = []
    const offX: number[] = [], offY: number[] = []
    const slot = new Map<EntityId, number>()
    const levels: number[][] = []
    const take = (entities: EntityId[], [kind, team, stats, pos, trail, target, member]: Cols, depthAt: (i: number) => number) => {
      const flee = hasComponent(world, entities[0], Fleeing) // a tag: the archetype shares it
      for (let i = 0; i < entities.length; i++) {
        const e = entities[i]
        ;(levels[depthAt(i)] ??= []).push(ents.length)
        slot.set(e, ents.length)
        ents.push(e); kinds.push(kind.value[i]); teams.push(team.value[i]); speeds.push(stats.speed[i])
        xs.push(pos.x[i]); ys.push(pos.y[i])
        fleeing.push(flee); trails.push(trail.pts[i]); targets.push(target.to[i])
        leaders.push(member?.to[i] ?? 0); offX.push(member?.offsetX[i] ?? 0); offY.push(member?.offsetY[i] ?? 0)
      }
    }
    // The parent is a `MemberOf` leader, else a summoner, else none: three archetype groups, so only a member or a minion needs a parent
    // lookup.
    const parentDepth = (p: EntityId | undefined) => p === undefined ? 0 : depthOf(p) + 1
    queryColumns(world, moversMember, (entities, cols) => {
      const member = cols[6]
      take(entities, cols, (i) => {
        const e = entities[i]
        const d = parentDepth(ctx.entityOf.get(member.to[i]) ?? summonerOf(world, e))
        depth.set(e, d)
        return d
      })
    })
    queryColumns(world, moversMinion, (entities, cols) => take(entities, cols, (i) => {
      const e = entities[i]
      const d = parentDepth(summonerOf(world, e))
      depth.set(e, d)
      return d
    }))
    queryColumns(world, moversLoose, (entities, cols) => take(entities, cols, () => 0))
    const px = (e: EntityId) => { const n = slot.get(e); return n === undefined ? getComponentValue(world, e, Position, 'x')! : xs[n] }
    const py = (e: EntityId) => { const n = slot.get(e); return n === undefined ? getComponentValue(world, e, Position, 'y')! : ys[n] }

    // Hierarchy order: a parent moves before its children, and children read the new parent position.
    for (const level of levels) {
      if (!level) continue
      for (const n of level) {
        const e = ents[n], kind = kinds[n], team = teams[n], speed = speeds[n], ox = xs[n], oy = ys[n]
        let tx: number, ty: number
        if (fleeing[n]) { tx = k.homeX(team); ty = oy }
        else {
          const target = ctx.entityOf.get(targets[n])
          const tsx = target === undefined ? 0 : getComponentValue(world, target, Start, 'x')!
          const tsy = target === undefined ? 0 : getComponentValue(world, target, Start, 'y')!
          if (target !== undefined && k.inRange(ox, oy, tsx, tsy, UNIT_STATS[kind].range)) continue
          const parent = ctx.entityOf.get(leaders[n])
          if (parent !== undefined) {
            tx = px(parent) + offX[n]
            ty = py(parent) + offY[n]
          } else if (target !== undefined) { tx = tsx; ty = tsy }
          else if (kind === KIND.MINION) { const sp = summonerOf(world, e)!; tx = px(sp); ty = py(sp) }
          else { tx = team === 0 ? k.MAX_COORD : 0; ty = oy }
        }
        const [x, y] = stepToward(ox, oy, tx, ty, speed)
        xs[n] = x
        ys[n] = y
        if (x !== ox || y !== oy) {
          const pts = trails[n]
          pts.push(x, y)
          if (pts.length > 2 * k.TRAIL_POINTS) pts.splice(0, 2)
        }
        ctx.units.grid.update(ctx.units.handleOf.get(e)!, x, y)
      }
    }
    // No structural change may sit between the read pass and this write pass: the write-back is by position, in query order.
    let at = 0
    const put = (entities: EntityId[], [, , , pos]: Cols) => {
      for (let i = 0; i < entities.length; i++, at++) {
        pos.x[i] = xs[at]
        pos.y[i] = ys[at]
      }
    }
    queryColumns(world, moversMember, put)
    queryColumns(world, moversMinion, put)
    queryColumns(world, moversLoose, put)

    for (const e of collectEntities(world, projectiles)) {
      const t = targetOf(ctx, e, Targets)
      if (t === undefined) continue
      const [x, y] = stepToward(
        getComponentValue(world, e, Position, 'x'), getComponentValue(world, e, Position, 'y'),
        getComponentValue(world, t, Position, 'x')!, getComponentValue(world, t, Position, 'y')!,
        getComponentValue(world, e, Projectile, 'speed'),
      )
      setComponentValue(world, e, Position, 'x', x)
      setComponentValue(world, e, Position, 'y', y)
    }
  })
}
