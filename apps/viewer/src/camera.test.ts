import { describe, expect, it } from 'vitest'
import {
  cameraPose,
  createCamera,
  emptyInput,
  focusOn,
  groundAtNdc,
  ndcOfGround,
  pitchForDistance,
  resetCamera,
  updateCamera,
  type CameraState,
  type RtsInput,
} from './camera'

const DT = 1 / 60
const run = (s: CameraState, frames: number, make: () => Partial<RtsInput> = () => ({})) => {
  for (let i = 0; i < frames; i++) updateCamera(s, DT, { ...emptyInput(), ...make() })
}
const cam = (o: Partial<CameraState> = {}) => {
  const s = createCamera()
  Object.assign(s, o)
  s.goalDistance = s.distance
  return s
}

describe('pan', () => {
  it('forward moves toward -z at yaw 0 and right toward +x', () => {
    const s = cam({ target: { x: 128, z: 128 } })
    run(s, 60, () => ({ moveZ: 1 }))
    expect(s.target.z).toBeLessThan(128)
    expect(s.target.x).toBeCloseTo(128, 6)
    const r = cam({ target: { x: 128, z: 128 } })
    run(r, 60, () => ({ moveX: 1 }))
    expect(r.target.x).toBeGreaterThan(128)
    expect(r.target.z).toBeCloseTo(128, 6)
  })

  it('respects yaw: forward at yaw 90deg moves toward -x', () => {
    const s = cam({ target: { x: 128, z: 128 }, yaw: Math.PI / 2 })
    run(s, 60, () => ({ moveZ: 1 }))
    expect(s.target.x).toBeLessThan(128)
    expect(s.target.z).toBeCloseTo(128, 6)
  })

  it('diagonal is not faster than straight', () => {
    const a = cam({ target: { x: 128, z: 128 }, distance: 40 })
    const b = cam({ target: { x: 128, z: 128 }, distance: 40 })
    run(a, 60, () => ({ moveZ: 1 }))
    run(b, 60, () => ({ moveZ: 1, moveX: 1 }))
    const da = Math.hypot(a.target.x - 128, a.target.z - 128)
    const db = Math.hypot(b.target.x - 128, b.target.z - 128)
    expect(db).toBeCloseTo(da, 6)
  })

  it('speed scales with distance', () => {
    const near = cam({ target: { x: 128, z: 128 }, distance: 30 })
    const far = cam({ target: { x: 128, z: 128 }, distance: 120 })
    run(near, 30, () => ({ moveX: 1 }))
    run(far, 30, () => ({ moveX: 1 }))
    expect((far.target.x - 128) / (near.target.x - 128)).toBeCloseTo(4, 3)
  })

  it('accelerates smoothly and damps to a stop', () => {
    const s = cam({ target: { x: 20, z: 128 }, distance: 30 })
    updateCamera(s, DT, { ...emptyInput(), moveX: 1 })
    const first = s.target.x - 20
    run(s, 120, () => ({ moveX: 1 }))
    const x0 = s.target.x
    run(s, 1, () => ({ moveX: 1 }))
    const steady = s.target.x - x0
    expect(first).toBeLessThan(steady * 0.5)
    run(s, 300)
    const stop = s.target.x
    run(s, 10)
    expect(s.target.x).toBeCloseTo(stop, 4)
    expect(stop).toBeGreaterThan(x0)
  })

  it('clamps the target to the arena', () => {
    const s = cam({ target: { x: 250, z: 5 } })
    run(s, 600, () => ({ moveX: 1, moveZ: 1 }))
    expect(s.target.x).toBe(256)
    expect(s.target.z).toBe(0)
  })
})

