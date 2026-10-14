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
An item that a dead unit drops. In `cleanup`, ground items in gameId order go to the nearest unit of either team in pickup range that holds fewer than 3 items. A ground item despawns after 300 ticks.
_Avoid_: loot, drop

**Shrine**:
One of 7 fixed points in the middle of the arena. A team owns a shrine when its units hold the shrine long enough. A shrine is not a unit.

**Score**:
The world record of how many shrines each team owns. It decides the surge.

**Surge**:
An extra spawn of squads for the team that owns more shrines. It happens at a fixed period.

**Warlord**:
A unit kind that leads a warband. It is the top of the hierarchy.

**Warband**:
A warlord and up to 4 squads. The squad leaders keep a formation slot around the warlord.

**Depth**:
The number of parent links above a unit. A warlord has depth 0, a squad leader 1, a member 2, and the minion of a member 3.

**Morale**:
The loss count of a squad, kept on its leader.

**Rout**:
The moment a squad loses too many members. The leader gets `Routed`, and the squad gets `Fleeing`.
_Avoid_: break, panic

**Fleeing**:
A unit that runs to its home edge. It does not attack, and enemies do not choose it as a target. It never recovers.

**Leave**:
A fleeing unit that reaches its home edge leaves the battle. It gives no kill and drops nothing.

**Threat**:
A relation from a unit to an enemy that damaged it, with an amount. A unit keeps at most 4. The amount decays over time.
_Avoid_: grudge, aggro

**Retaliation**:
A unit with a large enough threat targets its worst attacker in sight.

**Think tick**:
A tick on which a unit can search the area for a new target. Each unit has one think tick in 4.

**lastHitBy**:
The unit that dealt the most damage to a unit in the last tick it took damage from units. It gets the kill credit.

**Veteran**:
A unit with 3 or more kills. It gets more attack and a chronicle.

**Chronicle**:
The list of the last 4 victim kinds of a veteran, oldest first.

**Volley**:
The 3 projectiles of one archer attack.

**Peak entities**:
The highest count in a run of entities that have a gameId, equipped items included.
