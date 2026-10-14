import * as THREE from 'three'
import { kernel } from '@ecs-arena/spec'
import { AnimTracker, type Actor, type Anim } from './anim.ts'
import { attachRtsInput, cameraPose, createCamera, emptyInput, updateCamera, type CameraState } from './camera.ts'
import { alphaOf, PosTrack } from './interp.ts'
import type { Snapshot, Unit } from './snapshot.ts'

const FX = kernel.FX
const FRAME = 100
const SPRITE_FPS = 10
const SPRITE_SIZE = 5.5
const FEET = 0.42
const SETS = ['Soldier', 'Orc', 'Demon_A', 'Blood_Monster_A'] as const
type SetName = (typeof SETS)[number]
const STRIPS = ['Idle', 'Walk', 'Attack01', 'Hurt', 'Death'] as const
const ROW: Record<Anim, number> = { Idle: 0, Walk: 1, Attack: 2, Hurt: 3, Death: 4 }
const TEAM_RGB = [[0.25, 0.55, 1], [1, 0.3, 0.3]] as const
const OWNER_HEX = [0x3b82f6, 0xef4444]
const NEUTRAL_HEX = 0x8a8f98
const ICON = { sword: 0, bow: 1, star: 2, cross: 3, circle: 4, diamond: 5 }
const ROLE_ICON = [ICON.sword, ICON.bow, ICON.star, ICON.cross, ICON.circle]
const ICON_CELLS = 6

const VERT = `
attribute vec3 aPos;
attribute vec2 aCell;
attribute vec2 aParams;
attribute vec4 aTint;
uniform vec2 uGrid;
uniform float uMode;
uniform float uAnchor;
varying vec2 vUv;
varying vec4 vTint;
void main() {
  vec2 q = position.xy;
  vUv = (aCell + vec2(q.x, 1.0 - q.y)) / uGrid;
  vTint = aTint;
  float size = aParams.x;
  vec3 world;
  if (uMode > 0.5) {
    vec3 right = normalize(vec3(viewMatrix[0][0], 0.0, viewMatrix[2][0]));
    world = aPos + right * (q.x - 0.5) * size * aParams.y * (right.x < 0.0 ? -1.0 : 1.0) + vec3(0.0, 1.0, 0.0) * (q.y - uAnchor) * size;
  } else {
    float c = cos(aParams.y);
    float s = sin(aParams.y);
    vec2 o = (q - 0.5) * size;
    world = aPos + vec3(o.x * c - o.y * s, 0.0, o.x * s + o.y * c);
  }
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}`

const FRAG = `
uniform sampler2D uTex;
uniform float uCut;
varying vec2 vUv;
varying vec4 vTint;
void main() {
  vec4 t = texture2D(uTex, vUv);
  if (t.a < uCut) discard;
  gl_FragColor = vec4(mix(t.rgb, vTint.rgb, vTint.a), t.a);
}`

const STRIDE = 11

/** One instanced quad draw call. Instance data lives in one interleaved buffer that doubles when full. */
class QuadLayer {
  readonly mesh: THREE.Mesh
  count = 0
  private geo = new THREE.InstancedBufferGeometry()
  private data = new Float32Array(1024 * STRIDE)
  private buf!: THREE.InstancedInterleavedBuffer

