import { factory, FACTORY } from '@ecs-arena/spec'
import { tickIntervalMs, type Speed } from '../clock.ts'
import { faRegistry } from '../registry.ts'
import { CHANGED_AT, CHANGED_FIELDS, CRATE_FIELDS, DRONE_FIELDS, type FaFromWorker, type FaToWorker } from './protocol.ts'

const { FX, DISTRICT_TILES, FLAG, KIND, ITEM } = factory.kernel
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T

/** Tile colours by machine kind, as [r, g, b]. */
const KIND_RGB: Record<number, [number, number, number]> = {
  [KIND.EXTRACTOR]: [214, 150, 72],
  [KIND.SMELTER]: [96, 156, 222],
  [KIND.ASSEMBLER]: [112, 200, 120],
  [KIND.SINK]: [190, 140, 230],
}
const ITEM_CSS: Record<number, string> = { [ITEM.ORE]: '#e0a050', [ITEM.PLATE]: '#7fb4ec', [ITEM.GEAR]: '#8ad692' }
const KIND_NAME: Record<number, string> = { [KIND.EXTRACTOR]: 'extractor (ore)', [KIND.SMELTER]: 'smelter (plate)', [KIND.ASSEMBLER]: 'assembler (gear)', [KIND.SINK]: 'sink' }
const FLOOR = [20, 25, 32]
const OFF = [70, 34, 34]
const IDLE = 0.32

const view = $<HTMLCanvasElement>('view')
const g = view.getContext('2d')!
const implSel = $<HTMLSelectElement>('impl')
const scenSel = $<HTMLSelectElement>('scenario')
const playBtn = $<HTMLButtonElement>('play')

for (const n of Object.keys(faRegistry)) implSel.add(new Option(n, n))
for (const [n, s] of Object.entries(FACTORY.scenarios)) scenSel.add(new Option(`${n} (${s.ticks} ticks)`, n))
const params = new URLSearchParams(location.search)
if (params.get('impl') && faRegistry[params.get('impl')!]) implSel.value = params.get('impl')!
if (params.get('scenario') && FACTORY.scenarios[params.get('scenario')!]) scenSel.value = params.get('scenario')!

$('legend').innerHTML = Object.entries(KIND_RGB).map(([k, [r, gg, b]]) => `<div><span class="sw" style="background:rgb(${r},${gg},${b})"></span>${KIND_NAME[+k]}</div>`).join('')
  + `<div><span class="sw" style="background:rgb(${OFF.join(',')})"></span>no power</div>`
  + `<div class="dim" style="margin-top:4px">crates</div>`
  + [ITEM.ORE, ITEM.PLATE, ITEM.GEAR].map((i) => `<div><span class="sw" style="background:${ITEM_CSS[i]}"></span>${['', 'ore', 'plate', 'gear'][i]}</div>`).join('')

// World state. The machine map is one pixel per tile, updated from the changed-machine records.
let scenario: factory.FactoryScenario
let W = 0, H = 0
let map: HTMLCanvasElement
let pix: ImageData
let mpix: Uint32Array
let snap: Int32Array | null = null
let prev = new Map<number, number>() // gameId to index in the previous snapshot
let prevSnap: Int32Array | null = null
let snapAt = 0
let speed: Speed = '4x'
let playing = true
let finished = false
let run = 0
let emaMs = 0
let cam = { x: 0, y: 0, z: 1 } // screen = (iso - cam) * z

const rgba = (r: number, gg: number, b: number) => (255 << 24) | (b << 16) | (gg << 8) | r
const tileOf = (gameId: number) => {
  const [x, y] = factory.kernel.slotPos(scenario, gameId)
  return Math.floor(y / FX) * W + Math.floor(x / FX)
}
const paint = (gameId: number, kind: number, flags: number) => {
  mFlags[gameId] = flags
  const [r, gg, b] = KIND_RGB[kind]
  let c: number
  if (flags & FLAG.WORKING) c = rgba(r, gg, b)
  else if (flags & (FLAG.POWERED | FLAG.MANUAL)) c = rgba(r * IDLE | 0, gg * IDLE | 0, b * IDLE | 0)
  else c = rgba(OFF[0], OFF[1], OFF[2])
  mpix[tileOf(gameId)] = c
}

