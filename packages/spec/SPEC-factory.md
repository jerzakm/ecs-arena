# ecs-arena spec: factory (game 3)

This spec is authoritative for the game `factory`. An implementation passes when its per-tick hash trace matches the golden trace for each scenario and seed. Sections 1, 2, 9 and 10 of `SPEC.md` apply here, with the changes that this file states. The reasons for the design are in `docs/design/factory.md`. The rule tables and the pure rule functions are in `packages/spec/src/factory/kernel.ts`. Where this file and the kernel differ, this file is wrong, and the kernel gives the value.

All numbers marked _(tune)_ are first guesses. A change to a tuned number changes the goldens, and the commit must say so.

## 1. The game

A factory floor is a grid of districts. Each district holds a fixed block of machines and a depot. Machines turn items into other items. Drones fly between two machines on a fixed route and carry up to 3 crates. Each crate is a child entity of the drone or of the crate below it, and its world transform comes from its parent. Every few hundred ticks a shift change retires the oldest drones and spawns new ones. Every 50 ticks some districts lose power and others get it back.

A machine works only when it has power, room for its output and an input to use. How many machines work depends on the scenario. In a large world (`works`) most machines are idle, and the game rewards a library that touches only the machines that are working or that changed. In a small busy world (`mill`) most machines work, and the game rewards dense iteration over a large working set and cheap `Working` tag changes. Both run under the same rules.

## 2. Numbers and randomness

- As `SPEC.md` §1. All stored state is int32. 1 tile = 1024 units (`FX`). Integer division truncates toward zero (`fx.div`). `fx.mul(a, b) = fx.div(a * b, FX)`.
- `seed` is `scenario.seed`.
- `distSq`, `vx * vx + vy * vy` and the products inside `compose` are exact JS numbers below 2^53, not int32. Only stored values are int32.
- Draws use `rand` and `randInt` of `SPEC.md` §2 with the purposes below. The kernel exports a named function for every draw, so an implementation never builds a draw by hand.

| Purpose | Value | Used in |
|---|---|---|
| `BOOST` | 1 | §3.1 |
| `OUTAGE` | 2 | §5.2 |
| `DEPOT` | 3 | §5.3 |
| `ROUTE` | 4 | §5.3 |
| `MANUAL` | 5 | §3.1 |

## 3. Entities

| Entity | Fields | Tags | Links |
|---|---|---|---|
| Machine | `kind, district, x, y, input, output, progress`, optional `boost` | `Working`, `Powered`, `Manual` | none |
| Drone | `x, y, vx, vy, ax, ay, c, s, born, goal, cargo, item` | none | `source`, `sink` (machines), `top` (its top crate, or none) |
| Crate | `item, lx, ly, lc, ls, x, y, c, s` | none | `parent` (a drone or a crate) |

Every entity has a `gameId` from one counter, `nextId`, which starts at 1. Machines take gameIds 1 to `M` in build order (§5.1). Drones and crates take the next gameIds in the order this spec creates them. A native entity id is never a gameId.

### 3.1 Machines

A district `d` is in `0 .. D - 1` with `D = districtsX * districtsY`. Its column is `dx = d % districtsX` and its row is `dy = floor(d / districtsX)`. Slot `i` in `0 .. machinesPerDistrict - 1` of district `d` has:

- `gameId = 1 + d * machinesPerDistrict + i`
- `kind = kindPattern[i % kindPattern.length]`, with `kindPattern` a field of the scenario (§11)
- `x = (dx * DISTRICT_TILES + 4 + i % 40) * FX + FX / 2` and `y = (dy * DISTRICT_TILES + 4 + floor(i / 40)) * FX + FX / 2`
- `Manual`, when the kind is `EXTRACTOR`, or when `randInt(8, seed, 0, gameId, MANUAL) == 0`. The kernel function is `manualOf(scenario, gameId)`. It includes the kind test.
- `boost`, present when `randInt(8, seed, 0, gameId, BOOST, 0) == 0`, with the value `250 * (1 + randInt(4, seed, 0, gameId, BOOST, 1))`. A machine without `boost` reads it as 0. The kernel function is `boostOf(seed, gameId)`, and it returns 0 for no `boost`.

