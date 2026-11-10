import {
  addResource, defineComponent, getComponent, getResource, Type,
  type Component, type EntityId, type InferSchemaRecord, type SchemaRecord, type World,
} from 'iris-ecs'

/** The identity that both games use. A gameId is never reused, unlike an iris entity id, which repeats after 256 reuses of its slot. */
export const GameId = defineComponent('GameId', { schema: { id: Type.i32() } })

// The helpers below are for save and load. iris 0.0.14 types each read and write by the schema of one component, and a save walks a
// list that mixes every component and resource, so the schema is not known at the call. Each helper holds the cast that this needs.

export type Data = Record<string, unknown>

/** Plain data from a component value: `null` for a tag. Arrays are copied, so a save shares nothing with the world. */
export const copy = (v: Data | undefined): Data | null => {
  if (!v) return null
  const out: Data = { ...v }
  for (const key in out) {
    const x = out[key]
    if (Array.isArray(x)) out[key] = [...x]
  }
  return out
}

/** The fields of a component or tag of `e` as plain data. */
export const dataOf = (world: World, e: EntityId, c: EntityId): Data | null =>
  copy(getComponent(world, e, c as Component) as Data | undefined)

/** The fields of a resource as plain data. */
export const resourceData = (world: World, r: Component): Data => copy(getResource(world, r) as Data)!

/** Adds the resource `r` with saved data. */
export const restoreResource = (world: World, r: Component, data: Data): void =>
  addResource(world, r, copy(data) as InferSchemaRecord<SchemaRecord>)