const buildMap = () => {
  W = scenario.districtsX * DISTRICT_TILES
  H = scenario.districtsY * DISTRICT_TILES
  map = document.createElement('canvas')
  map.width = W
  map.height = H
  pix = new ImageData(W, H)
  mpix = new Uint32Array(pix.data.buffer)
  mpix.fill(rgba(FLOOR[0], FLOOR[1], FLOOR[2]))
  const n = factory.kernel.machineCount(scenario)
  tileMachine = new Int32Array(W * H)
  mKind = new Uint8Array(n + 1)
  mFlags = new Uint8Array(n + 1)
  for (let id = 1; id <= n; id++) { tileMachine[tileOf(id)] = id; mKind[id] = factory.kernel.kindOf(scenario, id) }
  for (let id = 1; id <= n; id++) {
    const manual = factory.kernel.manualOf(scenario, id)
    paint(id, factory.kernel.kindOf(scenario, id), FLAG.POWERED | (manual ? FLAG.MANUAL : 0))
  }
  for (let d = 0; d < scenario.districtsX * scenario.districtsY; d++) {
    const dx = d % scenario.districtsX, dy = Math.floor(d / scenario.districtsX)
    const y = dy * DISTRICT_TILES + 46, x0 = dx * DISTRICT_TILES + 22
    for (let x = x0; x < x0 + 4; x++) mpix[y * W + x] = rgba(90, 98, 110)
  }
  map.getContext('2d')!.putImageData(pix, 0, 0)
  $('machines').textContent = n.toLocaleString()
  $('districts').textContent = String(scenario.districtsX * scenario.districtsY)
}

/** Centres tile (u, v) at zoom z. */
const lookAt = (u: number, v: number, z: number) => {
  const w = view.clientWidth, h = view.clientHeight
  cam = { z, x: (u - v) * 32 - w / 2 / z, y: (u + v) * 16 - (h / 2 + 20) / z }
}
const fit = () => {
  const w = view.clientWidth, h = view.clientHeight - 40
  lookAt(W / 2, H / 2, Math.min(w / ((W + H) * 32), h / ((W + H) * 16)) * 0.95)
}

const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
const send = (m: FaToWorker) => worker.postMessage(m)

const start = () => {
  scenario = FACTORY.scenarios[scenSel.value]
  history.replaceState(null, '', `?scenario=${scenSel.value}&impl=${implSel.value}${endless ? '&endless=1' : ''}`)
  buildMap()
  lookAt(26, 9, 0.9)
  snap = prevSnap = null
  prev = new Map()
  emaMs = 0
  playing = true
  finished = false
  playBtn.textContent = 'Pause'
  $('err').textContent = ''
  send({ type: 'init', run: ++run, impl: implSel.value, scenario, speed, endless })
}

worker.onmessage = (e: MessageEvent<FaFromWorker>) => {
  const m = e.data
  if (m.run !== run) return
  if (m.type === 'error') { $('err').textContent = m.message; return }
  if (m.type === 'done') { finished = true; playing = false; playBtn.textContent = 'Play'; return }
  const c = m.changes
  for (let i = 0; i < c.length; i += CHANGED_FIELDS) paint(c[i], c[i + 1], c[i + 5])
  if (c.length) map.getContext('2d')!.putImageData(pix, 0, 0)
  prevSnap = snap
  prev = new Map()
  if (prevSnap) forEachMover(prevSnap, (id, at) => prev.set(id, at))
  snap = m.snapshot
  snapAt = performance.now()
  emaMs = emaMs ? emaMs * 0.9 + m.tickMs * 0.1 : m.tickMs
  hud(snap)
}

/** Calls `f(gameId, index)` for each drone and crate record. The record holds x, y, c, s at a fixed offset from the index. */
const forEachMover = (s: Int32Array, f: (id: number, at: number, crate: boolean) => void) => {
  let i = CHANGED_AT + 1 + s[CHANGED_AT] * CHANGED_FIELDS
  for (let n = 0; n < s[8]; n++, i += DRONE_FIELDS) f(s[i], i + 1, false)
  for (let n = 0; n < s[9]; n++, i += CRATE_FIELDS) f(s[i], i + 3, true)
}

