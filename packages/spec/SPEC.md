# ecs-arena spec (draft 1)

This spec is authoritative. An implementation passes when its per-tick hash trace matches the golden trace for each scenario and seed. Terms in **bold** are defined in `CONTEXT.md` at the repo root.

All numbers marked _(tune)_ are first guesses. M4 tunes them. A change to a tuned number changes the goldens, and the commit must say so.

## 1. Numbers

- All stored state is int32.
- Positions use fixed point: 1 tile = 1024 units (`FX = 1024`). The arena is 256 × 256 tiles, so `x` and `y` are in `[0, 262143]`.
- Intermediate values can be plain JS numbers, but they must stay integers below 2^53.
- Rules must not use `Math.sqrt`, `Math.hypot`, `Math.atan2`, or any other float function. Use the kernel helpers.
- Integer division truncates toward zero: `fx.div(a, b) = Math.trunc(a / b)`. This is exact for all values in this spec.

### Kernel math

| Function | Result |
|---|---|
| `distSq(ax, ay, bx, by)` | `dx*dx + dy*dy` as an exact JS number |
| `isqrt(n)` | floor of the square root of `n`, for `0 <= n < 2^53` |
| `fx.mul(a, b)` | `fx.div(a * b, FX)` |
| `fx.div(a, b)` | `Math.trunc(a / b)` |
| `stepToward(x, y, tx, ty, speed)` | see §6.3. The result is clamped to the arena. |
| `damage(attack, armor, crit)` | see §7.2 |

## 2. Randomness

Each random value is a **draw**:

```
fmix32(h):  h ^= h >>> 16; h = imul(h, 0x85ebca6b); h ^= h >>> 13;
            h = imul(h, 0xc2b2ae35); h ^= h >>> 16; return h >>> 0
rand(seed, tick, gameId, purpose, salt = 0) =
  fmix32(fmix32(fmix32(fmix32(fmix32(seed) ^ tick) ^ gameId) ^ purpose) ^ salt)
randInt(n, ...args) = rand(...args) % n
```

- `randInt` has a small modulo bias. The bias is accepted, because every implementation has the same bias.
- A draw that belongs to a team, not an entity, uses `gameId = 0xFFFFFF00 + team`.

| Purpose | Value | Used in |
|---|---|---|
| `SQUAD_KIND` | 1 | §5.2 |
| `SPAWN_Y` | 2 | §5.2 |
| `ITEM_COUNT` | 3 | §5.3 |
| `ITEM_KIND` | 4 | §5.3 |
| `ITEM_QUALITY` | 5 | §5.3 |
| `CRIT` | 6 | §7.2 |

## 3. Entities

| Kind | Id | Notes |
|---|---|---|
| Warrior | 0 | unit |
| Archer | 1 | unit |
| Mage | 2 | unit |
| Healer | 3 | unit |
| Summoner | 4 | unit |
| Minion | 5 | unit, child of a summoner |
| Projectile | 6 | |
| Item | 7 | equipped or a **ground item** |

Every entity has an **age**: 0 in the tick it is created. At the start of the `spawn` phase, the age of each projectile, minion and ground item grows by 1. Cleanup destroys an entity whose age is at its lifetime or more.

Every entity has a **gameId**. One counter gives gameIds to all kinds. The counter starts at 1 and never reuses a value.

### Relations

| Relation | From → to | Data | Rule |
|---|---|---|---|
| `Targets` | unit → unit | none | exclusive. A projectile also targets one unit. |
| `MemberOf` | unit → squad leader | `offsetX`, `offsetY` | formation offset in fixed point |
| `ChildOf` | minion → summoner | none | the minion dies with the summoner |
| `Equips` | unit → item | `quality` (1–3) | at most 3 items for each unit |

When a unit is destroyed, every `Targets` relation to it is removed in the same phase.

## 4. Unit stats _(tune)_

Speeds are in fixed point units per tick. Ranges are in tiles.

