// RTS camera. Pure math, no three/DOM (except attachRtsInput at the bottom).
// World: 1 tile = 1 unit, ground = XZ plane, y up. yaw 0 looks toward -z.
// Camera sits behind `target` at `distance`, raised by `pitch` (radians above the horizon).

export interface Vec2 { x: number, z: number }
export interface Ndc { x: number, y: number }

export interface CameraLimits {
  arena: number
  minDistance: number
  maxDistance: number
  pitchNear: number
  pitchFar: number
}

export interface CameraState {
  target: Vec2
  distance: number
  yaw: number
  pitch: number
  fov: number // vertical, radians
  aspect: number // keep in sync with the viewport
  limits: CameraLimits
  goalDistance: number
  goalYaw: number | null
  focus: Vec2 | null
  vel: Vec2
  anchor: { ground: Vec2, ndc: Ndc } | null
}

export interface CameraConfig {
  edgeMargin: number // px, 0 disables edge pan
  panSpeed: number // distances per second
  panAccel: number // 1/s
  rotateSpeed: number // rad/s for Q/E
  zoomStep: number // distance factor per wheel notch
  zoomSmooth: number
  pitchSmooth: number
  focusSmooth: number
}

export const defaultConfig: CameraConfig = {
  edgeMargin: 16,
  panSpeed: 1,
  panAccel: 10,
  rotateSpeed: 1.8,
  zoomStep: 1.15,
  zoomSmooth: 12,
  pitchSmooth: 8,
  focusSmooth: 8,
}

export interface RtsInput {
  moveX: number // -1..1, right positive
  moveZ: number // -1..1, forward positive
  rotate: number // -1..1 (Q/E), positive turns yaw up
  rotateDelta: number // radians, accumulated by drag (one-shot)
  zoom: number // wheel notches, positive zooms in (one-shot)
  zoomGround: Vec2 | null // ground point under the cursor when zooming
  mouse: { x: number, y: number, w: number, h: number } | null // px inside the viewport
  grab: Vec2 | null // ground point being dragged (held while dragging)
  reset: boolean // one-shot
}

export const emptyInput = (): RtsInput => ({
  moveX: 0, moveZ: 0, rotate: 0, rotateDelta: 0, zoom: 0, zoomGround: null, mouse: null, grab: null, reset: false,
})

const rad = (d: number) => (d * Math.PI) / 180
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const ease = (rate: number, dt: number) => 1 - Math.exp(-rate * dt)

export const pitchForDistance = (d: number, l: CameraLimits) =>
  l.pitchNear + (l.pitchFar - l.pitchNear) * clamp((d - l.minDistance) / (l.maxDistance - l.minDistance), 0, 1)

export const createCamera = (): CameraState => {
  const limits = { arena: 256, minDistance: 12, maxDistance: 400, pitchNear: rad(40), pitchFar: rad(65) }
  const s: CameraState = {
    target: { x: limits.arena / 2, z: limits.arena / 2 },
    distance: 0, yaw: 0, pitch: 0, fov: rad(50), aspect: 16 / 9, limits,
    goalDistance: 0, goalYaw: null, focus: null, vel: { x: 0, z: 0 }, anchor: null,
  }
  return resetCamera(s, false)
}

const basis = (s: CameraState) => {
  const fx = -Math.sin(s.yaw), fz = -Math.cos(s.yaw)
  return { fx, fz, rx: Math.cos(s.yaw), rz: -Math.sin(s.yaw), cp: Math.cos(s.pitch), sp: Math.sin(s.pitch) }
}

// Ground point under screen ndc, relative to the target (independent of where the target is).
const groundOffset = (s: CameraState, nx: number, ny: number): Vec2 => {
  const { fx, fz, rx, rz, cp, sp } = basis(s)
  const th = Math.tan(s.fov / 2)
  const cy = s.distance * sp
  const ray = {
    x: fx * cp + rx * nx * th * s.aspect + fx * sp * ny * th,
    y: -sp + cp * ny * th,
    z: fz * cp + rz * nx * th * s.aspect + fz * sp * ny * th,
  }
  const t = -cy / Math.min(ray.y, -1e-6)
  return { x: -fx * s.distance * cp + t * ray.x, z: -fz * s.distance * cp + t * ray.z }
}

export const groundAtNdc = (s: CameraState, nx: number, ny: number): Vec2 => {
  const o = groundOffset(s, nx, ny)
  return { x: s.target.x + o.x, z: s.target.z + o.z }
}

