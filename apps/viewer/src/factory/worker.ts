import { FACTORY, runPhases, type AnyCreateSim, type factory, type Sim } from '@ecs-arena/spec'
import { advance, type Speed } from '../clock.ts'
import { faRegistry } from '../registry.ts'
import { CHANGED_AT, CHANGED_FIELDS, type FaFromWorker, type FaToWorker } from './protocol.ts'

const FRAME_BUDGET_MS = 16

const ctx = self as unknown as {
  postMessage(m: FaFromWorker, transfer?: Transferable[]): void
  onmessage: ((e: MessageEvent<FaToWorker>) => void) | null
}

let impl = ''
let scenario: factory.FactoryScenario
/** Endless runs ignore the scenario's tick count and play until paused. */
let endless = false
let speed: Speed = '4x'
let sim: Sim | null = null
let ticksRun = 0
let playing = false
let acc = 0
let last = 0
let timer: ReturnType<typeof setTimeout> | undefined
let generation = 0
let run = 0

const stop = () => { playing = false; clearTimeout(timer) }

const start = async () => {
  stop()
  const mine = ++generation
  sim = null
  try {
    const create = (await faRegistry[impl]()).default as AnyCreateSim
    if (mine !== generation) return
    sim = create(scenario, FACTORY.kernel)
    ticksRun = 0
    acc = 0
    play()
  } catch (e) {
    ctx.postMessage({ type: 'error', run, message: String(e) })
  }
}

const play = () => {
  if (!sim || playing) return
  playing = true
  last = performance.now()
  timer = setTimeout(step, 0)
}

// The snapshot lists only the machines that changed in its tick, so the worker takes one after every tick and
// forwards every changed record. The main thread keeps the machine map from them.
const step = () => {
  if (!sim || !playing) return
  const now = performance.now()
  const due = advance(acc, speed, now - last)
  acc = due.acc
  last = now
  let ran = 0
  let phaseMs = 0
  let snap: number[] = []
  const changes: number[] = []
  while (ran < due.ticks && (endless || ticksRun < scenario.ticks)) {
    const t0 = performance.now()
    runPhases(FACTORY, sim)
    phaseMs += performance.now() - t0
    snap = sim.snapshot() as number[]
    const n = snap[CHANGED_AT]
    for (let i = CHANGED_AT + 1; i < CHANGED_AT + 1 + n * CHANGED_FIELDS; i++) changes.push(snap[i])
    ran++
    ticksRun++
    if (due.ticks === Infinity && performance.now() - now >= FRAME_BUDGET_MS) break
  }
  const finished = !endless && ticksRun >= scenario.ticks
  if (ran > 0) {
    const s = Int32Array.from(snap)
    const c = Int32Array.from(changes)
    ctx.postMessage({ type: 'snap', run, snapshot: s, changes: c, tickMs: phaseMs / ran }, [s.buffer, c.buffer])
  }
  if (finished) {
    stop()
    ctx.postMessage({ type: 'done', run })
  } else timer = setTimeout(step, 0)
}

ctx.onmessage = (e) => {
  const m = e.data
  if (m.type === 'init') {
    ;({ run, impl, scenario, speed, endless } = m)
    void start()
  } else if (m.type === 'restart') void start()
  else if (m.type === 'play') play()
  else if (m.type === 'pause') stop()
  else if (m.type === 'endless') endless = m.on
  else speed = m.speed
}
