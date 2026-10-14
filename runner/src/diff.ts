// Debug lever: run baseline-js and another impl in lockstep, stop at the first tick whose hash differs
// (or at the given tick) and print the first differing record of each snapshot section, decoded with SPEC §8 names.
// Usage: pnpm run diff <impl> <scenario> <tick> [gameIds...]
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { PHASES, SCENARIOS, hashState, kernel, type CreateSim } from '@ecs-arena/spec'
import baseline from '../../impls/baseline-js/src/index.ts'
import { parse, type Parsed } from '../../impls/baseline-js/src/testkit.ts'

const ROOT = resolve(import.meta.dirname, '../..')

type Fields = Record<string, unknown>
export interface RecordDiff { section: string; key: string; baseline?: Fields; other?: Fields; differing: string[] }

const show = (v: unknown) => JSON.stringify(v)

/** One record as a flat field map. Lists (buffs, items, threat, chronicle) stay as values and compare by content. */
const fieldsOf = (r: object): Fields => ({ ...r })

const diffRecord = (section: string, key: string, a?: object, b?: object): RecordDiff[] => {
  const fa = a && fieldsOf(a), fb = b && fieldsOf(b)
  const names = Object.keys(fa ?? fb ?? {})
  const differing = !fa || !fb ? names : names.filter((n) => show(fa[n]) !== show(fb[n]))
  return differing.length ? [{ section, key, baseline: fa, other: fb, differing }] : []
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
  const world = (p: Parsed) => ({ tick: p.tick, alive0: p.alive[0], alive1: p.alive[1], kills0: p.kills[0], kills1: p.kills[1], damage0: p.damage[0], damage1: p.damage[1], winner: p.winner, shrines0: p.score[0], shrines1: p.score[1], orders0: p.orders[0], orders1: p.orders[1] })
  return [
    ...diffRecord('world', 'world', world(a), world(b)),
    ...diffList('shrine', a.shrines, b.shrines, (r) => r.gameId),
    ...diffList('unit', a.units, b.units, (r) => r.gameId),
    ...diffList('projectile', a.projectiles, b.projectiles, (r) => r.gameId),
    ...diffList('ground', a.ground, b.ground, (r) => r.gameId),
  ]
}

const render = (d: RecordDiff): string => {
  const names = Object.keys(d.baseline ?? d.other ?? {})
  const w = Math.max(...names.map((n) => n.length))
  const rows = names.map((n) => {
    const mark = d.differing.includes(n) ? '*' : ' '
    return `${mark} ${n.padEnd(w)}  ${(d.baseline ? show(d.baseline[n]) : '(missing)').padEnd(40)}  ${d.other ? show(d.other[n]) : '(missing)'}`
  })
  return [`${d.section} ${d.key}`, `  ${' '.repeat(w)}  ${'baseline-js'.padEnd(40)}  other`, ...rows].join('\n')
}

const SECTIONS = ['world', 'shrine', 'unit', 'projectile', 'ground']
const recordOf = (p: Parsed, id: number): object | undefined =>
  [...p.shrines, ...p.units, ...p.projectiles, ...p.ground].find((r) => r.gameId === id)

const main = async (): Promise<number> => {
  const [impl, name, tickArg, ...ids] = process.argv.slice(2)
  const scenario = SCENARIOS[name]
  if (!impl || !scenario || !/^\d+$/.test(tickArg ?? '')) {
    console.error('usage: pnpm run diff <impl> <scenario> <tick> [gameIds...]')
    return 2
  }
  const last = Math.min(Number(tickArg), scenario.ticks - 1)
  const other = (await import(pathToFileURL(resolve(ROOT, 'impls', impl, 'src/index.ts')).href)).default as CreateSim
  const a = baseline(scenario, kernel), b = other(scenario, kernel)
  for (let t = 0; t <= last; t++) {
    for (const p of PHASES) { a.phases[p](); b.phases[p]() }
    const sa = a.snapshot(), sb = b.snapshot()
    const differs = hashState(sa) !== hashState(sb)
    if (!differs && t < last) continue
    const pa = parse(sa), pb = parse(sb)
    const all = diffParsed(pa, pb)
    console.log(differs ? `tick ${t}: hashes differ (baseline ${hashState(sa)}, ${impl} ${hashState(sb)})` : `tick ${t}: hashes match`)
    for (const section of SECTIONS) {
      const rows = all.filter((d) => d.section === section)
      if (rows.length) console.log(`\n${section}: ${rows.length} differing, first below\n${render(rows[0])}`)
    }
    for (const id of ids) {
      const rec = recordOf(pa, Number(id)), rec2 = recordOf(pb, Number(id))
      if (!rec && !rec2) console.log(`\ngameId ${id}: in neither snapshot`)
      else console.log(`\n${render(all.find((d) => d.key === id) ?? { section: 'record', key: `${id} (identical)`, baseline: rec && fieldsOf(rec), other: rec2 && fieldsOf(rec2), differing: [] })}`)
    }
    return differs ? 1 : 0
  }
  return 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(await main())
