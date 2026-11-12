import { BRICKS } from '@ecs-arena/spec'
import { CELL, W, H } from '../../../../games/bricks/shared.ts'
import { brRegistry, type BricksSim } from '../registry.ts'

// ponytail: the sim runs on the main thread, one tick for each frame. About 1500 blocks are cheap. Add a worker, as the other pages have, if a heavy entry needs it.
// The game never ends, so the viewer keeps ticking past the length of the scenario.
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const view = $<HTMLCanvasElement>('view')
const g = view.getContext('2d')!
const implSel = $<HTMLSelectElement>('impl')
const scenSel = $<HTMLSelectElement>('scenario')
const playBtn = $<HTMLButtonElement>('play')

for (const n of Object.keys(brRegistry)) implSel.add(new Option(n, n))
for (const [n, s] of Object.entries(BRICKS.scenarios)) scenSel.add(new Option(`${n} (${s.ticks} ticks)`, n))
const params = new URLSearchParams(location.search)
if (params.get('impl') && brRegistry[params.get('impl')!]) implSel.value = params.get('impl')!
if (params.get('scenario') && BRICKS.scenarios[params.get('scenario')!]) scenSel.value = params.get('scenario')!

// The canvas keeps the pixels of the box, and CSS scales it to the window.
const fit = () => {
  const k = Math.max(0.2, Math.min(innerWidth / W, (innerHeight - 40) / H))
  view.style.width = `${W * k}px`
  view.style.height = `${H * k}px`
}
addEventListener('resize', fit)
fit()

const COLOR = ['', '#2f7fc1', '#d9a441', '#d9482b'] // block color by hp
const POP = 10, FLASH = 6, FADE = 14 // frames of each effect
const TRAIL = 8

type Fx = { kind: 'new' | 'hit'; age: number }
let sim: BricksSim | null = null
let ticks = 0
let playing = true
let run = 0
let emaMs = 0
let prev = new Map<number, number[]>() // block gameId -> row of the last tick
let fx = new Map<number, Fx>()
let dying: { cx: number; cy: number; hp: number; age: number }[] = []
let trails = new Map<number, number[][]>() // ball gameId -> last positions

const start = async () => {
  const mine = ++run
  history.replaceState(null, '', `?scenario=${scenSel.value}&impl=${implSel.value}`)
  sim?.dispose?.()
  sim = null
  ticks = 0
  emaMs = 0
  prev = new Map()
  fx = new Map()
  dying = []
  trails = new Map()
  playing = true
  playBtn.textContent = 'Pause'
  $('err').textContent = ''
  try {
    const create = (await brRegistry[implSel.value]()).default
    if (mine !== run) return
    sim = create(BRICKS.scenarios[scenSel.value])
  } catch (e) {
    $('err').textContent = String(e)
  }
}

const frame = () => {
  requestAnimationFrame(frame)
  if (!sim || !playing) return
  const t0 = performance.now()
  for (const name of BRICKS.phases) sim.systems[name](ticks)
  const ms = performance.now() - t0
  emaMs = emaMs === 0 ? ms : emaMs * 0.9 + ms * 0.1
  ticks++
  const { score, balls, blocks } = sim.snapshot()

  // Compare with the last tick: a new id is a respawn, a lower hp is a hit, a missing id is a death.
  const now = new Map<number, number[]>()
  for (const row of blocks) {
    const old = prev.get(row[0])
    if (!old) fx.set(row[0], { kind: 'new', age: 0 })
    else if (row[3] < old[3]) fx.set(row[0], { kind: 'hit', age: 0 })
    now.set(row[0], row)
  }
  for (const [id, row] of prev) if (!now.has(id)) { dying.push({ cx: row[1], cy: row[2], hp: row[3], age: 0 }); fx.delete(id) }
  prev = now

  g.fillStyle = '#0b0e14'
  g.fillRect(0, 0, W, H)
  for (const row of blocks) {
    const [id, cx, cy, hp] = row
    const e = fx.get(id)
    let size = CELL - 2, off = 1
    if (e?.kind === 'new') { size *= 0.4 + 0.6 * (e.age / POP); off = (CELL - size) / 2 }
    g.fillStyle = COLOR[hp]
    g.fillRect(cx * CELL + off, cy * CELL + off, size, size)
    if (e?.kind === 'hit') { g.fillStyle = `rgba(255,255,255,${0.9 * (1 - e.age / FLASH)})`; g.fillRect(cx * CELL + off, cy * CELL + off, size, size) }
    if (e && ++e.age >= (e.kind === 'new' ? POP : FLASH)) fx.delete(id)
  }
  dying = dying.filter((d) => d.age < FADE)
  for (const d of dying) {
    const grow = d.age / FADE * 6
    g.fillStyle = COLOR[d.hp]
    g.globalAlpha = 1 - d.age++ / FADE
    g.fillRect(d.cx * CELL + 1 - grow / 2, d.cy * CELL + 1 - grow / 2, CELL - 2 + grow, CELL - 2 + grow)
    g.globalAlpha = 1
  }

  for (const [id, x, y] of balls) {
    const t = trails.get(id) ?? []
    t.push([x, y])
    if (t.length > TRAIL) t.shift()
    trails.set(id, t)
    t.forEach(([tx, ty], i) => {
      g.fillStyle = `rgba(255,255,255,${(i / TRAIL) * 0.35})`
      g.beginPath()
      g.arc(tx, ty, 2 + i * 0.3, 0, 7)
      g.fill()
    })
    g.fillStyle = '#fff'
    g.shadowColor = '#9be7ff'
    g.shadowBlur = 10
    g.beginPath()
    g.arc(x, y, 6, 0, 7)
    g.fill()
    g.shadowBlur = 0
  }

  g.font = '600 22px system-ui, sans-serif'
  g.textBaseline = 'top'
  g.fillStyle = 'rgba(11,14,20,0.7)'
  g.fillRect(10, 10, 300, 64)
  g.fillStyle = '#fff'
  g.fillText(`Score ${score}`, 20, 16)
  g.font = '13px system-ui, sans-serif'
  g.fillStyle = '#8b949e'
  g.fillText(`Tick ${ticks} · Blocks ${blocks.length}`, 20, 48)
  $('tick').textContent = String(ticks) // read by runner/src/shots.mjs
  $('stat').textContent = `${implSel.value}: ${emaMs.toFixed(1)} ms/tick (browser, unofficial)`
}

implSel.onchange = start
scenSel.onchange = start
$('restart').onclick = start
playBtn.onclick = () => {
  playing = !playing
  playBtn.textContent = playing ? 'Pause' : 'Play'
}
requestAnimationFrame(frame)
void start()