  constructor(texture: THREE.Texture, grid: [number, number], billboard: boolean, opts: { anchor?: number, cut: number, blend?: THREE.Blending, transparent: boolean, renderOrder: number }) {
    this.geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]), 3))
    this.geo.setIndex([0, 1, 2, 0, 2, 3])
    this.bind()
    const material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        uTex: { value: texture },
        uGrid: { value: new THREE.Vector2(...grid) },
        uMode: { value: billboard ? 1 : 0 },
        uAnchor: { value: opts.anchor ?? 0.5 },
        uCut: { value: opts.cut },
      },
      transparent: opts.transparent,
      depthWrite: !opts.transparent,
      blending: opts.blend ?? THREE.NormalBlending,
      side: THREE.DoubleSide,
    })
    this.mesh = new THREE.Mesh(this.geo, material)
    this.mesh.frustumCulled = false
    this.mesh.renderOrder = opts.renderOrder
  }

  private bind() {
    this.buf = new THREE.InstancedInterleavedBuffer(this.data, STRIDE, 1)
    this.buf.setUsage(THREE.DynamicDrawUsage)
    this.geo.setAttribute('aPos', new THREE.InterleavedBufferAttribute(this.buf, 3, 0))
    this.geo.setAttribute('aCell', new THREE.InterleavedBufferAttribute(this.buf, 2, 3))
    this.geo.setAttribute('aParams', new THREE.InterleavedBufferAttribute(this.buf, 2, 5))
    this.geo.setAttribute('aTint', new THREE.InterleavedBufferAttribute(this.buf, 4, 7))
  }

  begin() { this.count = 0 }

  push(x: number, y: number, z: number, cx: number, cy: number, size: number, p: number, r: number, g: number, b: number, a: number) {
    if ((this.count + 1) * STRIDE > this.data.length) {
      const bigger = new Float32Array(this.data.length * 2)
      bigger.set(this.data)
      this.data = bigger
      this.geo.dispose()
      this.bind()
    }
    const d = this.data
    let o = this.count++ * STRIDE
    d[o++] = x; d[o++] = y; d[o++] = z; d[o++] = cx; d[o++] = cy; d[o++] = size; d[o++] = p
    d[o++] = r; d[o++] = g; d[o++] = b; d[o] = a
  }

  end() {
    this.geo.instanceCount = this.count
    this.buf.clearUpdateRanges()
    this.buf.addUpdateRange(0, this.count * STRIDE)
    this.buf.needsUpdate = true
    this.mesh.visible = this.count > 0
  }
}

const loadImage = (url: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`failed to load ${url}`))
    img.src = url
  })

const canvasTexture = (c: HTMLCanvasElement, srgb = false) => {
  const t = new THREE.CanvasTexture(c)
  t.flipY = false
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace
  return t
}

const makeCanvas = (w: number, h: number) => {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return { c, g: c.getContext('2d')! }
}

const nearest = (t: THREE.Texture) => {
  t.magFilter = THREE.NearestFilter
  t.minFilter = THREE.NearestFilter
  t.generateMipmaps = false
  return t
}

interface SpriteSet { texture: THREE.Texture, frames: number[], cols: number }

const buildSet = async (name: SetName): Promise<SpriteSet> => {
  const imgs = await Promise.all(STRIPS.map((s) => loadImage(`sprites/${name}_${s}.png`)))
  const frames = imgs.map((i) => i.width / FRAME)
  const cols = Math.max(...frames)
  const { c, g } = makeCanvas(cols * FRAME, STRIPS.length * FRAME)
  imgs.forEach((img, row) => g.drawImage(img, 0, row * FRAME))
  return { texture: nearest(canvasTexture(c)), frames, cols }
}

const iconAtlas = () => {
  const S = 64
  const { c, g } = makeCanvas(S * ICON_CELLS, S)
  g.fillStyle = '#fff'
  g.strokeStyle = '#fff'
  g.lineWidth = 6
  g.lineCap = 'round'
  const at = (i: number, fn: () => void) => { g.save(); g.translate(i * S + S / 2, S / 2); fn(); g.restore() }
  at(ICON.sword, () => { g.fillRect(-4, -26, 8, 38); g.fillRect(-14, 8, 28, 6); g.fillRect(-3, 14, 6, 10) })
  at(ICON.bow, () => {
    g.beginPath(); g.arc(-6, 0, 24, -Math.PI / 2.2, Math.PI / 2.2); g.stroke()
    g.beginPath(); g.moveTo(-6, -22); g.lineTo(-6, 22); g.lineWidth = 2; g.stroke()
    g.beginPath(); g.moveTo(-14, 0); g.lineTo(26, 0); g.lineWidth = 4; g.stroke()
  })
  at(ICON.star, () => {
    g.beginPath()
    for (let k = 0; k < 10; k++) {
      const r = k % 2 ? 11 : 26, a = (k * Math.PI) / 5 - Math.PI / 2
      g.lineTo(Math.cos(a) * r, Math.sin(a) * r)
    }
    g.closePath(); g.fill()
  })
  at(ICON.cross, () => { g.fillRect(-7, -24, 14, 48); g.fillRect(-24, -7, 48, 14) })
  at(ICON.circle, () => { g.beginPath(); g.arc(0, 0, 20, 0, Math.PI * 2); g.fill() })
  at(ICON.diamond, () => { g.beginPath(); g.moveTo(0, -26); g.lineTo(18, 0); g.lineTo(0, 26); g.lineTo(-18, 0); g.closePath(); g.fill() })
  return canvasTexture(c)
}