export const ndcOfGround = (s: CameraState, x: number, z: number): Ndc => {
  const { fx, fz, rx, rz, cp, sp } = basis(s)
  const th = Math.tan(s.fov / 2)
  const rel = { x: x - s.target.x + fx * s.distance * cp, y: -s.distance * sp, z: z - s.target.z + fz * s.distance * cp }
  const depth = rel.x * fx * cp + rel.y * -sp + rel.z * fz * cp
  const right = rel.x * rx + rel.z * rz
  const up = rel.x * fx * sp + rel.y * cp + rel.z * fz * sp
  return { x: right / (depth * th * s.aspect), y: up / (depth * th) }
}

export const cameraPose = (s: CameraState) => {
  const { fx, fz, cp, sp } = basis(s)
  return {
    position: { x: s.target.x - fx * s.distance * cp, y: s.distance * sp, z: s.target.z - fz * s.distance * cp },
    lookAt: { x: s.target.x, y: 0, z: s.target.z },
  }
}

const clampTarget = (s: CameraState, v: Vec2) => {
  v.x = clamp(v.x, 0, s.limits.arena)
  v.z = clamp(v.z, 0, s.limits.arena)
}

export const focusOn = (s: CameraState, x: number, z: number) => {
  s.focus = { x, z }
  clampTarget(s, s.focus)
  s.anchor = null
}

// Smallest distance at which all four arena corners fit (yaw 0, centred).
const homeDistance = (s: CameraState) => {
  const l = s.limits
  const probe = { ...s, yaw: 0, target: { x: l.arena / 2, z: l.arena / 2 }, distance: 0, pitch: 0 }
  for (let d = l.minDistance; d < l.maxDistance; d *= 1.02) {
    probe.distance = d
    probe.pitch = pitchForDistance(d, l)
    const fits = [[0, 0], [l.arena, 0], [0, l.arena], [l.arena, l.arena]].every(([x, z]) => {
      const n = ndcOfGround(probe, x, z)
      return Math.abs(n.x) <= 0.95 && Math.abs(n.y) <= 0.95
    })
    if (fits) return d
  }
  return l.maxDistance
}

// animate=false snaps (used for the initial state); true glides.
export const resetCamera = (s: CameraState, animate = true) => {
  const c = s.limits.arena / 2
  const d = homeDistance(s)
  s.anchor = null
  s.goalDistance = d
  if (animate) {
    focusOn(s, c, c)
    s.goalYaw = s.yaw - Math.atan2(Math.sin(s.yaw), Math.cos(s.yaw))
  } else {
    s.focus = null
    s.goalYaw = null
    s.target = { x: c, z: c }
    s.yaw = 0
    s.distance = d
    s.pitch = pitchForDistance(d, s.limits)
    s.vel = { x: 0, z: 0 }
  }
  return s
}

// Mutates `s`. Consumes the one-shot fields of `input` (zoom, rotateDelta, reset).
export const updateCamera = (s: CameraState, dt: number, input: RtsInput, cfgIn: Partial<CameraConfig> = {}) => {
  const cfg = { ...defaultConfig, ...cfgIn }
  const l = s.limits

  if (input.reset) resetCamera(s, true)

  // rotate
  const dyaw = input.rotate * cfg.rotateSpeed * dt + input.rotateDelta
  if (dyaw !== 0) { s.yaw += dyaw; s.goalYaw = null }
  else if (s.goalYaw !== null) s.yaw += (s.goalYaw - s.yaw) * ease(cfg.focusSmooth, dt)

  // zoom: ground point under the cursor is pinned to its screen position until settled
  if (input.zoom !== 0) {
    s.goalDistance = clamp(s.goalDistance / Math.pow(cfg.zoomStep, input.zoom), l.minDistance, l.maxDistance)
    if (input.zoomGround) {
      s.anchor = { ground: { ...input.zoomGround }, ndc: ndcOfGround(s, input.zoomGround.x, input.zoomGround.z) }
      s.focus = null
    }
  }
  s.distance += (s.goalDistance - s.distance) * ease(cfg.zoomSmooth, dt)
  const goalPitch = pitchForDistance(s.distance, l)
  s.pitch += (goalPitch - s.pitch) * ease(cfg.pitchSmooth, dt)

  // pan intent: keys + screen edge
  let mx = input.moveX, mz = input.moveZ
  const m = input.mouse
  if (m && !input.grab && cfg.edgeMargin > 0 && m.x >= 0 && m.x <= m.w && m.y >= 0 && m.y <= m.h) {
    mx += m.x < cfg.edgeMargin ? -1 : m.x > m.w - cfg.edgeMargin ? 1 : 0
    mz += m.y < cfg.edgeMargin ? 1 : m.y > m.h - cfg.edgeMargin ? -1 : 0
  }
  const len = Math.hypot(mx, mz)
  if (len > 1) { mx /= len; mz /= len }

  if (input.grab && m) {
    const o = groundOffset(s, (m.x / m.w) * 2 - 1, 1 - (m.y / m.h) * 2)
    s.target = { x: input.grab.x - o.x, z: input.grab.z - o.z }
    s.vel = { x: 0, z: 0 }
    s.focus = null
    s.anchor = null
  } else {
    if (len > 0) { s.focus = null; s.anchor = null }
    const { fx, fz, rx, rz } = basis(s)
    const speed = cfg.panSpeed * s.distance
    const k = ease(cfg.panAccel, dt)
    s.vel.x += ((mx * rx + mz * fx) * speed - s.vel.x) * k
    s.vel.z += ((mx * rz + mz * fz) * speed - s.vel.z) * k
    if (s.focus) {
      const f = ease(cfg.focusSmooth, dt)
      s.target.x += (s.focus.x - s.target.x) * f
      s.target.z += (s.focus.z - s.target.z) * f
      s.vel = { x: 0, z: 0 }
      if (Math.hypot(s.focus.x - s.target.x, s.focus.z - s.target.z) < 1e-4) s.focus = null
    } else {
      s.target.x += s.vel.x * dt
      s.target.z += s.vel.z * dt
    }
    if (s.anchor) {
      const o = groundOffset(s, s.anchor.ndc.x, s.anchor.ndc.y)
      s.target = { x: s.anchor.ground.x - o.x, z: s.anchor.ground.z - o.z }
      if (Math.abs(s.distance - s.goalDistance) < 1e-3 && Math.abs(s.pitch - goalPitch) < 1e-5) s.anchor = null
    }
  }
  const before = { ...s.target }
  clampTarget(s, s.target)
  if (s.target.x !== before.x) s.vel.x = 0
  if (s.target.z !== before.z) s.vel.z = 0

  input.zoom = 0
  input.rotateDelta = 0
  input.reset = false
}

