import { relation } from 'koota'

export const Targets = relation({ exclusive: true })
export const ChildOf = relation({ autoDestroy: 'orphan' })
export const MemberOf = relation({ exclusive: true, store: { offsetX: 0, offsetY: 0 } })
export const Equips = relation({ autoDestroy: 'target', store: { quality: 1 } })
export const Threat = relation({ store: { amount: 0 } })
export const GarrisonOf = relation({ exclusive: true })
export const LastHitBy = relation({ exclusive: true })
export const FiredBy = relation({ exclusive: true })