| Kind | maxHp | attack | armor | range | sight | cooldown | speed |
|---|---|---|---|---|---|---|---|
| Warrior | 200 | 14 | 4 | 1.5 | 12 | 20 | 384 |
| Archer | 80 | 10 | 1 | 8 | 14 | 30 | 320 |
| Mage | 70 | 9 | 0 | 7 | 14 | 45 | 320 |
| Healer | 90 | 15 (heal) | 1 | 6 | 10 | 40 | 320 |
| Summoner | 100 | 0 | 2 | — | 12 | 120 | 288 |
| Minion | 30 | 5 | 0 | 1.5 | 10 | 20 | 448 |

- The heal range of a healer is its range. A summoner has range 0 and never attacks.
- The member order in §5.2 is the slot order. Crit chance is 10%. Pickup range is 1.5 tiles.
- A range `r` in tiles compares as `distSq <= (r * FX)^2`. Use 1.5 tiles = 1536 units.
- Projectile speed: 512 units per tick. Projectile lifetime: 60 ticks.
- Mage splash radius: 2 tiles.
- Summoner: one minion each 120 ticks, at most 3 alive minions. Minion lifetime: 300 ticks.

### Derived stats

```
attack = base.attack + Σ item.attack * quality
armor  = base.armor  + Σ item.armor  * quality
speed  = base.speed  + Σ item.speed  * quality
if Haste: speed = fx.div(speed * 3, 2)
```

Derived stats are recomputed in the `stats` phase (§6.7), and also at spawn.

## 5. Spawning

### 5.1 Waves _(tune)_

- A wave starts on tick 0 and then each `wavePeriod` ticks.
- In a wave, each team spawns squads while its alive unit count is below `targetPop`. Team 0 spawns first, then team 1.
- A team can spawn at most `maxSquadsPerWave` squads in one wave.
- The alive count of a team is the number of its units of every kind, minions included. Each spawned squad adds to the count before the next squad check.

### 5.2 Squads

The squad kind is `randInt(4, seed, tick, teamGameId, SQUAD_KIND, squadIndex)`.

| Squad | Leader | Members |
|---|---|---|
| 0 Line | Warrior | 4 Warrior, 2 Archer |
| 1 Volley | Warrior | 2 Warrior, 4 Archer |
| 2 Arcane | Warrior | 2 Archer, 2 Mage, 1 Healer |
| 3 Host | Summoner | 3 Warrior, 1 Healer |

- Team 0 spawns at `x = 4` tiles and faces +x. Team 1 spawns at `x = 252` tiles and faces −x.
- The leader `y` in tiles is `16 + randInt(224, seed, tick, teamGameId, SPAWN_Y, squadIndex)`.
- Member `i` (from 0) has offset `col = i % 3 - 1`, `row = 1 + floor(i / 3)`. The offset is `(-facing * row * 2 tiles, col * 2 tiles)`.
- Clamp every spawn position to the arena.
- A new unit has `hp = maxHp`, cooldown 0, no target and no buffs. A new summoner has `lastSummon` = the spawn tick.

### 5.3 Items _(tune)_

Each new unit (not a minion) gets `randInt(4, seed, tick, unitGameId, ITEM_COUNT)` items. Item `k` (from 0) has kind `randInt(8, seed, tick, unitGameId, ITEM_KIND, k)` and quality `1 + randInt(3, seed, tick, unitGameId, ITEM_QUALITY, k)`.

| Item | attack | armor | speed |
|---|---|---|---|
| 0 Sword | 3 | 0 | 0 |
| 1 Axe | 5 | 0 | -32 |
| 2 Shield | 0 | 3 | -32 |
| 3 Helm | 0 | 2 | 0 |
| 4 Boots | 0 | 0 | 64 |
| 5 Bow | 2 | 0 | 0 |
| 6 Ring | 1 | 1 | 16 |
| 7 Cloak | 0 | 1 | 32 |

### 5.4 gameId order in the `spawn` phase

1. Waves: team 0, then team 1. In a team, squads in `squadIndex` order.
2. In a squad: the leader, then members in slot order. Each unit takes its gameId, then its items take gameIds in `k` order.
3. Summons: summoners in gameId order. A minion has no items.