// --- DOM glue (untested) ---
// Fills `input` from events; call updateCamera(state, dt, input) each frame. Returns detach.
export const attachRtsInput = (el: HTMLElement, s: CameraState, input: RtsInput = emptyInput()) => {
  const keys = new Set<string>()
  const held = (...codes: string[]) => (codes.some(c => keys.has(c)) ? 1 : 0)
  const sync = () => {
    input.moveX = held('KeyD', 'ArrowRight') - held('KeyA', 'ArrowLeft')
    input.moveZ = held('KeyW', 'ArrowUp') - held('KeyS', 'ArrowDown')
    input.rotate = held('KeyE') - held('KeyQ')
  }
  const ndc = () => {
    const m = input.mouse
    return m ? { x: (m.x / m.w) * 2 - 1, y: 1 - (m.y / m.h) * 2 } : { x: 0, y: 0 }
  }
  let rotating = false
  const on = <E extends Event>(t: EventTarget, type: string, fn: (e: E) => void, opts?: AddEventListenerOptions) => {
    t.addEventListener(type, fn as EventListener, opts)
    return () => t.removeEventListener(type, fn as EventListener, opts)
  }
  const offs = [
    on<KeyboardEvent>(window, 'keydown', e => {
      if (e.code === 'Home' || e.code === 'KeyF') input.reset = true
      keys.add(e.code); sync()
    }),
    on<KeyboardEvent>(window, 'keyup', e => { keys.delete(e.code); sync() }),
    on(window, 'blur', () => { keys.clear(); sync(); input.grab = null; rotating = false }),
    on<MouseEvent>(el, 'mousemove', e => {
      const r = el.getBoundingClientRect()
      input.mouse = { x: e.clientX - r.left, y: e.clientY - r.top, w: r.width, h: r.height }
      s.aspect = r.width / r.height
      if (rotating) input.rotateDelta += e.movementX * 0.005
    }),
    on(el, 'mouseleave', () => { input.mouse = null }),
    on<MouseEvent>(el, 'mousedown', e => {
      if (e.button === 2 && input.mouse) { const n = ndc(); input.grab = groundAtNdc(s, n.x, n.y) }
      if (e.button === 1) { rotating = true; e.preventDefault() }
    }),
    on<MouseEvent>(window, 'mouseup', e => {
      if (e.button === 2) input.grab = null
      if (e.button === 1) rotating = false
    }),
    on<WheelEvent>(el, 'wheel', e => {
      e.preventDefault()
      const n = ndc()
      input.zoom += clamp(-e.deltaY / 100, -3, 3)
      input.zoomGround = groundAtNdc(s, n.x, n.y)
    }, { passive: false }),
    on(el, 'contextmenu', e => e.preventDefault()),
  ]
  return () => offs.forEach(off => off())
}
