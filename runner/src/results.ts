import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { PHASES } from '@ecs-arena/spec'
import type { BenchReport } from './bench.ts'

const ROOT = resolve(import.meta.dirname, '../..')
const DATA = resolve(ROOT, 'bench-data')
const SUMMARY = resolve(DATA, 'summary.csv')
const PAGE = resolve(ROOT, 'docs/results.md')
const CHARTS = resolve(ROOT, 'docs/charts')
const MB = 1048576

const TICK_COLS = [...PHASES, 'tick_ms', 'gc_ms', 'alloc_bytes']
const SUMMARY_COLS = ['date', 'commit', 'target', 'scenario', 'runs', 'total_ms', ...PHASES.map((p) => `${p}_ms`), 'gc_ms', 'alloc_mb', 'peak_heap_mb']

const fileName = (target: string) => target.replace(/[^\w.@-]/g, '_')
const ticksPath = (scenario: string, target: string) => resolve(DATA, 'ticks', scenario, `${fileName(target)}.csv`)

export const readCsv = (path: string): Record<string, string>[] => {
  const [head, ...rows] = readFileSync(path, 'utf8').trim().split('\n')
  const cols = head.split(',')
  return rows.map((r) => Object.fromEntries(r.split(',').map((v, i) => [cols[i], v])))
}

const commit = () => {
  try {
    return execSync('git rev-parse --short HEAD', { cwd: ROOT }).toString().trim()
  } catch {
    return 'unknown'
  }
}

/** Writes the per-tick medians and upserts one summary row per target and scenario (same commit replaces). */
export const recordReport = (report: BenchReport) => {
  const sha = commit()
  const date = new Date().toISOString().slice(0, 10)
  const old = existsSync(SUMMARY) ? readCsv(SUMMARY) : []
  const fresh: Record<string, string>[] = []
  for (const [target, byScenario] of Object.entries(report))
    for (const [scenario, a] of Object.entries(byScenario)) {
      const path = ticksPath(scenario, target)
      mkdirSync(dirname(path), { recursive: true })
      const rows = a.ticks.map((r) => r.map((v, i) => (i === r.length - 1 ? Math.round(v) : +v.toFixed(4))).join(','))
      writeFileSync(path, [TICK_COLS.join(','), ...rows].join('\n') + '\n')
      const row = [date, sha, target, scenario, a.runs, a.totalMs.median, ...PHASES.map((p) => a.phasesMs[p].median), a.gcMs.median, a.allocBytes.median / MB, a.peakHeap.median / MB]
      fresh.push(Object.fromEntries(SUMMARY_COLS.map((c, i) => [c, typeof row[i] === 'number' ? String(+(+row[i]).toFixed(2)) : String(row[i])])))
    }
  const key = (r: Record<string, string>) => `${r.commit}|${r.target}|${r.scenario}`
  const keep = old.filter((r) => !fresh.some((f) => key(f) === key(r)))
  mkdirSync(DATA, { recursive: true })
  writeFileSync(SUMMARY, [SUMMARY_COLS.join(','), ...[...keep, ...fresh].map((r) => SUMMARY_COLS.map((c) => r[c]).join(','))].join('\n') + '\n')
}

// Categorical slots in fixed order (dataviz default palette). A target keeps its slot by sorted name.
const SERIES = [
  ['#2a78d6', '#3987e5'],
  ['#eb6834', '#d95926'],
  ['#1baf7a', '#199e70'],
  ['#eda100', '#c98500'],
  ['#e87ba4', '#d55181'],
  ['#008300', '#008300'],
]
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')

/** Rolling mean so per-tick noise does not hide the trend. */
const smooth = (xs: number[], w = 20) => xs.map((_, i) => {
  const s = xs.slice(Math.max(0, i - w + 1), i + 1)
  return s.reduce((a, b) => a + b, 0) / s.length
})