## 6. Phases

The runner calls the phases in this order each tick. A read of another entity sees its **start-of-phase value**, except for the **hierarchy order** in `move`.

### 6.1 `spawn`

Do the waves and summons from §5. A summoner spawns a minion at its own position and team when `tick - lastSummon >= 120` and it has fewer than 3 alive minions. A stunned summoner also spawns. A spawn sets `lastSummon = tick`.

### 6.2 `ai/target`

For each unit that is not stunned:

- **Healer:** the target is the ally (not the healer itself) in heal range with `hp < maxHp` and the lowest `hp / maxHp`. Compare `a.hp * b.maxHp < b.hp * a.maxHp`. A tie goes to the lowest gameId. If there is no such ally, the healer has no target.
- **Other units:** keep the current target if it is alive and in sight. Otherwise the target is the nearest enemy unit in sight by **squared distance**. A tie goes to the lowest gameId.
- A summoner has no target.

### 6.3 `move`

`stepToward(x, y, tx, ty, speed)`: if `distSq <= speed²`, go to `(tx, ty)`. Otherwise `d = isqrt(distSq)`, and go to `(x + fx.div(dx * speed, d), y + fx.div(dy * speed, d))`. Clamp to the arena.

Hierarchy order: move all leaders and units with no squad first. Then move all members.

- A unit that is stunned does not move.
- A unit with a target in attack range does not move. A read of the target position, and of the summoner position for a minion, sees the start-of-phase value.
- A leader moves toward its target. With no target, it moves toward the far edge at its own `y`. The far edge is `x = 262143` for team 0 and `x = 0` for team 1. A summoner leader with no target also moves toward the far edge.
- A member moves toward `leader.position + offset`. It uses the leader position from this phase. A member never leaves its slot to chase a target. It attacks only a target that comes into range.
- A minion moves toward its target. With no target, it moves toward its summoner.
- A projectile moves after all units, toward the position that its target has after the unit moves. This is a third pass of the hierarchy order: leaders, members, projectiles.

### 6.4 `combat`

1. **Hits.** A projectile hits when its position is equal to the position of its target. It makes a damage intent and gets the `Spent` tag. A new projectile from step 2 cannot hit in the tick that creates it.
   - A projectile stores the attack value and the crit result of its owner at fire time. The crit uses the draw of §7.1 for the owner and the firing tick. The damage uses the armor of the target at hit time.
   - Mage projectile: every unit of the other team within 2 tiles of the hit point gets the damage intent and `Burn`. This includes the target and minions.
2. **Attacks.** A unit that is not stunned, has cooldown 0, and has a target in range attacks:
   - Warrior, Minion: a damage intent. If the hit is a crit and the attacker is a warrior, the target gets `Stun`.
   - Archer, Mage: a projectile spawn intent. The phase sorts these intents by attacker gameId, then assigns gameIds.
   - Healer: a heal intent. The target gets `Haste`.
   - Then the cooldown resets to the base cooldown. Buffs, heals and damage from this phase take effect in step 4, so no attack in step 2 sees them.
3. Decrement each cooldown above 0 by 1. This includes a cooldown that step 2 just reset.
4. **Resolve.** For each unit, sum its damage and heal intents. Then `hp = min(maxHp, hp - damage + heal)`. A unit with `hp <= 0` gets the `Dead` tag.
5. Add each damage intent value to `damageDealt[attackerTeam]`. The value is the full damage, not limited by the hp left. Heals and burn damage do not count.

### 6.5 `effects`

| Buff | Id | Duration | Effect |
|---|---|---|---|
| `Stun` | 0 | 20 | no target change, no move, no attack |
| `Burn` | 1 | 60 | 2 damage when `ticksLeft % 10 == 0` |
| `Haste` | 2 | 40 | speed × 3/2 (derived stat) |

