import { findScenario, survivors } from '@ecs-arena/spec'
import { groundAtNdc, focusOn } from './camera.ts'
import { tickIntervalMs, type Speed } from './clock.ts'
import type { FromWorker, ToWorker, ViewerScenario } from './protocol.ts'
import { registry, svRegistry } from './registry.ts'
import { createViewer } from './render.ts'
import { parseSnapshot } from './snapshot.ts'
import { KIND_LOOK } from './svlook.ts'
import { parseSvSnapshot } from './svsnapshot.ts'

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const SCENARIO_NAMES = { rts: ['skirmish', 'battle', 'war'], survivors: ['grove', 'thicket', 'swarm', 'grove-smoke'] }
const HELP = {
  rts: 'WASD or screen edge: pan. Wheel: zoom. Right-drag: grab and pan. Middle-drag or Q/E: rotate. F: reset view.',
  survivors: 'The camera follows the player. Wheel: zoom. Middle-drag or Q/E: rotate.',
}
const ARENA = 256

const implSel = $<HTMLSelectElement>('impl')
const scenSel = $<HTMLSelectElement>('scenario')
const playBtn = $<HTMLButtonElement>('play')
const mini = $<HTMLCanvasElement>('mini')
const mctx = mini.getContext('2d')!

const fillImpls = (game: 'rts' | 'survivors') => {
  implSel.length = 0
  for (const n of Object.keys(game === 'rts' ? registry : svRegistry)) implSel.add(new Option(n, n))
}
for (const [game, names] of Object.entries(SCENARIO_NAMES)) {
  const group = document.createElement('optgroup')
  group.label = game
  for (const n of names) group.append(new Option(`${n} (${findScenario(n).scenario.ticks} ticks)`, n))
  scenSel.append(group)
}
let game: 'rts' | 'survivors' = 'rts'
fillImpls(game)

const viewer = await createViewer($<HTMLCanvasElement>('view'))
const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
const send = (m: ToWorker) => worker.postMessage(m)

let speed: Speed = '1x'
let playing = true
let finished = false
let emaMs = 0
let pending: Int32Array | null = null
let run = 0
const dots = new ImageData(mini.width, mini.height)
const dots32 = new Uint32Array(dots.data.buffer)
const dotCanvas = document.createElement('canvas')
dotCanvas.width = mini.width
dotCanvas.height = mini.height
const dotCtx = dotCanvas.getContext('2d')!
let shrinesNow: { owner: number }[] = []

const setText = (id: string, v: string | number) => { $(id).textContent = String(v) }

const setGame = (next: typeof game) => {
  game = next
  fillImpls(game)
  viewer.setMode(game)
  $('hud-rts').style.display = game === 'rts' ? '' : 'none'
  $('hud-sv').style.display = game === 'rts' ? 'none' : ''
  $('help').textContent = HELP[game]
}

const start = () => {
  const next = findScenario(scenSel.value).game.id as typeof game
  if (next !== game) setGame(next)
  // The URL names the run on screen, so a link opens the same scenario and impl.
  history.replaceState(null, '', `?scenario=${scenSel.value}&impl=${implSel.value}${endless ? '&endless=1' : ''}`)
  viewer.reset()
  pending = null
  finished = false
  playing = true
  emaMs = 0
  dots32.fill(0)
  dotCtx.putImageData(dots, 0, 0)
  playBtn.textContent = 'Pause'
  $('banner').style.display = 'none'
  $('err').textContent = ''
  viewer.setTickIntervalMs(tickIntervalMs(speed))
  send({ type: 'init', run: ++run, impl: implSel.value, game, scenario: findScenario(scenSel.value).scenario as ViewerScenario, speed, endless })
}

worker.onmessage = (e: MessageEvent<FromWorker>) => {
  const m = e.data
  if (m.run !== run) return
  if (m.type === 'snap') {
    pending = m.snapshot
    emaMs = emaMs === 0 ? m.tickMs : emaMs * 0.9 + m.tickMs * 0.1
    setText('stat', `${implSel.value}: ${emaMs.toFixed(1)} ms/tick (browser, unofficial)`)
  } else if (m.type === 'done') {
    finished = true
    playing = false
    playBtn.textContent = 'Play'
  } else $('err').textContent = m.message
}

