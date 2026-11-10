import { defineComponent, defineRelation, pair, Type, Wildcard } from 'iris-ecs'

const i32 = () => Type.i32()

/** Machine state. `kind` and `district` never change. `progress` is in permille ticks. */
export const Machine = defineComponent('FxMachine', {
  schema: { kind: i32(), district: i32(), input: i32(), output: i32(), progress: i32() },
})
export const Place = defineComponent('FxPlace', { schema: { x: i32(), y: i32() } })
/** Only some machines have it. A machine without it reads as 0. */
export const Boost = defineComponent('FxBoost', { schema: { value: i32() } })
export const Working = defineComponent('FxWorking')
export const Powered = defineComponent('FxPowered')
export const Manual = defineComponent('FxManual')

/** source and sink are machine gameIds, top is a crate gameId or -1. A link to a machine is a field because T would be the machine count. */
export const Drone = defineComponent('FxDrone', {
  schema: { born: i32(), goal: i32(), cargo: i32(), item: i32(), source: i32(), sink: i32(), top: i32() },
})
export const Velocity = defineComponent('FxVelocity', { schema: { x: i32(), y: i32() } })
export const Accel = defineComponent('FxAccel', { schema: { x: i32(), y: i32() } })
/** The world transform of a drone or a crate. */
export const Transform = defineComponent('FxTransform', { schema: { x: i32(), y: i32(), c: i32(), s: i32() } })
/** `depth` is 1 for a crate on the drone, 2 on that crate, and so on. */
export const Crate = defineComponent('FxCrate', { schema: { item: i32(), depth: i32() } })

/** A crate holds the pair with its parent, a drone or the crate below. Destroying a drone destroys its crates. */
export const Parent = defineRelation('FxParent', { exclusive: true, onDeleteTarget: 'delete' })
export const AnyParent = pair(Parent, Wildcard)

/** Resource: the `Totals` of the spec. */
export const Totals = defineComponent('FxTotals', {
  schema: { tick: i32(), nextId: i32(), score: i32(), picked: i32(), delivered: i32(), lost: i32() },
})