const hud = (s: Int32Array) => {
  const set = (id: string, v: number) => { $(id).textContent = v.toLocaleString() }
  set('tick', s[0]); set('score', s[2]); set('picked', s[3]); set('delivered', s[4]); set('lost', s[5])
  set('powered', s[6]); set('working', s[7]); set('drones', s[8]); set('crates', s[9])
  $('stat').textContent = `${emaMs.toFixed(2)} ms per tick`
}

// Isometric projection: tile (u, v) sits at iso (32 (u - v), 16 (u + v)). screen = (iso - cam) * z.
const TH = 32
const SPRITE_ZOOM = 0.45
const LIFT = 30 // drone height above the ground, in iso pixels
const MACHINE_SCALE = 0.64 // machines leave floor between them, so the drones read

interface Sheet { img: HTMLImageElement, idle: HTMLCanvasElement, off: HTMLCanvasElement, frames: number, fw: number, cx: number, by: number, scale: number }
const loadImg = (src: string) => new Promise<HTMLImageElement>((ok, fail) => { const i = new Image(); i.onload = () => ok(i); i.onerror = fail; i.src = src })
const tint = (img: HTMLImageElement, fill: string) => {
  const c = document.createElement('canvas')
  c.width = img.width
  c.height = img.height
  const x = c.getContext('2d')!
  x.drawImage(img, 0, 0)
  x.globalCompositeOperation = 'source-atop'
  x.fillStyle = fill
  x.fillRect(0, 0, c.width, c.height)
  return c
}
const sheet = async (name: string, frames: number, cx: number, by: number, scale: number): Promise<Sheet> => {
  const img = await loadImg(`factory/${name}.png`)
  // Idle machines are dimmed so the few working ones stand out. Machines without power are red-dark.
  return { img, idle: tint(img, 'rgba(16, 20, 26, 0.74)'), off: tint(img, 'rgba(70, 12, 12, 0.7)'), frames, fw: img.width / frames, cx, by, scale: scale * MACHINE_SCALE }
}
const SHEETS = await Promise.all([
  sheet('miner', 8, 32, 80, 1),
  sheet('furnace', 7, 34, 63, 1),
  sheet('assembler', 10, 60, 103, 0.7),
  sheet('tank', 1, 52, 99, 0.56),
])
const FURNACE_COLD = await sheet('furnace-off', 7, 34, 63, 1)
const ITEMS: Record<number, HTMLImageElement> = {
  [ITEM.ORE]: await loadImg('factory/ore.png'),
  [ITEM.PLATE]: await loadImg('factory/plate.png'),
  [ITEM.GEAR]: await loadImg('factory/gear.png'),
}

/** A small pixel drone. The pack has none, so it is drawn here. Lamp green when it carries cargo. */
const droneSprite = (lamp: string) => {
  const c = document.createElement('canvas')
  c.width = 22
  c.height = 14
  const x = c.getContext('2d')!
  const px = (col: string, a: number, b: number, w = 1, h = 1) => { x.fillStyle = col; x.fillRect(a, b, w, h) }
  px('#1b1e23', 3, 4, 16, 1); px('#1b1e23', 3, 9, 16, 1)            // arms
  for (const [a, b] of [[0, 2], [15, 2], [0, 8], [15, 8]]) { px('#c9d1d9', a, b, 7, 1); px('#6e7681', a + 1, b + 1, 5, 1) } // rotors
  px('#2d333b', 6, 5, 10, 5); px('#444c56', 7, 5, 8, 1); px('#1b1e23', 6, 10, 10, 1) // body
  px(lamp, 10, 7, 2, 1)
  return c
}
const DRONE = [droneSprite('#f2c14e'), droneSprite('#7ee787')]

