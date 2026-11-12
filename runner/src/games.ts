// The per-game data that the runner tools read. A tool finds the game with `findScenario(name)`, then reads it here.
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { GAMES, factory, survivors, type AnyGame } from '@ecs-arena/spec'
import type { AnyCreateSim, BaseScenario, Sim } from '@ecs-arena/spec'
import type { Counters, Regions } from '../../impls/baseline-js/src/shared/instrumentation.ts'
import { scoreTargets } from './stats.ts'

type BricksState = { score: number; balls: number[][]; blocks: number[][] }

const ROOT = resolve(import.meta.dirname, '../..')

/** A rule row: [rule, counter, late, minMean]. A rule whose counter stays 0 never changes the hash, so an implementation could skip it. A late rule needs more ticks than the smoke scenarios run. `minMean` is a floor for the mean of the counter per tick over the whole run. */
export type LivenessRow = readonly [rule: string, counter: string, late?: boolean, minMean?: number]

/** The baseline-js `createSim` of any game: the optional counters and regions are its profile and budget hooks. Bivariant like AnyCreateSim. */
export type BaselineSim = { create(scenario: BaseScenario, kernel: unknown, counters?: Counters, regions?: Regions): Sim<string> }['create']

export interface GameHarness {
  /** baseline-js region names. They must match the begin() and isNaive() strings of that game's baseline-js entry. */
  regions: readonly string[]
  /** The counters come from baseline-js (the profile hook). */
  liveness: readonly LivenessRow[]
  /** The regions that the budget claims for scenario `name`. Most games claim the same list for all of their scenarios. */
  regionsFor(name: string): readonly string[]
  /** The liveness rows that the profile checks for scenario `name`. */
  livenessFor(name: string): readonly LivenessRow[]
}

/** The harness of a game whose scenarios all claim the same regions and rules. */
const uniform = (regions: readonly string[], liveness: readonly LivenessRow[]): GameHarness => ({
  regions, liveness, regionsFor: () => regions, livenessFor: () => liveness,
})

export const HARNESS: Readonly<Record<string, GameHarness>> = {
  rts: uniform(
    [
      'move.step', 'churn', 'effects.buffs', 'cleanup.unlink', 'move.depthOrder', 'cleanup.cascade', 'links',
      'objectives.capture', 'morale.rout', 'morale.onFlee', 'stats.recompute', 'stats.setBonus', 'stats.banner', 'combat.fanIn', 'threat', 'move.trail', 'grid.update', 'garrison', 'orders.lookup', 'stats.render', 'save', 'load',
    ],
    [
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
    ],
  ),
  // Both lists come from the facet and system tables of the spec, so no list is kept by hand.
  survivors: uniform(survivors.REGIONS, survivors.LIVENESS),
  // The facet table says which scenario claims which region and rule (`scenarios` of a facet).
  factory: { regions: factory.REGIONS, liveness: factory.LIVENESS, regionsFor: factory.regionsFor, livenessFor: factory.livenessFor },
}

/** The harness of a game, or undefined for a game with none (bricks). Budget and profile skip a game with no harness. */
export const harnessOf = (game: AnyGame): GameHarness | undefined => HARNESS[game.id]

/** Absolute path of the entry of an impl for a game. A missing file means the impl does not play that game. */
export const implEntry = (impl: string, game: AnyGame): string => (game.dir ? resolve(ROOT, game.dir, 'entries', `${impl}.ts`) : resolve(ROOT, 'impls', impl, game.entry))

/** The flat state of bricks: [score, ballCount, ...balls, blockCount, ...blocks]. The sort is here, so an entry returns its rows in any order. It is 64-bit floats, and `+ 0` turns -0 into 0. */
const sortedRows = (rows: number[][]): number[] => [...rows].sort((a, b) => a[0] - b[0]).flat()
const flatState = (s: BricksState): number[] =>
  Float64Array.from([s.score, s.balls.length, ...sortedRows(s.balls), s.blocks.length, ...sortedRows(s.blocks)], (v) => v + 0) as unknown as number[]

/** A small game has `systems` and no save or load. This gives it the `Sim` shape that the runner tools read. */
const asSim = (small: { systems: Record<string, (tick: number) => void>; snapshot(): BricksState; dispose?: () => void }, names: readonly string[]): Sim<string> => {
  // The runner owns the tick counter. It gives the tick to each system and adds 1 after the last system.
  let tick = 0
  const phases = Object.fromEntries(names.map((n) => [n, () => {
    small.systems[n](tick)
    if (n === names[names.length - 1]) tick++
  }]))
  return {
    phases, dispose: small.dispose,
    snapshot: () => flatState(small.snapshot()),
    save: () => undefined, load: () => {}, // never called: the scenarios of a small game have no load
  }
}

/** Imports the `createSim` of an impl for a game. Throws when the entry has no function as its default export. */
export const loadSim = async (impl: string, game: AnyGame): Promise<AnyCreateSim> => {
  const { default: createSim } = await import(pathToFileURL(implEntry(impl, game)).href)
  if (typeof createSim !== 'function') throw new Error(`${implEntry(impl, game)} has no createSim as its default export`)
  if (!game.dir) return createSim as AnyCreateSim
  return (scenario) => asSim(createSim(scenario), game.phases)
}

/** The createSim of baseline-js, which `profile` and `budget` call with the counters and regions hooks that it declares. */
export const loadBaseline = async (game: AnyGame): Promise<BaselineSim> => (await loadSim('baseline-js', game)) as BaselineSim

/** The entries of a record that pass `keep`. */
const pick = <V>(record: Record<string, V>, keep: (key: string, value: V) => boolean): Record<string, V> =>
  Object.fromEntries(Object.entries(record).filter(([k, v]) => keep(k, v)))

/** The headline of each game that has scores: `scoreTargets` runs over that game's scenarios only. No number mixes games. */
export const scoreByGame = (totals: Record<string, Record<string, number[]>>) =>
  GAMES.map((game) => {
    // A target with no run of this game has no score for it.
    const ownScenarios = (bySc: Record<string, number[]>) => pick(bySc, (sc) => Object.hasOwn(game.scenarios, sc))
    const ofTarget = Object.fromEntries(Object.entries(totals).map(([t, bySc]) => [t, ownScenarios(bySc)]))
    const own = pick(ofTarget, (_, bySc) => Object.keys(bySc).length > 0)
    return { game, scores: scoreTargets(own, game.vanilla) }
  }).filter((g) => g.scores.length > 0)
