// Facet liveness: a rule whose activation counter stays 0 never changes the hash, so an implementation could skip it.
// The counters come from baseline-js (the profile hook). Each row is [rule, counter, late]. A late rule needs more ticks than the smoke scenarios run, so only the full profile checks it.
export const LIVENESS: readonly (readonly [string, string, boolean?])[] = [
  ['A set bonus applied', 'rule.setBonus'],
  ['C overwhelmed hits', 'rule.overwhelmed'],
  ['D bannered units', 'rule.banner'],
  ['E garrison entries', 'rule.garrison'],
  ['F orders taken effect', 'q.ai.ordered'],
  ['F dead-key orders', 'q.ai.orderDeadKey'],
  ['G renderChain updates', 'rule.renderChain'],
  ['H save calls', 'save.count'],
  ['H load calls', 'load.count'],
  ['v2 veteran promotions', 'tag.add.veteran', true],
  ['v2 rout', 'tag.add.routed', true],
  ['v2 flee', 'tag.add.fleeing', true],
  ['v2 leave', 'leave', true],
  ['v2 promote', 'promote'],
  ['v2 burn', 'buff.add.burn'],
  ['v2 haste', 'buff.add.haste'],
  ['v2 stun', 'buff.add.stun'],
  ['v2 splash', 'query.splash'],
  ['v2 threat retaliate', 'q.ai.retaliate'],
  ['v2 threat evict', 'rel.Threat.evict'],
  ['v2 item drop', 'item.drop'],
  ['v2 item pickup', 'item.pickup'],
  ['v2 shrine capture', 'shrine.capture'],
  ['v2 surge', 'surge.unit', true],
  ['v2 summon', 'create.minion'],
]

/** The rules whose counter total is 0 in `counts`. With `smoke`, the late rules are left out. */
export const deadRules = (counts: Record<string, { total: number }>, smoke = false): string[] =>
  LIVENESS.filter(([, counter, late]) => !(smoke && late) && !(counts[counter]?.total > 0)).map(([rule]) => rule)
