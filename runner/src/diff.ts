// Debug lever: run the vanilla entry of the game (baseline-js, or vanilla for bricks) and another impl in lockstep, stop at the first tick whose hash differs
// (or at the given tick) and print the first differing record of each snapshot section, decoded with SPEC §8 names.
// Usage: pnpm run diff <impl> <scenario> <tick> [gameIds...]
import { isMain } from './cli.ts'
import { parseArgs } from 'node:util'
import { runPhases, findScenario, hashState, type CanonicalState } from '@ecs-arena/spec'
import { loadSim } from './games.ts'
import { parse, type Parsed } from '../../impls/baseline-js/src/rts/testkit.ts'

const BALL_FIELDS = ['gameId', 'x', 'y', 'vx', 'vy'] as const
const BLOCK_FIELDS = ['gameId', 'cx', 'cy', 'hp'] as const
// The flat state is [score, ballCount, ...balls, blockCount, ...blocks].
const brickRows = (s: CanonicalState) => {
  const flat = s as unknown as number[]
  const rows = (at: number, fields: readonly string[]) =>
    Array.from({ length: flat[at] }, (_, i) => Object.fromEntries(fields.map((f, j) => [f, flat[at + 1 + i * fields.length + j]])) as Record<string, number>)
  const balls = rows(1, BALL_FIELDS)
  return { score: flat[0], balls, blocks: rows(2 + balls.length * BALL_FIELDS.length, BLOCK_FIELDS) }
}
const diffBricks = (a: CanonicalState, b: CanonicalState): RecordDiff[] => {
  const x = brickRows(a), y = brickRows(b)
  return [
    ...diffRecord('world', 'world', { score: x.score }, { score: y.score }),
    ...diffList('ball', x.balls, y.balls, (r) => r.gameId),
    ...diffList('block', x.blocks, y.blocks, (r) => r.gameId),
  ]
}
const findBrick = (s: CanonicalState, id: number) => [...brickRows(s).balls, ...brickRows(s).blocks].find((r) => r.gameId === id)

/** The games whose snapshot this tool can decode. A game without an entry is refused. */
const DECODERS: Readonly<Record<string, { sections: string[]; diff(a: CanonicalState, b: CanonicalState): RecordDiff[]; find(s: CanonicalState, id: number): object | undefined }>> = {
  rts: { sections: ['world', 'shrine', 'unit', 'projectile', 'ground'], diff: (a, b) => diffParsed(parse(a), parse(b)), find: (s, id) => recordOf(parse(s), id) },
  bricks: { sections: ['world', 'ball', 'block'], diff: diffBricks, find: findBrick },
}

type Fields = Record<string, unknown>
export interface RecordDiff { section: string; key: string; vanilla?: Fields; other?: Fields; differing: string[] }

const show = (v: unknown) => JSON.stringify(v)

/** One record as a flat field map. Lists (buffs, items, threat, chronicle) stay as values and compare by content. */
const fieldsOf = (r: object): Fields => ({ ...r })

const diffRecord = (section: string, key: string, a?: object, b?: object): RecordDiff[] => {
  const fa = a && fieldsOf(a), fb = b && fieldsOf(b)
  const names = Object.keys(fa ?? fb ?? {})
  const differing = !fa || !fb ? names : names.filter((n) => show(fa[n]) !== show(fb[n]))
  return differing.length ? [{ section, key, vanilla: fa, other: fb, differing }] : []
}

const diffList = <T extends object>(section: string, a: T[], b: T[], keyOf: (r: T, i: number) => number): RecordDiff[] => {
  const ia = new Map(a.map((r, i) => [keyOf(r, i), r])), ib = new Map(b.map((r, i) => [keyOf(r, i), r]))
  const keys = [...new Set([...ia.keys(), ...ib.keys()])].sort((x, y) => x - y)
  const order = (rs: T[]) => ({ keys: rs.map(keyOf) })
  return [
    ...keys.flatMap((k) => diffRecord(section, String(k), ia.get(k), ib.get(k))),
    ...diffRecord(section, 'order', order(a), order(b)),
  ]
}