`DISTRICT_TILES = 48`. `machinesPerDistrict` is at most 1600.

| Kind | Id | Input item | Output item | Cycle ticks |
|---|---|---|---|---|
| `EXTRACTOR` | 0 | none | `ORE` | 40 |
| `SMELTER` | 1 | `ORE` | `PLATE` | 40 |
| `ASSEMBLER` | 2 | `PLATE` | `GEAR` | 40 |
| `SINK` | 3 | `GEAR` | none | 40 |

Items: `ORE` 1, `PLATE` 2, `GEAR` 3. Item 0 is none. `CAP = 8`. Every kind has the cycle of 40 ticks _(tune)_. The first version had 40, 60, 80 and 20, which caps a fully fed line at 62% of its machine time (`docs/design/factory.md`).

- `input` counts the input items in the machine, `0 .. CAP`. A kind without input keeps `input = 0`.
- `output` counts the output items, `0 .. CAP`. A kind without output keeps `output = 0`.
- `progress` is in permille ticks. A cycle is done when `progress >= cycle * 1000`.
- `Manual` marks a machine that needs no power (§3.1). It never changes.
- `Powered` is on every machine that is not `Manual` and whose district has power (§5.2). A `Manual` machine never has `Powered`.
- `Working` is on a machine when all of these are true: it has `Powered` or `Manual`; its kind has no input or `input >= 1`; its kind has no output or `output < CAP`. §5.7 keeps the tag current.

### 3.2 Drones

A drone flies its route: from its `source` machine to its `sink` machine and back. `goal` is 0 when the drone flies to `source` and 1 when it flies to `sink`. `item` is the output item of `source`. `cargo` is the number of crates it carries, `0 .. 3`.

- `x, y` is the position. `vx, vy` is the velocity in units per tick. `ax, ay` is the acceleration of this tick.
- `c, s` is the rotation of the drone as a unit vector with length `FX`: `(FX, 0)` faces `+x`.
- `born` is the tick that made the drone.

The depot of district `d` is at `((dx * DISTRICT_TILES + 24) * FX, (dy * DISTRICT_TILES + 46) * FX)`.

Drone constants: `MAX_SPEED = 256`, `ACCEL = 24`, `DOCK = 512`, `MAX_CARGO = 3`.

### 3.3 Crates

A crate is one item on a drone. The first crate has the drone as its `parent`. Each next crate has the crate below it as its `parent`, so a drone with 3 crates is a chain of depth 3 below the drone. The drone's `top` is the last crate of the chain.

- `item` is the item of the crate.
- `lx, ly, lc, ls` is the local transform: the offset and the rotation relative to the parent. Every crate has `lx = -384`, `ly = 0`, `lc = 1021` and `ls = 75`. (`(1021, 75)` is the rotation by 3 of 256 steps.)
- `x, y, c, s` is the world transform. §5.8 computes it.

## 4. Phases

Each tick runs these 9 phases in this order: `build`, `power`, `shift`, `steer`, `move`, `dock`, `work`, `state`, `transform`.

Every phase runs to its end before the next phase starts, and its writes are visible to later phases. Inside a phase, the rules below say the order where order changes the result. Where they say no order, each entity reads only its own fields and the fields of other entities that the phase does not write.

## 5. Rules

### 5.1 `build`

Only at tick 0. Create every machine in gameId order (§3.1) with `input = 0`, `progress = 0` and `output = CAP` for an `EXTRACTOR` or 0 for any other kind _(tune)_. The kernel function is `startOutput(kind)`. An extractor that starts full does nothing until a drone picks up from it, so the world is idle from tick 0. (With an empty start, 43% of `works` is Working for the first 320 ticks, and `work.query` fails the budget. In `mill` the world is busy from about tick 200, when the drones have flown from the depot to the lines.) Give `Manual` to each machine that `manualOf` names, and `Powered` to every other machine (every district starts with power). `Working` is set by `state` at the end of this tick. The world starts with every district powered.