- A new buff of a kind that the unit already has resets `ticksLeft` to the full duration.
- Each tick, for each buff: decrement `ticksLeft` by 1, then apply burn damage when the new `ticksLeft % 10 == 0`, then remove the buff when `ticksLeft` is 0. A new buff from `combat` has the full duration at the start of this step, so it shows `duration - 1` in the snapshot. A full burn deals 2 damage 6 times.
- A unit at `hp <= 0` after burn gets `Dead`.

### 6.6 `cleanup`

Handle dead units in gameId order:

1. If the unit is not a minion, `kills[enemyTeam] += 1`.
2. The equipped item with the lowest gameId becomes a ground item at the unit position. Destroy the other items.
3. Destroy all minions with `ChildOf` this unit. Minions destroyed this way give no kill.
4. If the unit is a squad leader, the member with the lowest gameId that is not destroyed yet becomes the leader. It loses its `MemberOf`. Each other member of the squad gets the new leader, and its offset becomes `old offset - promoted member offset`. A dead member that waits in the dead list can be promoted. It is then destroyed in its turn, and the same rule applies again.
5. Destroy the unit.

Then:

6. Destroy minions that are 300 ticks old. They give no kill and drop nothing.

Then remove all `Targets` relations to every unit destroyed so far.

7. Destroy projectiles that are `Spent`, that have no target, or that are 60 ticks old.
8. **Pickup.** Handle ground items in gameId order. Each one goes to the nearest unit of either team in 1.5 tiles that has fewer than 3 items. A minion can pick up. A tie goes to the lowest gameId. Quality stays the same. An item that an earlier pickup in this step gave to a unit counts toward its 3 items.
9. Destroy ground items that are 300 ticks old.

### 6.7 `stats`

- Recompute derived stats for each unit with a change to its `Equips` relations or its buffs this tick. Use change detection (`Added`, `Removed`, `Changed`).
- Count alive units for each team. All unit kinds count.
- If exactly one team has 0 alive units after tick 0 and `winner` is -1, set `winner` to the other team. A set `winner` never changes. The game does not stop.

## 7. Formulas

### 7.1 Crit

A hit is a crit when `randInt(100, seed, tick, attackerGameId, CRIT) < 10`.

### 7.2 Damage

`damage(attack, armor, crit) = max(1, attack - armor) * (crit ? 2 : 1)`. Heal is the healer attack value, with no armor and no crit.

## 8. Snapshot

The **snapshot** is one flat int32 array in this order:

1. World: `tick, alive0, alive1, kills0, kills1, damage0, damage1, winner` (`winner = -1` while there is none).
2. `unitCount`, then each unit in gameId order:
   `gameId, team, kind, x, y, hp, maxHp, attack, armor, speed, cooldown, targetGameId, leaderGameId, parentGameId, buffCount, (kind, ticksLeft)…, itemCount, (itemGameId, itemKind, quality)…`
   - A missing relation is `-1`. Buffs are in kind order. Items are in gameId order.
3. `projectileCount`, then each: `gameId, ownerGameId, targetGameId, x, y, age`.
4. `groundItemCount`, then each: `gameId, itemKind, quality, x, y, age`.

## 9. Hash

FNV-1a 32-bit over the snapshot. Feed each int32 as 4 bytes, little-endian.

- **Verify mode:** the trace is the hash after each tick. The golden file is a JSON array of hex strings.
- **Bench mode:** only the hash after the last tick.

## 10. Scenarios _(tune)_

| Scenario | targetPop each team | wavePeriod | maxSquadsPerWave | Ticks | Smoke ticks |
|---|---|---|---|---|---|
| `skirmish` | 250 | 200 | 20 | 2,000 | 100 |
| `battle` | 2,500 | 200 | 150 | 2,000 | 100 |
| `war` | 12,500 | 200 | 600 | 1,000 | 100 |

The seed for all scenarios is `0xEC5A7E7A`. One seed is enough for v1.

## 11. Ticks

The first tick is tick 0. A tick runs all 7 phases. The snapshot after a tick holds that tick number. A scenario with `ticks = N` runs ticks `0` to `N - 1`.