const ringTexture = () => {
  const { c, g } = makeCanvas(128, 128)
  g.strokeStyle = '#fff'
  g.lineWidth = 12
  g.beginPath(); g.arc(64, 64, 56, 0, Math.PI * 2); g.stroke()
  return canvasTexture(c)
}

const glowTexture = () => {
  const { c, g } = makeCanvas(64, 64)
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32)
  grad.addColorStop(0, 'rgba(255,255,255,1)')
  grad.addColorStop(0.35, 'rgba(255,255,255,0.5)')
  grad.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = grad
  g.fillRect(0, 0, 64, 64)
  return canvasTexture(c)
}

const groundTexture = () => {
  const TILE = 8
  const N = kernel.ARENA_TILES
  const { c, g } = makeCanvas(N * TILE, N * TILE)
  let seed = 12345
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296)
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const v = rnd()
      g.fillStyle = `rgb(${46 + v * 14 | 0},${78 + v * 22 | 0},${40 + v * 10 | 0})`
      g.fillRect(x * TILE, y * TILE, TILE, TILE)
    }
  }
  g.fillStyle = 'rgba(0,0,0,0.07)'
  for (let i = 0; i <= N; i++) { g.fillRect(i * TILE, 0, 1, N * TILE); g.fillRect(0, i * TILE, N * TILE, 1) }
  g.fillStyle = 'rgba(255,255,255,0.12)'
  for (let i = 0; i <= N; i += 32) { g.fillRect(i * TILE - 1, 0, 2, N * TILE); g.fillRect(0, i * TILE - 1, N * TILE, 2) }
  return canvasTexture(c, true)
}

const setOf = (u: Unit): SetName => (u.kind === 8 ? 'Demon_A' : u.kind === 5 ? 'Blood_Monster_A' : u.team === 0 ? 'Soldier' : 'Orc')
const SET_INDEX: Record<SetName, number> = { Soldier: 0, Orc: 1, Demon_A: 2, Blood_Monster_A: 3 }
const sizeOf = (u: Unit) => (u.kind === 8 ? SPRITE_SIZE * 1.6 : u.kind === 5 ? SPRITE_SIZE * 0.8 : SPRITE_SIZE)

const tint = [0, 0, 0, 0]
const setTint = (u: Unit) => {
  const t = tint
  t[3] = 0
  if (u.flags & 2) { t[0] = 1; t[1] = 0.82; t[2] = 0.25; t[3] = 0.35 }
  if (u.flags & 5) { t[0] = 0.82; t[1] = 0.82; t[2] = 0.9; t[3] = 0.6 }
  for (let i = 0; i < u.buffs.length; i++) {
    const k = u.buffs[i].kind
    if (k === 0) { t[0] = 1; t[1] = 1; t[2] = 0.3; t[3] = 0.5 }
    else if (k === 1) { t[0] = 1; t[1] = 0.45; t[2] = 0.1; t[3] = 0.5 }
  }
}

export interface Viewer {
  camera: CameraState
  push(snap: Snapshot): void
  setTickIntervalMs(ms: number): void
  reset(): void
}

