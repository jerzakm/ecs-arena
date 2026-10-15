import { kernel, runPhases, type CreateSim, type Scenario, type Sim } from '@ecs-arena/spec'
import { advance, type Speed } from './clock.ts'
import type { FromWorker, ToWorker } from './protocol.ts'
import { registry } from './registry.ts'

const FRAME_BUDGET_MS = 16
const WINNER_INDEX = 7

const ctx = self as unknown as {
  postMessage(m: FromWorker, transfer?: Transferable[]): void
  onmessage: ((e: MessageEvent<ToWorker>) => void) | null
}

let impl = ''
let scenario: Scenario
let speed: Speed = '1x'
let sim: Sim | null = null
let ticksRun = 0
let playing = false
let acc = 0
let last = 0
let timer: ReturnType<typeof setTimeout> | undefined
let generation = 0
let run = 0

const stop = () => { playing = false; clearTimeout(timer) }

const post = (m: DistributiveOmit<FromWorker, 'run'>, transfer?: Transferable[]) => ctx.postMessage({ ...m, run } as FromWorker, transfer)
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never

const start = async () => {
  stop()
  const mine = ++generation
  sim = null
  try {
    const create = (await registry[impl]()).default as CreateSim
    if (mine !== generation) return
    sim = create(scenario, kernel)
    ticksRun = 0
    acc = 0
    play()
  } catch (e) {
    post({ type: 'error', message: String(e) })
  }
}

const play = () => {
  if (!sim || playing) return
  playing = true
  last = performance.now()
  timer = setTimeout(step, 0)
}

const step = () => {
  if (!sim || !playing) return
  const now = performance.now()
  const due = advance(acc, speed, now - last)
  acc = due.acc
  last = now
  let ran = 0
  let phaseMs = 0
  const budgeted = due.ticks === Infinity
  while (ran < due.ticks && ticksRun < scenario.ticks) {
    const t0 = performance.now()
    runPhases(sim)
    phaseMs += performance.now() - t0
    ran++
    ticksRun++
    if (budgeted && performance.now() - now >= FRAME_BUDGET_MS) break
  }
  let finished = ticksRun >= scenario.ticks
  if (ran > 0) {
    const snapshot = Int32Array.from(sim.snapshot())
    if (snapshot[WINNER_INDEX] !== -1) finished = true
    post({ type: 'snap', snapshot, tickMs: phaseMs / ran }, [snapshot.buffer])
  }
  if (finished) {
    stop()
    post({ type: 'done' })
  } else timer = setTimeout(step, 0)
}

ctx.onmessage = (e) => {
  const m = e.data
  if (m.type === 'init') {
    ;({ run, impl, scenario, speed } = m)
    void start()
  } else if (m.type === 'restart') void start()
  else if (m.type === 'play') play()
  else if (m.type === 'pause') stop()
  else speed = m.speed
}
