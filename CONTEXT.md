# ecs-arena

## Language

**Draw**:
One random number that the kernel computes from `(seed, tick, gameId, purpose)`, plus a `salt` when one entity needs more than one draw for a purpose in a tick. A draw does not depend on the order of calls.
_Avoid_: RNG stream, roll order

**Purpose**:
A fixed name for the reason of a draw, for example `CRIT`, `LOOT_ROLL` or `SPAWN_ITEMS`. Two purposes never share a draw.

**gameId**:
The spec-assigned identity of an entity. Units, minions, projectiles and items all take it from one counter. The native entity ID of a library is never a gameId.
_Avoid_: entity ID, eid

**Spawn intent**:
A request to create an entity, collected during a phase. A phase sorts its spawn intents by `(sourceGameId, salt)` before it assigns gameIds.

**Snapshot**:
The canonical state at the end of a tick: units with relations, buffs, items and derived stats, then projectiles, ground items and world metrics. It holds plain numbers sorted by gameId, and relations appear as gameIds. The runner hashes it.

**Start-of-phase value**:
The value that a read of another entity sees during a phase. Writes in a phase become visible only to the next phase. The one exception is **Hierarchy order**.

**Hierarchy order**:
In the `move` phase, a squad leader moves before its members, so members read the new leader position.

**Capability table**:
The `CAPABILITIES.md` file in each implementation. It maps each required facet to the code that uses the library API for it. A reviewer checks it.

**Squared distance**:
The only distance measure in the rules: `dx*dx + dy*dy` as an exact JS number, compared with `range*range`. For "nearest", a tie goes to the lowest gameId.
_Avoid_: distance, length

**Ground item**:
An item that a dead unit drops. In `cleanup`, ground items in gameId order go to the nearest ally in pickup range that holds fewer than 3 items. A ground item despawns after 300 ticks.
_Avoid_: loot, drop