const TEAM_PX = [0xffff9a4c, 0xff6b6bff]
const UPGRADES = survivors.kernel.UPGRADES
const consumeSv = (raw: Int32Array) => {
  const s = parseSvSnapshot(raw)
  viewer.pushSv(s)
  const groups: Record<string, number> = { fodder: 0, runner: 0, ranged: 0, special: 0, boss: 0, elite: 0 }
  dots32.fill(0)
  const k = mini.width / (ARENA * 1024)
  for (const u of s.units) {
    if (u.kind < KIND_LOOK.length) groups[KIND_LOOK[u.kind].group]++
    if (u.flags & (1 << survivors.kernel.STATUS.ELITE)) groups.elite++
    const px = Math.min((u.x * k) | 0, mini.width - 1), py = Math.min((u.y * k) | 0, mini.height - 1)
    dots32[py * mini.width + px] = TEAM_PX[u.team] ?? TEAM_PX[0]
  }
  dotCtx.putImageData(dots, 0, 0)
  const w = s.world
  setText('sv-tick', w.tick)
  setText('sv-level', `${w.level} (xp ${w.xp}, hp ${w.hp})`)
  setText('sv-kills', w.kills)
  setText('sv-groups', Object.entries(groups).map(([g, n]) => `${g} ${n}`).join(', '))
  setText('sv-other', `shots ${s.projectiles.length}, pickups ${s.pickups.length}, particles ${s.particles.length}`)
  setText('sv-held', s.held.map((h) => `${UPGRADES[h.id].name} ${h.level}`).join(', '))
}
const consume = (raw: Int32Array) => {
  if (game === 'survivors') return consumeSv(raw)
  const s = parseSnapshot(raw)
  viewer.push(s)
  const w = s.world
  setText('tick', w.tick)
  setText('alive0', w.alive0); setText('alive1', w.alive1)
  setText('kills0', w.kills0); setText('kills1', w.kills1)
  setText('shrines0', w.shrines0); setText('shrines1', w.shrines1)
  if (w.winner !== -1) {
    const b = $('banner')
    b.textContent = `Team ${w.winner === 0 ? 'Blue' : 'Red'} wins`
    b.style.color = w.winner === 0 ? 'var(--blue)' : 'var(--red)'
    b.style.display = 'block'
  }
  shrinesNow = s.shrines
  dots32.fill(0)
  const k = mini.width / (ARENA * 1024)
  for (const u of s.units) {
    const px = Math.min((u.x * k) | 0, mini.width - 1), py = Math.min((u.y * k) | 0, mini.height - 1)
    dots32[py * mini.width + px] = TEAM_PX[u.team] ?? TEAM_PX[0]
  }
  dotCtx.putImageData(dots, 0, 0)
}

const MINI_COLORS = ['#4c9aff', '#ff6b6b']
const drawMini = () => {
  const k = mini.width / ARENA
  mctx.clearRect(0, 0, mini.width, mini.height)
  mctx.drawImage(dotCanvas, 0, 0)
  shrinesNow.forEach((s, i) => {
    mctx.fillStyle = s.owner < 0 ? '#aaa' : MINI_COLORS[s.owner]
    mctx.strokeStyle = '#fff'
    mctx.beginPath()
    mctx.arc(128 * k, (16 + 32 * i) * k, 4, 0, Math.PI * 2)
    mctx.fill()
    mctx.stroke()
  })
  mctx.strokeStyle = '#fff'
  mctx.lineWidth = 1.5
  mctx.beginPath()
  ;[[-1, 1], [1, 1], [1, -1], [-1, -1]].forEach(([nx, ny], i) => {
    const g = groundAtNdc(viewer.camera, nx, ny)
    const x = Math.min(ARENA, Math.max(0, g.x)) * k, y = Math.min(ARENA, Math.max(0, g.z)) * k
    if (i === 0) mctx.moveTo(x, y)
    else mctx.lineTo(x, y)
  })
  mctx.closePath()
  mctx.stroke()
}

const tick = () => {
  requestAnimationFrame(tick)
  if (pending) {
    const raw = pending
    pending = null
    consume(raw)
  }
  drawMini()
}
requestAnimationFrame(tick)

const focusFromMini = (e: MouseEvent) => {
  const r = mini.getBoundingClientRect()
  focusOn(viewer.camera, ((e.clientX - r.left) / r.width) * ARENA, ((e.clientY - r.top) / r.height) * ARENA)
}
let dragging = false
mini.addEventListener('mousedown', (e) => { dragging = true; focusFromMini(e) })
mini.addEventListener('mousemove', (e) => { if (dragging) focusFromMini(e) })
window.addEventListener('mouseup', () => { dragging = false })

implSel.onchange = start
scenSel.onchange = start
$('restart').onclick = start
playBtn.onclick = () => {
  if (finished) return start()
  playing = !playing
  playBtn.textContent = playing ? 'Pause' : 'Play'
  send({ type: playing ? 'play' : 'pause' })
}
for (const b of document.querySelectorAll<HTMLButtonElement>('#speed button')) {
  b.onclick = () => {
    speed = b.dataset.speed as Speed
    document.querySelectorAll('#speed button').forEach((o) => o.classList.toggle('on', o === b))
    viewer.setTickIntervalMs(tickIntervalMs(speed))
    send({ type: 'speed', speed })
  }
}

// Endless: play past the scenario's last tick. Turning it on after a run ended resumes that run.
let endless = new URLSearchParams(location.search).get('endless') === '1'
const endlessBtn = $<HTMLButtonElement>('endless')
const showEndless = () => {
  endlessBtn.classList.toggle('on', endless)
  const url = new URL(location.href)
  if (endless) url.searchParams.set('endless', '1')
  else url.searchParams.delete('endless')
  history.replaceState(null, '', url)
}
endlessBtn.onclick = () => {
  endless = !endless
  showEndless()
  send({ type: 'endless', on: endless })
  if (endless && finished) {
    finished = false
    playing = true
    playBtn.textContent = 'Pause'
    send({ type: 'play' })
  }
}
showEndless()

// A link such as ?scenario=war&impl=koota opens that run. A name that is not in the lists is ignored.
const linked = new URLSearchParams(location.search)
const has = (sel: HTMLSelectElement, v: string | null): v is string => v !== null && [...sel.options].some((o) => o.value === v)
const linkedScenario = linked.get('scenario')
if (has(scenSel, linkedScenario)) {
  scenSel.value = linkedScenario
  const linkedGame = findScenario(linkedScenario).game.id as typeof game
  if (linkedGame !== game) setGame(linkedGame)
}
const linkedImpl = linked.get('impl')
if (has(implSel, linkedImpl)) implSel.value = linkedImpl

start()
