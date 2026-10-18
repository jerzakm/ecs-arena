import { defineRelation, pair, Wildcard } from 'iris-ecs'

// A relation pair is one component id for each distinct target, so a pair makes up to B x T archetypes: B is the number of archetypes
// of the entities that hold it and T the number of distinct targets. Keep T small.
/** The minion holds the pair, so `onDeleteTarget: 'delete'` destroys it with the summoner. T is the number of summoners, which is few. */
export const ChildOf = defineRelation('ChildOf', { exclusive: true, onDeleteTarget: 'delete' })

/** The unit sits in the garrison of the shrine. T is 7 shrines and only garrisoned units hold a pair, so it adds few archetypes. */
export const GarrisonOf = defineRelation('GarrisonOf', { exclusive: true, onDeleteTarget: 'remove' })
/** Matches a unit in any garrison. */
export const AnyGarrison = pair(GarrisonOf, Wildcard)
/** Matches a minion of any summoner. */
export const AnyChild = pair(ChildOf, Wildcard)
