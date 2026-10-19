// SPEC §10 save and load. bitECS 0.4 has a snapshot serializer, but it cannot carry this state. It writes native ids, it has no support for
// the links or for the per-entity arrays, and it allocates a 100 MB buffer for each call. So the save is emulated: a query over `GameId` lists the
// entities, one query for each component finds its entities, the SoA stores give the values, and the link and array stores give the relations.
// Relations in the save name a gameId, never a native id. The restore empties the world with `resetWorld` and spawns every entity again.
import { addComponent, hasComponent, query, resetWorld } from 'bitecs'
import type { Context } from './context.ts'
import { observeWorld, type Resources } from './context.ts'
import { COMPONENTS, GameId, Position, Team, Unit, Garrisoned } from './components.ts'
import { addThreat, Equips, LINKS, MemberOf, offsetX, offsetY, resetStores, setLink, Threat } from './relations.ts'
import { equip, newEntity } from './spawning.ts'

type Value = number | number[]
type Store = Record<string, unknown>
const NAMES = Object.keys(COMPONENTS) as (keyof typeof COMPONENTS)[]

/** The values of one component for one entity. A field is a typed array indexed by entity, or an array of one typed array for each entity. */
const FIELDS = NAMES.map((n) => Object.entries(COMPONENTS[n] as Store) as [string, { [i: number]: unknown }][])
const readFields = (fields: [string, { [i: number]: unknown }][], e: number): Record<string, Value> => {
  const out: Record<string, Value> = {}
  for (const [key, field] of fields) {
    const v = field[e] ?? 0
    out[key] = typeof v === 'number' ? v : Array.from(v as ArrayLike<number>)
  }
  return out
}
const writeFields = (store: Store, e: number, values: Record<string, Value>) => {
  for (const [key, v] of Object.entries(values)) {
    const field = store[key] as { [i: number]: unknown }
    if (typeof v === 'number') field[e] = v
    else { const a = (field[e] ??= new Int32Array(v.length)) as Int32Array; a.set(v) }
  }
}

interface SavedEntity {
  gameId: number
  components: [name: keyof typeof COMPONENTS, values: Record<string, Value>][]
  /** Exclusive links by index in LINKS, with the data of the pair. */
  links: [index: number, targetGameId: number, data: Record<string, number>][]
  equips: [itemGameId: number, quality: number][]
  threats: [attackerGameId: number, amount: number][]
}
export interface Saved { world: Resources; entities: SavedEntity[] }

export const save = (ctx: Context): Saved => {
  const { world, gid } = ctx
  const entities: SavedEntity[] = []
  // One query for each component finds its entities, so no entity is probed with `hasComponent` for every component.
  const components: SavedEntity['components'][] = []
  NAMES.forEach((n, i) => { for (const e of query(world, [COMPONENTS[n]])) (components[e] ??= []).push([n, readFields(FIELDS[i], e)]) })
  for (const e of query(world, [GameId])) {
    const links: SavedEntity['links'] = []
    LINKS.forEach((l, i) => {
      const t = l.to[e]
      if (t === -1) return
      links.push([i, gid(t), l === MemberOf ? { offsetX: offsetX[e], offsetY: offsetY[e] } : {}])
    })
    entities.push({
      gameId: gid(e),
      components: components[e],
      links,
      equips: (Equips.items[e] ?? []).map((it, j) => [gid(it), Equips.quality[e][j]] as [number, number]),
      threats: (Threat.attackers[e] ?? []).map((a, j) => [gid(a), Threat.amount[e][j]] as [number, number]),
    })
  }
  entities.sort((a, b) => a.gameId - b.gameId)
  return { world: structuredClone({ clock: world.clock, nextId: world.nextId, score: world.score, metrics: world.metrics }), entities }
}

/**
 * Empties the same world with `resetWorld`, which also drops the queries and their observers, so `observeWorld` runs again. Every entity
 * is spawned again in gameId order and the relations are linked by a gameId map. The new observers have seen only the respawn, and the
 * lists they filled are emptied, so no event of the discarded ticks reaches the next tick.
 */
export const load = (ctx: Context, saved: Saved): void => {
  const { world } = ctx
  for (const e of ctx.unitById.values()) if (ctx.inGrid[e]) ctx.grid.remove(e)
  ctx.unitById.clear()
  ctx.inGrid.fill(0)
  ctx.destroyed.clear()
  resetStores()
  resetWorld(world)
  observeWorld(ctx)
  Object.assign(world, structuredClone(saved.world))

  const byId = new Map<number, number>()
  for (const s of saved.entities) {
    const e = newEntity(ctx)
    byId.set(s.gameId, e)
    for (const [name, values] of s.components) { addComponent(world, e, COMPONENTS[name]); writeFields(COMPONENTS[name] as Store, e, values) }
  }
  for (const s of saved.entities) {
    const e = byId.get(s.gameId)!
    for (const [i, target, data] of s.links) {
      const t = byId.get(target)!
      setLink(e, LINKS[i], t)
      if (LINKS[i] === MemberOf) { offsetX[e] = data.offsetX; offsetY[e] = data.offsetY }
    }
    for (const [item, quality] of s.equips) {
      const it = byId.get(item)!
      equip(ctx, e, it, quality)
    }
    for (const [attacker, amount] of s.threats) {
      const a = byId.get(attacker)!
      addThreat(e, a, amount)
    }
  }

  // The kernel grid and the gameId lookup hold every unit that is not garrisoned (SPEC 3.2).
  for (const e of query(world, [Unit, GameId, Team, Position])) {
    ctx.unitById.set(GameId.id[e], e)
    if (!hasComponent(world, e, Garrisoned)) { ctx.grid.add(e, GameId.id[e], Position.x[e], Position.y[e]); ctx.inGrid[e] = 1 }
  }

  ctx.dirty.clear(); ctx.killsChanged.clear()
  ctx.newlyRouted.length = ctx.newlyFleeing.length = ctx.newlyVeteran.length = 0
}