let ground: CanvasPattern | null = null
const groundPattern = () => {
  const c = document.createElement('canvas')
  c.width = c.height = 8
  const x = c.getContext('2d')!
  x.fillStyle = '#868b94'
  x.fillRect(0, 0, 8, 8)
  x.fillStyle = '#767b84'
  x.fillRect(0, 0, 8, 1)
  x.fillRect(0, 0, 1, 8)
  return g.createPattern(c, 'repeat')
}

// Per-tile lookups for the sprite pass, built with the map.
let tileMachine = new Int32Array(0)
let mKind = new Uint8Array(0)
let mFlags = new Uint8Array(0)

const draw = () => {
  requestAnimationFrame(draw)
  const w = view.clientWidth, h = view.clientHeight
  const dpr = devicePixelRatio
  if (view.width !== w * dpr || view.height !== h * dpr) { view.width = w * dpr; view.height = h * dpr }
  g.setTransform(dpr, 0, 0, dpr, 0, 0)
  g.fillStyle = '#0d1117'
  g.fillRect(0, 0, w, h)
  if (!map) return
  const { x: cx, y: cy, z } = cam
  const sprites = z >= SPRITE_ZOOM
  g.imageSmoothingEnabled = false
  // The ground: one pixel per tile under the iso transform, or a tiled floor when zoomed in.
  const iso = (k: number) => g.setTransform(dpr * z * 32 * k, dpr * z * 16 * k, -dpr * z * 32 * k, dpr * z * 16 * k, -dpr * cx * z, -dpr * cy * z)
  if (sprites) {
    ground ??= groundPattern()
    iso(1 / 8)
    g.fillStyle = ground!
    g.fillRect(0, 0, W * 8, H * 8)
  } else {
    iso(1)
    g.drawImage(map, 0, 0)
  }
  iso(1)
  g.strokeStyle = sprites ? 'rgba(40,44,52,0.55)' : 'rgba(139,148,158,0.35)'
  g.lineWidth = 1 / (z * 32)
  for (let dx = 0; dx <= scenario.districtsX; dx++) line(dx * DISTRICT_TILES, 0, dx * DISTRICT_TILES, H)
  for (let dy = 0; dy <= scenario.districtsY; dy++) line(0, dy * DISTRICT_TILES, W, dy * DISTRICT_TILES)
  g.setTransform(dpr, 0, 0, dpr, 0, 0)
  const toScreen = (u: number, v: number): [number, number] => [((u - v) * 32 - cx) * z, ((u + v) * 16 - cy) * z]
  const now = performance.now()

  if (sprites) {
    // Visible tile range from the four screen corners, padded for sprite height.
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity
    for (const [sx, sy] of [[0, 0], [w, 0], [0, h + 120 * z], [w, h + 120 * z]]) {
      const X = sx / z + cx, Y = sy / z + cy
      const u = (X / 32 + Y / 16) / 2, v = (Y / 16 - X / 32) / 2
      u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v)
    }
    u0 = Math.max(0, Math.floor(u0) - 1); v0 = Math.max(0, Math.floor(v0) - 1)
    u1 = Math.min(W - 1, Math.ceil(u1) + 1); v1 = Math.min(H - 1, Math.ceil(v1) + 1)
    for (let v = v0; v <= v1; v++) {
      for (let u = u0; u <= u1; u++) {
        const id = tileMachine[v * W + u]
        if (!id) continue
        const flags = mFlags[id], kind = mKind[id]
        const on = (flags & (FLAG.POWERED | FLAG.MANUAL)) !== 0
        const working = (flags & FLAG.WORKING) !== 0
        let sh = SHEETS[kind]
        let frame = 0
        if (kind === KIND.SMELTER && !working) { sh = FURNACE_COLD; frame = sh.frames - 1 }
        else if (working) frame = (Math.floor(now / 90) + id * 3) % sh.frames
        const [sx, sy] = toScreen(u + 0.5, v + 0.5)
        const s = sh.scale * z
        if (working) {
          g.fillStyle = 'rgba(255, 180, 80, 0.55)'
          g.beginPath()
          g.ellipse(sx, sy, 30 * z, 15 * z, 0, 0, Math.PI * 2)
          g.fill()
        }
        const img = !on ? sh.off : working ? sh.img : sh.idle
        g.drawImage(img, frame * sh.fw, 0, sh.fw, img.height, sx - sh.cx * s, sy + (TH / 2) * z - sh.by * s, sh.fw * s, img.height * s)
      }
    }
  }

  if (!snap) return
  const s = snap
  const interval = tickIntervalMs(speed)
  const a = interval === 0 || !prevSnap ? 1 : Math.min(1, (now - snapAt) / interval)
  const ps = prevSnap
  const lift = LIFT * z
  // Shadows first, then crates and drones, so no shadow falls on a drone.
  const movers: [number, number, number, number, boolean][] = []
  forEachMover(s, (id, at, crate) => {
    let x = s[at], y = s[at + 1]
    const p = ps ? prev.get(id) : undefined
    if (p !== undefined) { x = ps![p] + (x - ps![p]) * a; y = ps![p + 1] + (y - ps![p + 1]) * a }
    const [sx, sy] = toScreen(x / FX, y / FX)
    if (sx < -40 || sy < -40 || sx > w + 40 || sy > h + 80) return
    movers.push([sx, sy, crate ? s[at - 1] : s[at + 8], 0, crate])
  })
  if (!sprites) {
    g.fillStyle = '#ffffff'
    const r = Math.max(2, 12 * z)
    for (const [sx, sy, , , crate] of movers) if (!crate) g.fillRect(sx - r / 2, sy - r / 2, r, r)
    return
  }
  g.fillStyle = 'rgba(0,0,0,0.28)'
  for (const [sx, sy, , , crate] of movers) {
    if (crate) continue
    g.beginPath()
    g.ellipse(sx, sy, 9 * z, 4 * z, 0, 0, Math.PI * 2)
    g.fill()
  }
  for (const [sx, sy, v, , crate] of movers) {
    if (crate) {
      const img = ITEMS[v]
      const k = 0.55 * z
      g.drawImage(img, sx - 16 * k, sy - lift + 6 * z - 28 * k, 32 * k, 32 * k)
    } else {
      const img = DRONE[v > 0 ? 1 : 0]
      const k = 1.6 * z
      g.drawImage(img, sx - 11 * k, sy - lift - 7 * k, 22 * k, 14 * k)
    }
  }
}
const line = (x0: number, y0: number, x1: number, y1: number) => { g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke() }

