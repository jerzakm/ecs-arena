import { Not, createChanged, createQuery } from 'koota'
import {
  Aux, BLOCKS_ACT_TAGS, BLOCKS_MOVE_TAGS, Boss, Burning, Charger, Chase, Dying, Exploder, Explode, Fuse, GameId, Ghost, Healer, Held,
  Homing, Hostile, Hp, Incoming, Kind, Kite, Knockback, Mob, Orbiter, Particle, Pickup, Position, Projectile, Return, Scorching, Shield,
  Shoot, Summon, TIMED, Ttl, Velocity, Weaver,
} from './traits.ts'
import { trackerQuery } from '../shared/workarounds.ts'

export const createQueries = () => {
  const Changed = createChanged()
  const blocksMove = () => Not(...BLOCKS_MOVE_TAGS)
  const blocksAct = () => Not(...BLOCKS_ACT_TAGS)
  const moved = trackerQuery(Mob, Changed(Position))
  return {
    // ai
    chase: createQuery(Chase, Position, Velocity, Kind, blocksMove()),
    weave: createQuery(Weaver, GameId, Position, Velocity, Kind, blocksMove()),
    chargers: createQuery(Charger, Position, Velocity, Aux, Kind, blocksAct()),
    kite: createQuery(Kite, Position, Velocity, Kind, blocksMove()),
    shooters: createQuery(Shoot, GameId, Position, Aux, Kind, blocksAct()),
    summoners: createQuery(Summon, GameId, Position, Aux, Kind, blocksAct()),
    healers: createQuery(Healer, GameId, Position, blocksAct()),
    unfused: createQuery(Exploder, Position, blocksAct(), Not(Fuse)),
    fused: createQuery(Exploder, Fuse),
    // move
    knocked: createQuery(Mob, Knockback, Position),
    free: createQuery(Mob, Position, Velocity, blocksMove()),
    homing: createQuery(Projectile, Homing, Position, Velocity, Not(Hostile), Not(Orbiter)),
    returning: createQuery(Projectile, Return, Position, Velocity, Ttl, Not(Hostile), Not(Orbiter)),
    projectiles: createQuery(Projectile, Position, Velocity, Not(Orbiter)),
    particles: createQuery(Particle, Position, Velocity),
    moved,
    trackers: [moved], // reading a tracker resets it, so `load` reads them all
    // combat
    friendly: createQuery(Projectile, GameId, Position, Velocity, Ttl, Not(Hostile)),
    hostile: createQuery(Hostile, Position),
    exploders: createQuery(Projectile, Explode, GameId, Position, Ttl, Not(Hostile)),
    touching: createQuery(Mob, GameId, Position, Kind, blocksAct()),
    // status, resolve
    burning: createQuery(Mob, Burning, GameId, Position, Incoming),
    scorching: createQuery(Mob, Scorching, Position),
    ghosts: createQuery(Mob, Ghost, GameId),
    mobs: createQuery(Mob, GameId, Kind, Hp, Shield, Incoming),
    /** One query for each timed tag, by status id. */
    expiring: TIMED.map((t) => createQuery(t)),
    // cleanup, progress, render
    ttl: createQuery(Ttl),
    dying: createQuery(Mob, Dying, GameId),
    pickups: createQuery(Pickup, GameId, Position),
    held: createQuery(Held),
    bosses: createQuery(Boss),
    allProjectiles: createQuery(Projectile),
    renderMobs: createQuery(Mob, GameId, Kind, Position, Hp),
    renderProjectiles: createQuery(Projectile, GameId, Position),
    renderPickups: createQuery(Pickup, GameId, Position),
    renderParticles: createQuery(Particle, GameId, Position),
  }
}
export type Queries = ReturnType<typeof createQueries>
