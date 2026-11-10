// Links between entities. iris stores a link as a `u32` field that holds a gameId (components.ts), so a read goes through `entityOf`.
import { type EntityId, getComponentValue, getRelationTargets, hasComponent, setComponentValue, type World } from 'iris-ecs'
import { GameId } from '../shared/components.ts'
import { ChildOf, type LastHitBy, type Link, type Targets, Unit } from './components.ts'
import type { Ctx } from './context.ts'

/** The entity a link names. A link to a destroyed entity reads as no link, as a relation pair would. */
export const targetOf = (ctx: Ctx, e: EntityId, link: Link): EntityId | undefined => {
  if (!hasComponent(ctx.world, e, link)) return undefined
  const gameId = getComponentValue(ctx.world, e, link, 'to')!
  return gameId === 0 ? undefined : ctx.entityOf.get(gameId)
}

/**
 * Sets or clears a link that every unit carries. The field stores the gameId, which iris never reuses (an entity id repeats after 256
 * reuses of its slot).
 */
export const setLink = (ctx: Ctx, e: EntityId, link: typeof Targets | typeof LastHitBy, to: EntityId | undefined): void =>
  setComponentValue(ctx.world, e, link, 'to', to === undefined ? 0 : getComponentValue(ctx.world, to, GameId, 'id')!)

/** The summoner of a minion: the one target of its `ChildOf` pair. */
export const summonerOf = (world: World, e: EntityId): EntityId | undefined => getRelationTargets(world, e, ChildOf)[0]

/** The unit that a commander order names by gameId (SPEC 6.12). A destroyed unit leaves the map. */
export const unitByKey = (ctx: Ctx, key: number): EntityId | undefined => {
  const e = ctx.entityOf.get(key)
  return e !== undefined && hasComponent(ctx.world, e, Unit) ? e : undefined
}
