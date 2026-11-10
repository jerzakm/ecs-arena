// Helpers that both games use: the fixed orders of SPEC §5.6, bit masks over tag lists, and upsert.
import type { Entity, QueryParameter, Trait, World } from 'koota'

export type Data = Record<string, unknown>

/** The order of every list that a system builds or iterates in a fixed order (SPEC §5.6). */
export const byGameId = (a: { gameId: number }, b: { gameId: number }) => a.gameId - b.gameId

/** Nearest first, then by gameId. */
export const byNearest = (a: { d2: number; gameId: number }, b: { d2: number; gameId: number }) => a.d2 - b.d2 || a.gameId - b.gameId

export interface Row { gameId: number; e: Entity }

/** The entities that have `gameId` and every trait of `params`, in gameId order. A query result has no order. */
export const sortedByGameId = (world: World, gameId: Trait<{ id: number }>, ...params: QueryParameter[]): Row[] => {
  const out: Row[] = []
  world.query(gameId, ...params).readEach(([g], e) => void out.push({ gameId: g.id, e }))
  return out.sort(byGameId)
}

/** Appends `value` to the list at `key` and creates the list when the key is new. */
export const pushTo = <K, V>(map: Map<K, V[]>, key: K, value: V): void => {
  const list = map.get(key)
  if (list) list.push(value)
  else map.set(key, [value])
}

/** Bit i is set when the entity has `tags[i]`. */
export const maskOf = (e: Entity, tags: readonly Trait[]): number => {
  let mask = 0
  for (let i = 0; i < tags.length; i++) if (e.has(tags[i])) mask |= 1 << i
  return mask
}

/** True when the entity has any of the tags. */
export const hasAny = (e: Entity, tags: readonly Trait[]): boolean => {
  for (let i = 0; i < tags.length; i++) if (e.has(tags[i])) return true
  return false
}

/** The tags of the set bits of `mask`. */
export const tagsOf = <T extends Trait>(tags: readonly T[], mask: number): T[] => {
  const out: T[] = []
  for (let i = 0; i < tags.length; i++) if (mask & (1 << i)) out.push(tags[i])
  return out
}

/** Adds the tags whose bit is set and removes the others, touching only the tags that change. */
export const syncTags = (e: Entity, tags: readonly Trait[], mask: number): void => {
  for (let i = 0; i < tags.length; i++) {
    const want = (mask & (1 << i)) !== 0
    if (want === e.has(tags[i])) continue
    if (want) e.add(tags[i])
    else e.remove(tags[i])
  }
}

/** Sets the trait when the entity has it and adds it otherwise. */
export const upsert = <T extends Trait>(e: Entity, t: T, value: Parameters<T>[0]): void => {
  if (e.has(t)) e.set(t, value)
  else e.add(t(value))
}

/** A trait value as plain data. Arrays are copied, so a save shares nothing with the world. */
export const copy = (v: object): Data => {
  const out: Data = { ...v }
  for (const key in out) {
    const x = out[key]
    if (Array.isArray(x)) out[key] = [...x]
  }
  return out
}

/** The value of a trait or relation pair of `e` as plain data, or null for a tag. */
export const dataOf = (e: Entity, t: Parameters<Entity['get']>[0]): Data | null => {
  const v = e.get(t)
  return v ? copy(v) : null
}