describe('edge pan', () => {
  const at = (x: number, y: number) => ({ mouse: { x, y, w: 800, h: 600 } })
  it('pans when the mouse is in the margin', () => {
    const s = cam({ target: { x: 128, z: 128 } })
    run(s, 30, () => at(2, 300))
    expect(s.target.x).toBeLessThan(128)
    const t = cam({ target: { x: 128, z: 128 } })
    run(t, 30, () => at(400, 1))
    expect(t.target.z).toBeLessThan(128)
  })
  it('does nothing in the middle, when disabled, or with no mouse', () => {
    const a = cam({ target: { x: 128, z: 128 } })
    run(a, 30, () => at(400, 300))
    expect(a.target).toEqual({ x: 128, z: 128 })
    const b = cam({ target: { x: 128, z: 128 } })
    for (let i = 0; i < 30; i++) updateCamera(b, DT, { ...emptyInput(), ...at(2, 300) }, { edgeMargin: 0 })
    expect(b.target).toEqual({ x: 128, z: 128 })
    const c = cam({ target: { x: 128, z: 128 } })
    run(c, 30)
    expect(c.target).toEqual({ x: 128, z: 128 })
  })
})

describe('zoom and pitch', () => {
  it('pitch interpolates from ~40deg near to ~65deg far', () => {
    const s = createCamera()
    const deg = (d: number) => (pitchForDistance(d, s.limits) * 180) / Math.PI
    expect(deg(s.limits.minDistance)).toBeCloseTo(40, 6)
    expect(deg(s.limits.maxDistance)).toBeCloseTo(65, 6)
    expect(deg((s.limits.minDistance + s.limits.maxDistance) / 2)).toBeCloseTo(52.5, 6)
    expect(deg(1)).toBeCloseTo(40, 6)
    expect(deg(1e6)).toBeCloseTo(65, 6)
  })

  it('zoom is clamped, smoothed, and pitch eases to match', () => {
    const s = cam({ distance: 100 })
    updateCamera(s, DT, { ...emptyInput(), zoom: 2, zoomGround: { x: 128, z: 128 } })
    expect(s.distance).toBeLessThan(100)
    expect(s.distance).toBeGreaterThan(s.goalDistance)
    run(s, 600, () => ({ zoom: 50 }))
    expect(s.distance).toBeCloseTo(s.limits.minDistance, 3)
    expect(s.pitch).toBeCloseTo(pitchForDistance(s.distance, s.limits), 3)
    run(s, 600, () => ({ zoom: -50 }))
    expect(s.distance).toBeCloseTo(s.limits.maxDistance, 3)
    expect(s.pitch).toBeCloseTo(pitchForDistance(s.distance, s.limits), 3)
  })

  it('consumes one-shot input fields', () => {
    const s = cam()
    const input = { ...emptyInput(), zoom: 1, rotateDelta: 1, reset: true, zoomGround: { x: 1, z: 1 } }
    updateCamera(s, DT, input)
    expect(input.zoom).toBe(0)
    expect(input.rotateDelta).toBe(0)
    expect(input.reset).toBe(false)
  })

  for (const [name, notches, yaw] of [['in', 3, 0], ['out', -3, 0.7], ['in rotated', 5, -1.2]] as const) {
    it(`zoom ${name} keeps the cursor ground point fixed after settling`, () => {
      const s = cam({ target: { x: 100, z: 120 }, distance: 80, yaw })
      s.pitch = pitchForDistance(80, s.limits)
      const ndc = { x: 0.5, y: -0.3 }
      const g = groundAtNdc(s, ndc.x, ndc.y)
      let first = true
      run(s, 400, () => {
        const z = first ? { zoom: notches, zoomGround: g } : {}
        first = false
        return z
      })
      expect(s.distance).not.toBeCloseTo(80, 0)
      const back = ndcOfGround(s, g.x, g.z)
      expect(back.x).toBeCloseTo(ndc.x, 3)
      expect(back.y).toBeCloseTo(ndc.y, 3)
    })
  }
})

describe('projection helpers', () => {
  it('screen centre is the target and ndc round-trips', () => {
    const s = cam({ target: { x: 90, z: 70 }, yaw: 0.4 })
    s.pitch = 0.9
    const c = groundAtNdc(s, 0, 0)
    expect(c.x).toBeCloseTo(90, 6)
    expect(c.z).toBeCloseTo(70, 6)
    const g = groundAtNdc(s, -0.6, 0.4)
    const n = ndcOfGround(s, g.x, g.z)
    expect(n.x).toBeCloseTo(-0.6, 6)
    expect(n.y).toBeCloseTo(0.4, 6)
  })
})