### 5.2 `power`

When `tick > 0` and `tick % powerEvery == 0`. For each district `d` in ascending order: the district is down when `randInt(1000, seed, tick, DISTRICT_BASE + d, OUTAGE) < outagePermille`, else up. `DISTRICT_BASE = 0x7fff0000`. The kernel function is `districtDown(seed, tick, d, outagePermille)`.

- A district that goes from up to down: remove `Powered` from each of its machines that has it.
- A district that goes from down to up: give `Powered` to each of its machines that is not `Manual`.
- A district that keeps its state does nothing.

### 5.3 `shift`

At tick 0, spawn the first drones. For each district `d` in ascending order, spawn `dronesPerDistrict` drones in district `d`.

When `tick > 0` and `tick % shiftEvery == 0`:

1. **Retire.** Let `n` be the number of drones and `r = fx.div(n * shiftPermille, 1000)`. Sort the drones by `(born, gameId)` ascending. The first `r` retire. (A drone never has a smaller `born` than a drone with a smaller gameId, so this is gameId order.) A retired drone is destroyed with all its crates. Add its `cargo` to the world value `lost`.
2. **Spawn.** Spawn `r` drones, one at a time. Each new drone takes the next gameId `id`, then its district is `randInt(D, seed, tick, id, DEPOT)`. The kernel function is `depotOf(seed, tick, id, D)`.

**Routes.** Each district has `lines` production lines, a field of the scenario (§11). Line `k` is the `k`-th `EXTRACTOR`, the `k`-th `SMELTER`, the `k`-th `ASSEMBLER` and the `k`-th `SINK` of the district, counted from 0 in gameId order. A line has 3 legs: extractor to smelter, smelter to assembler, assembler to sink. A drone with gameId `id` spawned in district `d` at tick `t` takes line `randInt(lines, seed, t, id, ROUTE, 0)` and leg `randInt(3, seed, t, id, ROUTE, 1)`. Its `source` and `sink` are the two machines of that leg. The kernel function is `route(scenario, t, id, d)`. Machines on no line are never served: they fill up or never start, which makes the idle part of the world. In `works` that is most machines. In `mill` the pattern has one machine of each kind, so every machine is on a line.

To spawn a drone with gameId `id` in district `d` at tick `t`: `[source, sink] = route(scenario, t, id, d)`. The drone is at the depot of `d` with `vx = vy = ax = ay = 0`, `c = FX`, `s = 0`, `born = t`, `goal = 0`, `cargo = 0`, `item` = the output item of `source`, and no `top`.

### 5.4 `steer`

For each drone, no order. Let `(gx, gy)` be the position of `source` when `goal == 0`, else of `sink`. Then:

- `(dvx, dvy) = velToward(x, y, gx, gy, MAX_SPEED)`
- `ax = clamp(dvx - vx, -ACCEL, ACCEL)` and `ay = clamp(dvy - vy, -ACCEL, ACCEL)`

`velToward(x, y, tx, ty, speed)` is the vector toward the point with length `speed`, or the whole offset when the point is nearer than `speed` (kernel).

### 5.5 `move`

For each drone, no order:

1. `vx += ax`, `vy += ay`.
2. `x = clampToWorld(x + vx)`, `y = clampToWorld(y + vy)`. The world is `[0, W - 1]` on each axis with `W = districtsX * DISTRICT_TILES * FX` for `x` and `districtsY * DISTRICT_TILES * FX` for `y`. The kernel function is `clampX(scenario, v)` and `clampY(scenario, v)`.
3. Let `d = isqrt(vx * vx + vy * vy)`. When `d >= 16`: `c = fx.div(vx * FX, d)` and `s = fx.div(vy * FX, d)`. Else `c` and `s` keep their values.

