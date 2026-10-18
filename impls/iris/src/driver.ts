// iris 0.0.14 (pinned exactly) runs systems only through its async scheduler, so this driver sets `world.execution.systemId` for the trackers and repeats the scheduler's end-of-frame `flushEvents`.
// Both reach into `getWorldInternals`, which is why the version is pinned: without the flush, the removal events of every destroyed component would pile up.
import { getWorldInternals, type System, type World } from 'iris-ecs'

/** Runs `fn` with the system id of `systemId` set, so the tracker windows of that system are the ones that it reads. */
export const runAs = (world: World, systemId: string, fn: () => void): void => {
  const exec = getWorldInternals(world).execution
  exec.systemId = systemId
  try {
    fn()
  } finally {
    exec.systemId = null
  }
}

export const runSystem = (world: World, system: System): void => runAs(world, system.name, () => void system.tick(world))

/** The swap of `flushEvents` in the iris scheduler: events live for the rest of their frame and one more. */
export const flushEvents = (world: World): void => {
  const active = getWorldInternals(world).events.active
  for (let i = active.length - 1; i >= 0; i--) {
    const queue = active[i]!
    const current = queue.current
    queue.current = queue.previous
    queue.previous = current
    queue.current.length = 0
    if (queue.previous.length === 0) {
      queue.active = false
      active[i] = active[active.length - 1]!
      active.pop()
    }
  }
}