export const createViewer = async (canvas: HTMLCanvasElement): Promise<Viewer> => {
  const gl = new THREE.WebGLRenderer({ canvas, antialias: true })
  gl.setPixelRatio(Math.min(devicePixelRatio, 2))
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0x0d1117)
  const cam = new THREE.PerspectiveCamera(50, 1, 1, 2000)
  const camState = createCamera()
  const input = emptyInput()
  attachRtsInput(canvas, camState, input)

  const resize = () => {
    const w = canvas.clientWidth, h = canvas.clientHeight
    gl.setSize(w, h, false)
    camState.aspect = cam.aspect = w / h
    cam.updateProjectionMatrix()
  }
  new ResizeObserver(resize).observe(canvas)
  resize()

  scene.add(new THREE.AmbientLight(0xffffff, 1.4))
  const sun = new THREE.DirectionalLight(0xffffff, 1.6)
  sun.position.set(-30, 60, 20)
  scene.add(sun)

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(kernel.ARENA_TILES, kernel.ARENA_TILES).rotateX(-Math.PI / 2).translate(128, 0, 128),
    new THREE.MeshBasicMaterial({ map: groundTexture(), polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 2 }),
  )
  ground.material.map!.anisotropy = gl.capabilities.getMaxAnisotropy()
  scene.add(ground)

  const sets = await Promise.all(SETS.map(buildSet))
  const sprites = sets.map((s, i) => new QuadLayer(s.texture, [s.cols, STRIPS.length], true, { anchor: FEET, cut: 0.5, transparent: false, renderOrder: 1 + i }))
  const arrowTex = nearest(new THREE.Texture(await loadImage('sprites/Arrow01.png')))
  arrowTex.flipY = false
  arrowTex.needsUpdate = true
  const overlay = { transparent: true, cut: 0.05 }
  const rings = new QuadLayer(ringTexture(), [1, 1], false, { ...overlay, renderOrder: 0 })
  const arrows = new QuadLayer(arrowTex, [1, 1], false, { cut: 0.5, transparent: false, renderOrder: 6 })
  const icons = new QuadLayer(iconAtlas(), [ICON_CELLS, 1], true, { ...overlay, renderOrder: 7 })
  const glows = new QuadLayer(glowTexture(), [1, 1], true, { ...overlay, cut: 0.01, blend: THREE.AdditiveBlending, renderOrder: 8 })
  const layers = [...sprites, rings, arrows, icons, glows]
  layers.forEach((l) => scene.add(l.mesh))

  const shrines = Array.from({ length: kernel.SHRINE_COUNT }, (_, i) => {
    const g = new THREE.Group()
    const base = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.8, 0.6, 8), new THREE.MeshLambertMaterial({ color: NEUTRAL_HEX }))
    base.position.y = 0.3
    const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(1.1), new THREE.MeshLambertMaterial({ color: NEUTRAL_HEX, emissive: 0x000000 }))
    crystal.scale.y = 1.7
    crystal.position.y = 2.6
    g.add(base, crystal)
    g.position.set(kernel.SHRINE_X / FX, 0, kernel.shrineY(i) / FX)
    scene.add(g)
    return { crystal, base }
  })

  let tracker: AnimTracker
  const units = new PosTrack()
  const projs = new PosTrack()
  let snap: Snapshot | null = null
  let actors: Actor[] = []
  let snapAt = 0
  let intervalMs = 100
  const reset = () => {
    tracker = new AnimTracker((u) => sets[SET_INDEX[setOf(u)]].frames[ROW.Death])
    units.reset()
    projs.reset()
    snap = null
    actors = []
  }
  reset()

  const p = { x: 0, y: 0 }
  const q = { x: 0, y: 0 }
  let lastT = performance.now()
  const frame = (now: number) => {
    requestAnimationFrame(frame)
    const dt = Math.min(0.1, (now - lastT) / 1000)
    lastT = now
    updateCamera(camState, dt, input)
    const pose = cameraPose(camState)
    cam.fov = (camState.fov * 180) / Math.PI
    cam.position.set(pose.position.x, pose.position.y, pose.position.z)
    cam.lookAt(pose.lookAt.x, pose.lookAt.y, pose.lookAt.z)
    cam.updateProjectionMatrix()

    layers.forEach((l) => l.begin())
    const alpha = alphaOf(now - snapAt, intervalMs)
    const spriteFrame = Math.floor(now / (1000 / SPRITE_FPS))
    if (snap) {
      for (let i = 0; i < actors.length; i++) {
        const a = actors[i], u = a.unit
        units.at(i, alpha, p)
        const x = p.x / FX, z = p.y / FX
        const si = SET_INDEX[setOf(u)]
        const row = ROW[a.anim]
        const n = sets[si].frames[row]
        const col = a.anim === 'Death' ? Math.min(a.frame, n - 1) : spriteFrame % n
        setTint(u)
        sprites[si].push(x, 0, z, col, row, sizeOf(u), a.facing, tint[0], tint[1], tint[2], tint[3])
        if (a.anim === 'Death') continue
        const c = TEAM_RGB[u.team] ?? TEAM_RGB[0]
        rings.push(x, 0.05, z, 0, 0, u.kind === 8 ? 2.4 : 1.3, 0, c[0], c[1], c[2], 1)
        if (u.kind <= 4) icons.push(x, 2.1, z, ROLE_ICON[u.kind], 0, 0.8, 1, c[0], c[1], c[2], 1)
      }
      for (let i = 0; i < snap.projectiles.length; i++) {
        const pr = snap.projectiles[i]
        projs.at(i, alpha, p)
        const x = p.x / FX, z = p.y / FX
        if (pr.volley === 1) {
          projs.at(i, 0, p)
          projs.at(i, 1, q)
          const rot = Math.atan2(q.y - p.y, q.x - p.x)
          arrows.push(x, 1, z, 0, 0, 4, rot, 0, 0, 0, 0)
        } else glows.push(x, 1, z, 0, 0, 1.4, 1, 0.6, 0.4, 1, 1)
      }
      for (const it of snap.groundItems) icons.push(it.x / FX, 0.5, it.y / FX, ICON.diamond, 0, 0.6, 1, 1, 0.85, 0.1, 1)
      for (let i = 0; i < snap.shrines.length; i++) {
        const s = snap.shrines[i]
        const x = kernel.SHRINE_X / FX, z = kernel.shrineY(i) / FX
        const c = s.owner < 0 ? [0.55, 0.56, 0.6] : TEAM_RGB[s.owner]
        rings.push(x, 0.06, z, 0, 0, (kernel.SHRINE_RADIUS * 2) / FX, 0, c[0], c[1], c[2], 1)
        const pc = TEAM_RGB[s.progress >= 0 ? 0 : 1]
        rings.push(x, 0.07, z, 0, 0, (Math.abs(s.progress) / kernel.SHRINE_PROGRESS_MAX) * 8, 0, pc[0], pc[1], pc[2], 1)
      }
    }
    layers.forEach((l) => l.end())
    shrines.forEach((s, i) => { s.crystal.rotation.y = now / 1500 + i })
    gl.render(scene, cam)
  }
  requestAnimationFrame(frame)

  return {
    camera: camState,
    push(s) {
      snap = s
      actors = tracker.update(s)
      units.update(actors, (a) => a.unit)
      projs.update(s.projectiles, (pr) => pr)
      snapAt = performance.now()
      s.shrines.forEach((sh, i) => {
        const hex = sh.owner < 0 ? NEUTRAL_HEX : OWNER_HEX[sh.owner]
        const t = shrines[i]
        ;(t.base.material as THREE.MeshLambertMaterial).color.setHex(hex)
        const m = t.crystal.material as THREE.MeshLambertMaterial
        m.color.setHex(hex)
        m.emissive.setHex(sh.owner < 0 ? 0x000000 : hex).multiplyScalar(0.5)
      })
    },
    setTickIntervalMs(ms) { intervalMs = ms },
    reset,
  }
}