export const lineChart = (title: string, unit: string, series: { name: string; slot: number; ys: number[] }[]): string => {
  const W = 720, H = 300, L = 56, R = 16, T = 60, B = 36
  const n = Math.max(...series.map((s) => s.ys.length))
  const max = Math.max(...series.flatMap((s) => s.ys)) * 1.05 || 1
  const x = (i: number) => L + (i / Math.max(1, n - 1)) * (W - L - R)
  const y = (v: number) => T + (1 - v / max) * (H - T - B)
  const grid = [0, 0.25, 0.5, 0.75, 1].map((f) => {
    const v = max * f
    return `<line class="g" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text class="m" x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${+v.toPrecision(3)}</text>`
  })
  const lines = series.map((s) => `<polyline class="s${s.slot}" fill="none" stroke-width="2" stroke-linejoin="round" points="${s.ys.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')}"><title>${esc(s.name)}</title></polyline>`)
  const legend = series.map((s, i) => `<rect class="f${s.slot}" x="${L + i * 170}" y="${T - 36}" width="10" height="10" rx="2"/><text class="p" x="${L + i * 170 + 14}" y="${T - 27}">${esc(s.name)}</text>`)
  const css = SERIES.map(([l], i) => `.s${i}{stroke:${l}}.f${i}{fill:${l}}`).join('')
  const dark = SERIES.map(([, d], i) => `.s${i}{stroke:${d}}.f${i}{fill:${d}}`).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" font-family="system-ui,sans-serif" font-size="12">
<style>.bg{fill:#fcfcfb}.g{stroke:#e4e3de;stroke-width:1}.p{fill:#1f1f1e}.m{fill:#6b6a64}${css}
@media (prefers-color-scheme: dark){.bg{fill:#1a1a19}.g{stroke:#33332f}.p{fill:#f0efec}.m{fill:#a3a29a}${dark}}</style>
<rect class="bg" width="${W}" height="${H}" rx="8"/>
<text class="p" x="${L}" y="16" font-weight="600">${esc(title)}</text>
${grid.join('\n')}
<text class="m" x="${W - R}" y="${H - 4}" text-anchor="end">tick</text><text class="m" x="${L - 6}" y="${T - 12}" text-anchor="end">${esc(unit)}</text><text class="m" x="${L}" y="${H - 18}">0</text><text class="m" x="${W - R}" y="${H - 18}" text-anchor="end">${n}</text>
${lines.join('\n')}
${legend.join('\n')}
</svg>
`
}

const table = (head: string[], rows: (string | number)[][]) =>
  [`| ${head.join(' | ')} |`, `|${head.map((_, i) => (i ? '---:' : '---')).join('|')}|`, ...rows.map((r) => `| ${r.join(' | ')} |`)].join('\n')

/** Rebuilds docs/results.md and its SVG charts from bench-data. */
export const writeResultsPage = () => {
  if (!existsSync(SUMMARY)) return
  const summary = readCsv(SUMMARY)
  // Latest row per target and scenario.
  const latest = new Map<string, Record<string, string>>()
  for (const r of summary) latest.set(`${r.scenario}|${r.target}`, r)
  const scenarios = [...new Set([...latest.values()].map((r) => r.scenario))].sort()
  const targets = [...new Set(summary.map((r) => r.target))].sort()
  const slot = (t: string) => targets.indexOf(t) % SERIES.length
  mkdirSync(CHARTS, { recursive: true })
  const out = [
    '# Bench results',
    '',
    'Generated by `pnpm bench <target> <scenario...> --record` (or `pnpm results`). Do not edit by hand.',
    'Raw data: [`bench-data/summary.csv`](../bench-data/summary.csv) (one row per commit, target and scenario) and `bench-data/ticks/<scenario>/<target>.csv` (per-tick median of the runs).',
    'Totals are the median of the runs. GC ms is V8 GC pause time inside the timed ticks. Alloc MB is JS heap bytes allocated (heap growth plus bytes the GC freed). It excludes typed-array backing stores.',
  ]
  for (const sc of scenarios) {
    const rows = targets.map((t) => latest.get(`${sc}|${t}`)).filter((r) => r !== undefined)
    out.push('', `## ${sc}`, '', '### Totals for the run', '')
    out.push(table(['metric', ...rows.map((r) => `${r.target} (${r.commit})`)], [
      ['total ms', ...rows.map((r) => r.total_ms)],
      ...PHASES.map((p) => [`${p} ms`, ...rows.map((r) => r[`${p}_ms`])]),
      ['gc ms', ...rows.map((r) => r.gc_ms)],
      ['alloc MB', ...rows.map((r) => r.alloc_mb)],
      ['peak heap MB', ...rows.map((r) => r.peak_heap_mb)],
    ]))
    const ticks = rows.filter((r) => existsSync(ticksPath(sc, r.target))).map((r) => ({ name: r.target, slot: slot(r.target), rows: readCsv(ticksPath(sc, r.target)) }))
    const col = (c: string, div = 1) => ticks.map((t) => ({ name: t.name, slot: t.slot, ys: smooth(t.rows.map((r) => +r[c] / div)) }))
    const avg = (c: string, t: (typeof ticks)[number]) => t.rows.reduce((a, r) => a + +r[c], 0) / t.rows.length
    out.push('', '### Mean for each tick', '')
    out.push(table(['metric', ...ticks.map((t) => t.name)], [
      ['tick ms', ...ticks.map((t) => avg('tick_ms', t).toFixed(3))],
      ...PHASES.map((p) => [`${p} ms`, ...ticks.map((t) => avg(p, t).toFixed(3))]),
      ['gc ms', ...ticks.map((t) => avg('gc_ms', t).toFixed(3))],
      ['alloc KB', ...ticks.map((t) => (avg('alloc_bytes', t) / 1024).toFixed(1))],
    ]))
    const charts: [string, string, string, number][] = [
      ['tick', 'Tick time (20-tick mean)', 'ms', 1],
      ['gc', 'GC time per tick (20-tick mean)', 'ms', 1],
      ['alloc', 'Allocation per tick (20-tick mean)', 'KB', 1024],
      ...PHASES.map((p): [string, string, string, number] => [p, `${p} per tick (20-tick mean)`, 'ms', 1]),
    ]
    out.push('', '### Per tick', '')
    for (const [c, title, unit, div] of charts) {
      const file = `${sc}-${c.replace('/', '-')}.svg`
      const column = c === 'tick' ? 'tick_ms' : c === 'gc' ? 'gc_ms' : c === 'alloc' ? 'alloc_bytes' : c
      writeFileSync(resolve(CHARTS, file), lineChart(`${sc}: ${title}`, unit, col(column, div)))
      out.push(`![${sc} ${title}](charts/${file})`)
    }
  }
  writeFileSync(PAGE, out.join('\n') + '\n')
  console.log(`wrote ${PAGE.replace(ROOT + '/', '')} (${readdirSync(CHARTS).length} charts)`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) writeResultsPage()