/** Every differing record, in section order: world, shrine, unit, projectile, ground. */
export const diffParsed = (a: Parsed, b: Parsed): RecordDiff[] => {
  const world = (p: Parsed) => ({ tick: p.tick, alive0: p.alive[0], alive1: p.alive[1], kills0: p.kills[0], kills1: p.kills[1], damage0: p.damage[0], damage1: p.damage[1], winner: p.winner, shrines0: p.score[0], shrines1: p.score[1], orders0: p.orders[0], orders1: p.orders[1], renderChain: p.renderChain })
  return [
    ...diffRecord('world', 'world', world(a), world(b)),
    ...diffList('shrine', a.shrines, b.shrines, (r) => r.gameId),
    ...diffList('unit', a.units, b.units, (r) => r.gameId),
    ...diffList('projectile', a.projectiles, b.projectiles, (r) => r.gameId),
    ...diffList('ground', a.ground, b.ground, (r) => r.gameId),
  ]
}

const render = (d: RecordDiff, baselineName: string): string => {
  const names = Object.keys(d.vanilla ?? d.other ?? {})
  const w = Math.max(...names.map((n) => n.length))
  const rows = names.map((n) => {
    const mark = d.differing.includes(n) ? '*' : ' '
    return `${mark} ${n.padEnd(w)}  ${(d.vanilla ? show(d.vanilla[n]) : '(missing)').padEnd(40)}  ${d.other ? show(d.other[n]) : '(missing)'}`
  })
  return [`${d.section} ${d.key}`, `  ${' '.repeat(w)}  ${baselineName.padEnd(40)}  other`, ...rows].join('\n')
}

const recordOf = (p: Parsed, id: number): object | undefined =>
  [...p.shrines, ...p.units, ...p.projectiles, ...p.ground].find((r) => r.gameId === id)

const main = async (): Promise<number> => {
  const { positionals: [impl, name, tickArg, ...ids] } = parseArgs({ args: process.argv.slice(2), allowPositionals: true, options: {} })
  if (!impl || !name || !/^\d+$/.test(tickArg ?? '')) {
    console.error('usage: pnpm run diff <impl> <scenario> <tick> [gameIds...]')
    return 2
  }
  const { game, scenario } = findScenario(name)
  const decode = DECODERS[game.id]
  if (!decode) {
    console.error(`pnpm run diff has no snapshot decoder for ${game.id}, and ${name} is a ${game.id} scenario`)
    return 2
  }
  const last = Math.min(Number(tickArg), scenario.ticks - 1)
  const baseName = game.vanilla ?? 'baseline-js'
  const baseline = await loadSim(baseName, game)
  const other = await loadSim(impl, game)
  const a = baseline(scenario, game.kernel), b = other(scenario, game.kernel)
  for (let t = 0; t <= last; t++) {
    runPhases(game, a); runPhases(game, b)
    const sa = a.snapshot(), sb = b.snapshot()
    const differs = hashState(sa) !== hashState(sb)
    if (!differs && t < last) continue
    const all = decode.diff(sa, sb)
    console.log(differs ? `tick ${t}: hashes differ (vanilla ${hashState(sa)}, ${impl} ${hashState(sb)})` : `tick ${t}: hashes match`)
    for (const section of decode.sections) {
      const rows = all.filter((d) => d.section === section)
      if (rows.length) console.log(`\n${section}: ${rows.length} differing, first below\n${render(rows[0], baseName)}`)
    }
    for (const id of ids) {
      const rec = decode.find(sa, Number(id)), rec2 = decode.find(sb, Number(id))
      if (!rec && !rec2) console.log(`\ngameId ${id}: in neither snapshot`)
      else console.log(`\n${render(all.find((d) => d.key === id) ?? { section: 'record', key: `${id} (identical)`, vanilla: rec && fieldsOf(rec), other: rec2 && fieldsOf(rec2), differing: [] }, baseName)}`)
    }
    return differs ? 1 : 0
  }
  return 0
}

if (isMain(import.meta)) process.exit(await main())