### 5.6 `dock`

Each drone whose goal is in reach, `distSq(x, y, gx, gy) <= DOCK * DOCK`, in ascending gameId order. Each drone sees the machine values that the drones before it wrote in this phase.

- **Pick up** (`goal == 0`). `n = min(MAX_CARGO - cargo, source.output)`. When `n > 0`: `source.output -= n`, add `n` to the world value `picked`, and create `n` crates one at a time. Each crate takes the next gameId, has `item` = the drone `item`, the local transform of §3.3, the drone's `top` (or the drone when it has none) as `parent`, and a world transform of all zeros until §5.8. It becomes the new `top`. `cargo += n`. Then, when `cargo > 0`, `goal = 1`.
- **Deliver** (`goal == 1`). `n = min(cargo, CAP - sink.input)`. When `n > 0`: `sink.input += n`, add `n` to the world value `delivered`, and destroy the `n` top crates, from the top down. The parent of each destroyed crate becomes the new `top`, or the drone has no `top`. `cargo -= n`. Then, when `cargo == 0`, `goal = 0`.

A drone that can do nothing keeps steering toward its goal. It can leave reach and come back, and it tries again on each tick that it is in reach.

### 5.7 `work` and `state`

`work`: each machine that has `Working` at the start of this phase, no order. `work` does not test `Powered`. A machine that lost power in this tick's `power` phase still has `Working`, and works once more before `state` removes the tag.

1. `progress += 1000 + boost`.
2. When `progress >= cycle * 1000`: `progress -= cycle * 1000`. When the kind has an input, `input -= 1`. When the kind has an output, `output += 1`. When the kind is `SINK`, add 1 to the world value `score`.

`state`: each machine whose `input`, `output` or `Powered` changed in this tick, and every machine at tick 0, no order. Give it `Working` when §3.1 holds, else remove `Working`. A change that returns to the old value in the same tick still counts as a change. Re-checking a machine that did not change gives the same result, so an implementation may check more machines than this.

### 5.8 `transform`

Each crate gets its world transform from its parent's world transform. A drone's world transform is its `x, y, c, s`. A parent is done before its children, so visit the crates by depth.

```
c = fx.div(pc * lc - ps * ls, FX)
s = fx.div(ps * lc + pc * ls, FX)
x = px + fx.div(pc * lx - ps * ly, FX)
y = py + fx.div(ps * lx + pc * ly, FX)
```

`(px, py, pc, ps)` is the world transform of the parent. Each step uses exact integers below 2^53 before the division. The kernel function is `compose(px, py, pc, ps, lx, ly, lc, ls)` and returns `[x, y, c, s]`.

## 6. World values

`score`, `picked`, `delivered` and `lost` start at 0 and wrap mod 2^32 into int32 (`SPEC.md` §1). `powered` is the bitset of districts with power, kept as a list of `D` flags.

## 7. Kernel functions

| Function | Result |
|---|---|
| `machineCount(scenario)` | `D * machinesPerDistrict` |
| `kindOf(scenario, gameId)` | the kind of machine `gameId` (§3.1) |
| `slotPos(scenario, gameId)` | `[x, y]` of machine `gameId` |
| `manualOf(scenario, gameId)` | `true` for a `Manual` machine (§3.1) |
| `boostOf(seed, gameId)` | the `boost` of machine `gameId`, 0 for none |
| `startOutput(kind)` | `output` of a new machine (§5.1) |
| `RECIPES[kind]` | `{ input, output, cycle }` |
| `depotPos(scenario, d)` | `[x, y]` of the depot of district `d` |
| `lineMachines(scenario, d, line)` | `[extractor, smelter, assembler, sink]` gameIds of production line `line` of district `d` (§5.3) |
| `route(scenario, tick, droneId, d)` | `[sourceGameId, sinkGameId]` (§5.3) |
| `districtDown(seed, tick, d, outagePermille)` | §5.2 |
| `depotOf(seed, tick, id, D)` | §5.3 |
| `velToward`, `isqrt`, `distSq`, `fx`, `clampX`, `clampY`, `compose` | geometry |