// Camera: drag to pan, wheel to zoom around the cursor.
let drag: { x: number, y: number } | null = null
view.addEventListener('mousedown', (e) => { drag = { x: e.clientX, y: e.clientY }; view.classList.add('drag') })
window.addEventListener('mouseup', () => { drag = null; view.classList.remove('drag') })
window.addEventListener('mousemove', (e) => {
  if (!drag) return
  cam.x -= (e.clientX - drag.x) / cam.z
  cam.y -= (e.clientY - drag.y) / cam.z
  drag = { x: e.clientX, y: e.clientY }
})
view.addEventListener('wheel', (e) => {
  e.preventDefault()
  const k = Math.exp(-e.deltaY * 0.0015)
  const z = Math.min(4, Math.max(0.02, cam.z * k))
  cam.x += e.clientX / cam.z - e.clientX / z
  cam.y += e.clientY / cam.z - e.clientY / z
  cam.z = z
}, { passive: false })
window.addEventListener('keydown', (e) => { if (e.key === 'f' || e.key === 'F') fit() })

playBtn.addEventListener('click', () => {
  playing = !playing
  playBtn.textContent = playing ? 'Pause' : 'Play'
  send({ type: playing ? 'play' : 'pause' })
})
$('restart').addEventListener('click', start)
implSel.addEventListener('change', start)
scenSel.addEventListener('change', start)
for (const b of document.querySelectorAll<HTMLButtonElement>('#speed button')) {
  b.addEventListener('click', () => {
    speed = b.dataset.speed as Speed
    document.querySelectorAll('#speed button').forEach((o) => o.classList.toggle('on', o === b))
    send({ type: 'speed', speed })
  })
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

start()
draw()