describe('rotate', () => {
  it('Q/E and drag change yaw', () => {
    const s = cam({ yaw: 0 })
    run(s, 30, () => ({ rotate: 1 }))
    const e = s.yaw
    expect(e).not.toBe(0)
    run(s, 30, () => ({ rotate: -1 }))
    expect(s.yaw).toBeCloseTo(0, 6)
    updateCamera(s, DT, { ...emptyInput(), rotateDelta: 0.5 })
    expect(s.yaw).toBeCloseTo(0.5, 6)
  })
})

describe('grab pan', () => {
  it('keeps the grabbed ground point under the cursor', () => {
    const s = cam({ target: { x: 128, z: 128 }, distance: 90, yaw: 0.6 })
    s.pitch = pitchForDistance(90, s.limits)
    const a = { x: 0.2, y: -0.4 }
    const grab = groundAtNdc(s, a.x, a.y)
    const b = { x: -0.5, y: 0.3 }
    updateCamera(s, DT, { ...emptyInput(), grab, mouse: { x: ((b.x + 1) / 2) * 800, y: ((1 - b.y) / 2) * 600, w: 800, h: 600 } })
    const g = groundAtNdc(s, b.x, b.y)
    expect(g.x).toBeCloseTo(grab.x, 6)
    expect(g.z).toBeCloseTo(grab.z, 6)
    expect(s.target.x).not.toBeCloseTo(128, 1)
  })
})

describe('reset and focus', () => {
  it('reset frames the whole arena and glides there', () => {
    const s = cam({ target: { x: 10, z: 20 }, distance: 40, yaw: 2 })
    s.pitch = pitchForDistance(40, s.limits)
    updateCamera(s, DT, { ...emptyInput(), reset: true })
    expect(s.target.x).toBeGreaterThan(10)
    expect(s.target.x).toBeLessThan(128)
    run(s, 600)
    expect(s.target.x).toBeCloseTo(128, 2)
    expect(s.target.z).toBeCloseTo(128, 2)
    expect(Math.abs(s.yaw % (2 * Math.PI))).toBeCloseTo(0, 2)
    expect(s.distance).toBeCloseTo(resetCamera(createCamera(), false).goalDistance, 2)
    // the four arena corners are inside the view
    for (const [x, z] of [[0, 0], [256, 0], [0, 256], [256, 256]]) {
      const n = ndcOfGround(s, x, z)
      expect(Math.abs(n.x)).toBeLessThanOrEqual(1)
      expect(Math.abs(n.y)).toBeLessThanOrEqual(1)
    }
  })

  it('focusOn glides, clamps, and manual pan cancels it', () => {
    const s = cam({ target: { x: 10, z: 10 } })
    focusOn(s, 200, 50)
    updateCamera(s, DT, emptyInput())
    expect(s.target.x).toBeGreaterThan(10)
    expect(s.target.x).toBeLessThan(200)
    run(s, 600)
    expect(s.target.x).toBeCloseTo(200, 2)
    expect(s.target.z).toBeCloseTo(50, 2)
    focusOn(s, 999, -5)
    run(s, 600)
    expect(s.target.x).toBeCloseTo(256, 2)
    expect(s.target.z).toBeCloseTo(0, 2)
    focusOn(s, 20, 20)
    run(s, 5, () => ({ moveX: 1 }))
    run(s, 600)
    expect(s.target.x).toBeCloseTo(256, 0)
  })
})

describe('cameraPose', () => {
  it('sits behind the target at distance, raised by pitch', () => {
    const s = cam({ target: { x: 50, z: 60 }, distance: 100, yaw: 0 })
    s.pitch = Math.PI / 6
    const p = cameraPose(s)
    expect(p.lookAt).toEqual({ x: 50, y: 0, z: 60 })
    expect(p.position.y).toBeCloseTo(50, 6)
    expect(p.position.x).toBeCloseTo(50, 6)
    expect(p.position.z).toBeCloseTo(60 + 100 * Math.cos(Math.PI / 6), 6)
    const q = { ...s, yaw: Math.PI / 2 }
    expect(cameraPose(q).position.x).toBeCloseTo(50 + 100 * Math.cos(Math.PI / 6), 6)
  })
})