`machinesPerDistrict` is large enough that every line finds its 4 machines: the `lines`-th machine of each kind in the pattern is inside the district. Each kind appears in `kindPattern` at least once.

## 8. Snapshot

The snapshot is one flat int32 array in this order. It is taken after a tick ends. `tick` is the number of the tick that just ended (0 after the first tick). The kernel function `worldHeader` builds item 1.

1. World: `tick, nextId, score, picked, delivered, lost, poweredCount, workingCount, droneCount, crateCount`. `poweredCount` counts the districts with power. `workingCount` counts the machines with `Working`.
2. `changedCount`, then each changed machine in gameId order: `gameId, kind, input, output, progress, flags`. `flags` has bit 0 for `Working`, bit 1 for `Powered`, bit 2 for `Manual` and bit 3 when the machine has `boost`. A machine is **changed** in tick `t` when one of `input, output, progress, flags` differs from its value at the end of tick `t - 1`. At tick 0 every machine is changed. After a load, the end of the saved tick is the end of tick `t - 1` for the first replayed tick. This test compares values. A field that is written and restored in one tick does not make the machine changed here, though the write still counts for `state` (§5.7).
3. Each drone in gameId order: `gameId, x, y, vx, vy, c, s, born, goal, cargo, item, source, sink, top`. `top` is -1 when the drone has none.
4. Each crate in gameId order: `gameId, parent, item, x, y, c, s`.

The drone list and the crate list have no count in front. `droneCount` and `crateCount` in the world part give their lengths.

The machines part holds only the changed machines, so the snapshot of a tick grows with the work of the tick, not with the size of the world. A machine that diverges shows up in the first tick that it changes.

## 9. Hash

As `SPEC.md` §9.

## 10. Save and load

As `SPEC.md` §10. The save interval is 25 ticks and `loadEvery` is 200. A save holds every machine, drone and crate with every field and tag, every link as a gameId, `nextId`, the world values of §6 and the district power flags. After a load, no change state from the discarded ticks can reach a later tick, and the next snapshot lists the machines that changed since the saved tick (§8).

## 11. Scenarios _(tune)_

Two board scenarios test opposite regimes under the same rules. `works` is a large, mostly idle world. `mill` is a small, busy world. A scenario has these fields besides the sizes and the timings of the table:

- `kindPattern`: the kinds of one block of slots (§3.1). `works` uses `[0, 1, 0, 2, 0, 1, 3, 0, 2, 1, 0, 0, 1, 2, 3, 0]`, which is 7 extractors, 4 smelters, 3 assemblers and 2 sinks in each 16 slots. `mill` uses `[0, 1, 2, 3]`.
- `lines`: the production lines of a district (§5.3). `works` has 12. `mill` has 100, one for each 4 machines.

| Scenario | districts | machines per district | lines | drones per district | shiftEvery | shiftPermille | powerEvery | outagePermille | Ticks | loadEvery |
|---|---|---|---|---|---|---|---|---|---|---|
| `mill` | 2 × 2 | 400 | 100 | 900 | 250 | 200 | 50 | 125 | 1,000 | 200 |
| `works` | 12 × 10 | 1,250 | 12 | 50 | 250 | 200 | 50 | 125 | 1,000 | 200 |

`mill` has 1,600 machines and 3,600 drones. About 75% of its machines have `Working` on a tick after tick 200. `works` has 150,000 machines and 6,000 drones, and about 1.5% of its machines work. A smoke variant `<name>-smoke` runs 400 ticks. Timing uses the seed `0xEC5A7E7A`, and `pnpm verify` uses the 3 seeds of `SPEC.md` §11. The board is `mill` and `works`.
