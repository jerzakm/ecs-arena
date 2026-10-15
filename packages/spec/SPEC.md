# ecs-arena spec (v3)

This spec is authoritative. An implementation passes when its per-tick hash trace matches the golden trace for each scenario and seed. Terms in **bold** are defined in `CONTEXT.md` at the repo root. The reasons for the design are in `docs/design/v2-game.md` and `docs/design/v3-game.md`.

All numbers marked _(tune)_ are first guesses. A change to a tuned number changes the goldens, and the commit must say so.

The spec states behaviour, not a mechanism. A rule of the form "when `T` is Added in this tick" or "when `T` is Removed in this tick" is satisfied by an observer, by an `Added` or `Removed` query, or by a list that the phase builds. Each is valid.

## 1. Numbers

- All stored state is int32.
- Positions use fixed point: 1 tile = 1024 units (`FX = 1024`). The arena is 256 × 256 tiles, so `x` and `y` are in `[0, 262143]`.
- Intermediate values can be plain JS numbers, but they must stay integers below 2^53.
- Rules must not use `Math.sqrt`, `Math.hypot`, `Math.atan2`, or any other float function. Use the kernel helpers. The kernel itself is exempt from this ban. For example, `isqrt` can use `Math.sqrt` and then correct the result.
- Integer division truncates toward zero: `fx.div(a, b) = Math.trunc(a / b)`. This is exact when `a` and `b` are integers, `b != 0`, and `|a| < 2^53`. Every division in this spec is in that bound.
- A world total that can grow without limit wraps mod 2^32 into int32: `total = (total + value) | 0`. This applies to `damage0`, `damage1`, `orders0` and `orders1`.
- The only distance measure is **squared distance**. A range `r` in tiles compares as `distSq <= (r * FX)^2`.

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
- A draw that belongs to a team, not an entity, uses `teamGameId = 0xFFFFFF00 + team`.

| Purpose | Value | Used in |
|---|---|---|
| `SQUAD_KIND` | 1 | §5.2 |
| `SPAWN_Y` | 2 | §5.2 (warband `y` in a wave) |
| `ITEM_COUNT` | 3 | §5.3 |
| `ITEM_KIND` | 4 | §5.3 |
| `ITEM_QUALITY` | 5 | §5.3 |
| `CRIT` | 6 | §7.1 |
| `SURGE_KIND` | 7 | §5.5 |
| `SURGE_Y` | 8 | §5.5 (warband `y` in a surge) |
| `ORDER_SUBJECT` | 9 | §6.12 |
| `ORDER_OBJECT` | 10 | §6.12 |

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
| Warlord | 8 | unit, head of a **warband** |
| Shrine | 9 | not a unit |

Every entity has an **age**: 0 in the tick it is created. At the start of the `spawn` phase, the age of each projectile, minion and ground item grows by 1. Cleanup destroys an entity whose age is at its lifetime or more.

Every entity has a **gameId**. One counter gives gameIds to all kinds. The counter starts at 1 and never reuses a value.

A **unit** is an entity of kind 0, 1, 2, 3, 4, 5 or 8. A shrine is not a unit. It is never a target, never takes damage and never counts as alive.

### Relations

| Relation | From → to | Data | Rule |
|---|---|---|---|
| `Targets` | unit → unit | none | exclusive. A projectile also targets one unit. |
| `MemberOf` | unit → its parent | `offsetX`, `offsetY` | formation offset in fixed point. The parent is a squad leader or a warlord. |
| `ChildOf` | minion → summoner | none | the minion dies with the summoner |
| `Equips` | unit → item | `quality` (1–3) | at most 3 items for each unit |
| `Threat` | victim unit → attacker unit | `amount` | at most 4 for each victim. See §6.9. |

When a unit is destroyed, every `Targets` and `Threat` relation to it or from it is removed in the same phase.

### Traits and tags added in v2

| Name | On | Data | Section |
|---|---|---|---|
| `Shrine` | shrine | `owner` (-1, 0, 1), `progress` (-200..200) | §6.8 |
| `Score` | world | `shrines0`, `shrines1` | §6.8 |
| `Morale` | squad leader | `size0`, `lost` | §6.6 |
| `Routed` | squad leader | tag | §6.6 |
| `Fleeing` | unit | tag | §6.6 |
| `Veteran` | unit | tag, with `chronicle` | §6.10 |
| `killCount` | every unit | int | §6.7 |
| `lastHitBy` | every unit | a reference to a unit, or none | §6.4 |

### Traits, tags and relations added in v3

| Name | On | Data | Section |
|---|---|---|---|
| item tags `Sword` to `Cloak` | unit | tag, one for each item kind | §3.1 |
| buff tags `Stun`, `Burn`, `Haste` | unit | tag, with `ticksLeft` | §3.1 |
| `Overwhelmed` | unit | tag | §6.4 |
| `bannered` | every unit | 0 or 1 | §6.13 |
| `Garrisoned` | unit | tag | §6.14 |
| `GarrisonOf` | unit → shrine | none | §6.14 |
| `orders0`, `orders1` | world | int | §6.12 |
| `renderChain` | world | int | §6.15 |

`lastHitBy` is a reference to a unit. A library can store it as a gameId, a native handle or any other form. The snapshot shows the gameId (§8).

### 3.1 Tag sets

Each item kind and each buff kind is a separate tag. The tag of an item kind is on a unit while the unit has one or more `Equips` items of that kind. The tag of a buff kind is on a unit while the unit has that buff. Two items of the same kind give one tag.

- The tag set of a unit is its item tags, its buff tags and the tags `Fleeing`, `Routed`, `Veteran`, `Overwhelmed` and `Garrisoned`.
- Only rules that already use draws or game state change the tag set: the item draws of §5.4, drop and pickup (§6.7), buffs (§6.4, §6.5) and the tags of §6.
- The item tags drive the set bonuses of §4. A library can keep the tags as tags, as components or in another form. The capability table shows the form. The rule is that each item kind and each buff kind is a separate tag, so units carry many distinct tag sets.

### 3.2 Kernel grid

The kernel owns one spatial grid for each world. Every spatial search in §6 uses it.

- **Contents.** The grid holds one entry for each unit that exists and is not `Garrisoned`. An entry is the `gameId` and the position of the unit. Shrines, projectiles and items are not in the grid.
- **Update.** The library tells the grid each unit that it added, each unit that it removed and each unit whose position changed. The library can also send every unit again. A full re-send gives the same contents.
- **When.** At the start of each phase that searches the grid, the grid contents must equal the start-of-phase values. The phases that search are `ai/target`, `combat`, `cleanup` and `objectives`.
- **Search.** `near(x, y, r)` returns the `gameId` of each entry with `distSq(entry, x, y) <= r * r`, in ascending `gameId` order. The caller filters by team and by the other conditions of the rule.
- **Ties.** Where a rule picks the nearest unit, it takes the lowest `distSq`. A tie goes to the lowest `gameId`.
- **Stale results.** A result can name a unit that an earlier step of the same phase destroyed or changed. The rule skips a destroyed unit and reads the current state of a changed unit where the rule says so.

### Depth

The **depth** of a unit is the number of `MemberOf` or `ChildOf` links from the unit up to a unit that has neither. A unit with no parent has depth 0. A normal warband has 4 levels: warlord (0), squad leader (1), member (2), and minion of a summoner member (3).

## 4. Unit stats _(tune)_

Speeds are in fixed point units per tick. Ranges and sight are in tiles.

| Kind | maxHp | attack | armor | range | sight | cooldown | speed |
|---|---|---|---|---|---|---|---|
| Warrior | 200 | 14 | 4 | 1.5 | 8 | 20 | 448 |
| Archer | 80 | 10 | 1 | 8 | 10 | 30 | 416 |
| Mage | 70 | 9 | 0 | 7 | 10 | 45 | 416 |
| Healer | 90 | 15 (heal) | 1 | 6 | 8 | 40 | 416 |
| Summoner | 100 | 0 | 2 | — | 8 | 120 | 352 |
| Minion | 30 | 5 | 0 | 1.5 | 8 | 20 | 512 |
| Warlord | 400 | 20 | 6 | 1.5 | 10 | 25 | 416 |

- The heal range of a healer is its range. A summoner has range 0 and never attacks.
- Crit chance is 10%. Pickup range is 1.5 tiles. Use 1.5 tiles = 1536 units.
- Projectile speed: 2048 units per tick for a mage. A projectile must be faster than every unit, or a unit can outrun it. A volley uses the speeds in §6.4. Projectile lifetime: 60 ticks.
- Mage splash radius: 2 tiles.
- Summoner: one minion each 120 ticks, at most 3 alive minions. Minion lifetime: 300 ticks.
- **Think interval:** 4 ticks. A unit makes a new spatial search only on a tick where `(gameId + tick) % 4 == 0`. See §6.2.

### Derived stats

```
attack = base.attack + Σ item.attack * quality + Σ set.attack
if Veteran: attack = attack + 2 * min(3, fx.div(killCount, 3))
armor  = base.armor  + Σ item.armor  * quality + Σ set.armor
if bannered: armor = armor + 2
speed  = base.speed  + Σ item.speed  * quality + Σ set.speed
if Haste: speed = fx.div(speed * 3, 2)
```

**Set bonuses** _(tune)_. A unit gets a set bonus when it has both item tags of the set (§3.1). Each set counts once, also when the unit has two items of one kind.

| Set | Item tags | attack | armor | speed |
|---|---|---|---|---|
| Guard | `Sword`, `Shield` | 0 | 2 | 0 |
| Berserk | `Axe`, `Boots` | 3 | 0 | 0 |
| Ranger | `Bow`, `Cloak` | 0 | 0 | 32 |
| Noble | `Helm`, `Ring` | 1 | 1 | 0 |

The `bannered` bonus of 2 armor is _(tune)_.

Derived stats are recomputed in the `stats` phase (§6.11), and also at spawn.

## 5. Spawning

### 5.1 Shrines

On tick 0, before the first wave, spawn 7 shrines. Shrine `i` (from 0 to 6) is at `x = 128` tiles, `y = 16 + 32 * i` tiles. The shrines take gameIds in `i` order, so they have gameIds 1 to 7. A new shrine has `owner = -1` and `progress = 0`. Shrines are never destroyed. Shrines have no age.

### 5.2 Waves _(tune)_

- A wave starts on tick 0 and then each `wavePeriod` ticks.
- In a wave, each team spawns squads while its alive unit count is below `targetPop`. Team 0 spawns first, then team 1.
- A team can spawn at most `maxSquadsPerWave` squads in one wave.
- The alive count of a team is the number of its units of every kind, minions and warlords included. Each spawned warlord and squad adds to the count before the next squad check.

### 5.3 Squads and warbands

The squad kind is `randInt(4, seed, tick, teamGameId, SQUAD_KIND, squadIndex)`.

| Squad | Leader | Members, in slot order |
|---|---|---|
| 0 Line | Warrior | 4 Warrior, 2 Archer |
| 1 Volley | Warrior | 2 Warrior, 4 Archer |
| 2 Arcane | Warrior | 2 Archer, 2 Mage, 1 Healer |
| 3 Host | Summoner | 2 Warrior, 1 Summoner, 1 Healer |

The Host squad has a summoner member. Its minions have depth 3.

**Warbands.** In a wave, the squads of a team join warbands in `squadIndex` order. Squad `s` is in warband `w = fx.div(s, 4)` at place `j = s % 4`. Before the first squad of a warband spawns, the warband spawns its warlord. A warband with fewer than 4 squads still has a warlord. A warlord spawns only when its first squad passes the squad check of §5.2.

- Team 0 has `teamX = 4` tiles and faces +x (`facing = 1`). Team 1 has `teamX = 252` tiles and faces −x (`facing = -1`).
- The warlord of warband `w` is at `x = teamX + facing * 4` tiles and `y = 16 + randInt(224, seed, tick, teamGameId, SPAWN_Y, w)` tiles.
- The leader at place `j` gets `MemberOf(warlord)` with offset `(-facing * 4 tiles, (2 * j - 3) * 4 tiles)`. Its position is the warlord position plus this offset.
- Member `i` (from 0) of a squad gets `MemberOf(leader)` with offset `col = i % 3 - 1`, `row = 1 + fx.div(i, 3)`, offset `(-facing * row * 2 tiles, col * 2 tiles)`. Its position is the leader position plus this offset.
- Clamp every spawn position to the arena. The stored offset is not clamped.
- The leader gets `Morale` with `size0 = 1 + member count` and `lost = 0`.
- A new unit has `hp = maxHp`, cooldown 0, `killCount = 0`, no target, no `lastHitBy`, no buffs and no tags. A new summoner has `lastSummon` = the spawn tick. A new unit gets its item tags from its items and its `bannered` value from §6.13, with the relations at spawn.

### 5.4 Items _(tune)_

Each new unit that is not a minion gets `randInt(4, seed, tick, unitGameId, ITEM_COUNT)` items. This includes a warlord. Item `k` (from 0) has kind `randInt(8, seed, tick, unitGameId, ITEM_KIND, k)` and quality `1 + randInt(3, seed, tick, unitGameId, ITEM_QUALITY, k)`.

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

### 5.5 Surge _(tune)_

A **surge** happens on each tick where `tick > 0` and `tick % surgePeriod == 0`, after the waves and before the summons.

- The spawn phase reads `Score` as the `objectives` phase of the previous tick left it.
- A team with `shrinesT > shrinesOther` surges. It can spawn at most `surgeBase * (shrinesT - shrinesOther)` squads. It spawns squads while its alive unit count is below `surgeCap`. A tie in shrines gives no surge.
- Surge squads use the rules of §5.3 and §5.4, with a separate `squadIndex` that starts at 0 for each surge. The squad kind uses `SURGE_KIND` in place of `SQUAD_KIND`. The warband `y` uses `SURGE_Y` in place of `SPAWN_Y`.

### 5.6 gameId order in the `spawn` phase

1. Tick 0 only: shrines in `i` order.
2. Waves: team 0, then team 1. In a team, squads in `squadIndex` order. The warlord of a warband comes before the first squad of the warband.
3. Surges: team 0, then team 1, in the same order as waves.
4. In a squad: the leader, then members in slot order. Each unit takes its gameId, then its items take gameIds in `k` order. A warlord also takes its gameId, then its items.
5. Summons: summoners in gameId order. A minion has no items.

## 6. Phases

The runner calls the phases in this order each tick:

| # | Phase | Work |
|---|---|---|
| 1 | `spawn` | ages, shrines, waves, surges, summons |
| 2 | `ai/target` | choose targets, with the think interval and retaliation |
| 3 | `move` | move by depth, fleeing units go home |
| 4 | `combat` | hits, attacks, volleys, resolve, `lastHitBy`, `Threat` writes |
| 5 | `effects` | buffs, burn, `Threat` decay |
| 6 | `morale` | count losses, add `Routed` and `Fleeing` |
| 7 | `cleanup` | dead and leaving units, kill credit, chronicle, projectiles, pickup |
| 8 | `objectives` | shrine capture, `Score` |
| 9 | `stats` | `Veteran`, banner, derived stats, alive counts, winner, render |

An implementation can give one `tick()` entry. `tick()` runs the 9 phases in this order, in the form that its library teaches. The result must be the same as 9 phase calls. Headline runs call `tick()` when it exists. Deep-dive runs call the phases one by one, so each phase must also exist as its own entry.

A read of another entity sees its **start-of-phase value**, except for the **hierarchy order** in `move`. Where a phase has numbered steps, a later step sees the writes of an earlier step only when the rule says so.

### 6.1 `spawn`

Grow the ages (§3). Then do the shrines, waves, surges and summons from §5. A summoner spawns a minion at its own position and team when `tick - lastSummon >= 120` and it has fewer than 3 alive minions. A stunned or fleeing summoner also spawns. A spawn sets `lastSummon = tick`.

### 6.2 `ai/target`

A **valid target** of a unit `u` is an enemy unit that exists, is in sight of `u`, is not `Fleeing` and is not `Garrisoned`.

First do the commander orders of §6.12. Then, for each unit that is not stunned, is not `Garrisoned`, and got no order in this tick:

- **Fleeing unit:** it has no target.
- **Summoner:** it has no target.
- **Healer:** keep the current target if it exists, is in heal range and has `hp < maxHp`. Otherwise, on a think tick, the target is the ally (not the healer itself) in heal range with `hp < maxHp` and the lowest `hp / maxHp`. Compare `a.hp * b.maxHp < b.hp * a.maxHp`. A tie goes to the lowest gameId. Otherwise the healer has no target. A fleeing ally can be a heal target.
- **Other units**, in this order:
  1. **Retaliation.** Look at the `Threat` edges of the unit. Take each edge with `amount >= 20` _(tune)_ whose attacker is a valid target. If there is one or more, the target is the attacker with the highest `amount`. A tie goes to the lowest attacker gameId. This overrides the current target. This step reads at most 4 edges and does no spatial search.
  2. Keep the current target if it is a valid target.
  3. On a think tick, the target is the nearest valid target by **squared distance**. A tie goes to the lowest gameId.
  4. Otherwise the unit has no target.

A think tick for a unit is a tick where `(gameId + tick) % 4 == 0` _(tune)_.

### 6.3 `move`

`stepToward(x, y, tx, ty, speed)`: if `distSq <= speed²`, go to `(tx, ty)`. Otherwise `d = isqrt(distSq)`, and go to `(x + fx.div(dx * speed, d), y + fx.div(dy * speed, d))`. Clamp to the arena.

**Hierarchy order:** move all units of depth 0, then all units of depth 1, and so on up to the greatest depth. Then move all projectiles. Depth is the depth at the start of the phase. A normal warband has depths 0 to 3. A promotion can raise the greatest depth (§6.7 step 4).

- A unit that is stunned or `Garrisoned` does not move.
- A **fleeing** unit moves toward its **home edge** at its own `y`. The home edge is `x = 0` for team 0 and `x = 262143` for team 1. It ignores its target and its parent.
- A unit with a target in attack range does not move. A read of the target position sees the start-of-phase value.
- A unit with a `MemberOf` parent moves toward `parent.position + offset`. It uses the parent position from this phase. It never leaves its slot to chase a target. It attacks only a target that comes into range. This applies to a squad leader in a warband and to a member in a squad.
- A minion moves toward its target. With no target, it moves toward its summoner. It uses the summoner position from this phase.
- Any other unit moves toward its target. With no target, it moves toward the far edge at its own `y`. The far edge is `x = 262143` for team 0 and `x = 0` for team 1.
- A projectile moves toward the position that its target has after the unit moves, at the projectile speed.

### 6.4 `combat`

1. **Hits.** A projectile hits when its position is equal to the position of its target. It makes a damage intent and gets the `Spent` tag. A new projectile from step 2 cannot hit in the tick that creates it.
   - A projectile stores the attack value and the crit result of its owner at fire time. The crit uses the draw of §7.1 for the owner and the firing tick. The damage uses the armor of the target at hit time.
   - A mage projectile deals `damage(attack, armor, crit)`. Every unit of the other team within 2 tiles of the hit point gets the damage intent and `Burn`. This includes the target and minions.
   - A volley projectile deals `max(1, fx.div(damage(attack, armor, crit), 2))` _(tune)_ to its target only.
   - The attacker of a projectile intent is the projectile owner, as a gameId.
2. **Attacks.** A unit that is not stunned, is not `Fleeing`, has cooldown 0, and has a target in range attacks:
   - Warrior, Minion, Warlord: a damage intent. If the hit is a crit and the attacker is a warrior or a warlord, the target gets `Stun`.
   - Mage: one projectile spawn intent, at speed 512.
   - Archer: a **volley** of 3 projectile spawn intents, `j = 0, 1, 2`. Each one starts at the archer position after `move`, has age 0, targets the archer target, and has no offset. Projectile `j` has speed `2048 - 256 * j` _(tune)_. The 3 projectiles share one crit draw.
   - Each projectile starts at the owner position after `move` and has age 0.
   - The phase sorts projectile spawn intents by (attacker gameId, `j`), then assigns gameIds. A mage intent has `j = 0`.
   - Healer: a heal intent. The target gets `Haste`.
   - Then the cooldown resets to the base cooldown. Buffs, heals and damage from this phase take effect in step 4, so no attack in step 2 sees them.
3. Decrement each cooldown above 0 by 1. This includes a cooldown that step 2 just reset.
4. **Resolve.** Sort the damage intents by (victim gameId, attacker gameId). For each unit, sum its damage and heal intents. Then `hp = min(maxHp, hp - damage + heal)`. A unit with `hp <= 0` gets the `Dead` tag.
   - **Overwhelmed.** For each unit, count the enemy units that have `Targets` to it at the start of `combat`. A unit with a count of 6 or more _(tune)_ is `Overwhelmed` in this tick. Each damage intent to an `Overwhelmed` unit, from a unit or from a projectile, becomes `fx.mul(value, 1280)` _(tune)_ (× 1.25) before the sum. Steps 5 and 6 use this value. Burn damage does not change. A projectile is not a unit and does not count. A unit of the victim's own team does not count, so a healer that targets an ally does not add to the count. A stunned attacker counts. A unit that is not `Overwhelmed` in this tick loses the tag.
5. **Last hit and threat.** For each victim, sum the damage intents of each attacker in this tick. Only an attacker unit that exists at the start of `combat` counts. Burn damage never counts here.
   - Set `lastHitBy` to the attacker with the highest sum. A tie goes to the lowest attacker gameId. A victim with no counted intent keeps its `lastHitBy`.
   - If the victim is not `Fleeing`, for each attacker in gameId order: if the victim has a `Threat` edge to it, `amount += sum`. Otherwise add the edge with `amount = sum`. Then clamp `amount` to at most 1,000,000. Then, while the victim has more than 4 edges, remove the edge with the lowest `amount`. A tie removes the edge with the highest attacker gameId. A new edge can be the one removed.
6. Add each damage intent value to `damageN` for the attacker team, with the wrap of §1. The value is the full damage, not limited by the hp left. Heals and burn damage do not count.

### 6.5 `effects`

| Buff | Id | Duration | Effect |
|---|---|---|---|
| `Stun` | 0 | 20 | no target change, no move, no attack |
| `Burn` | 1 | 60 | 2 damage when `ticksLeft % 10 == 0` |
| `Haste` | 2 | 40 | speed × 3/2 (derived stat) |

- A new buff of a kind that the unit already has resets `ticksLeft` to the full duration.
- Each tick, for each buff: decrement `ticksLeft` by 1, then apply burn damage when the new `ticksLeft % 10 == 0`, then remove the buff when `ticksLeft` is 0. A new buff from `combat` has the full duration at the start of this step, so it shows `duration - 1` in the snapshot. A full burn deals 2 damage 6 times.
- A unit at `hp <= 0` after burn gets `Dead`.
- **Threat decay.** When `tick % 20 == 0` _(tune)_, each `Threat` edge does `amount -= max(1, fx.div(amount, 4))`. Remove an edge with `amount <= 0`.

### 6.6 `morale`

Each squad leader has `Morale`. Members, warlords without `Morale`, and minions do not.

1. **Losses.** Take the units that got `Dead` in this tick (in `combat` or `effects`). For each such unit `D`:
   - If `D` has `Morale`, its own `lost += 1`.
   - Else if `D` has a `MemberOf` parent with `Morale`, the parent `lost += 1`.
   - Each unit with `MemberOf(D)` that has `Morale` gets `lost += 2` _(tune)_. This is the loss of a warlord.
   - The sums do not depend on order.
2. **Rout.** For each unit with `Morale` that is not `Routed`: if `lost * 3 >= size0 * 2` _(tune)_, add `Routed`. This step reads the `lost` values from step 1. `Routed` is never removed.
3. **Flee.** When `Routed` is Added in this tick to a leader `L`: `L` gets `Fleeing`, and each unit with `MemberOf(L)` that has no `Morale` gets `Fleeing`. Skip a unit that is `Dead` or already `Fleeing`.
4. **On flee.** When `Fleeing` is Added in this tick to a unit:
   - Remove its `Targets` relation.
   - Remove every `Threat` edge where it is the victim.
   - If it has `Morale`, remove its `MemberOf` to its warlord.
   - If it is `Garrisoned`, it leaves the garrison (§6.14).

A fleeing unit never recovers. `Fleeing` is never removed. The unit leaves the battle at its home edge (§6.7) or dies.

### 6.7 `cleanup`

A **leaving** unit is a unit that is `Fleeing`, is not `Dead`, and has `x` equal to the home edge `x` (§6.3) at the start of `cleanup`. A stunned unit can leave. A unit that got `Fleeing` in this tick's `morale` phase can leave.

Handle the dead units and the leaving units together, in gameId order:

1. **Kill credit** (dead units only).
   - If the unit is not a minion, `kills[enemyTeam] += 1`.
   - If `lastHitBy` of the unit is a unit that exists at the start of `cleanup`, that unit gets `killCount += 1`. A unit that dies in this tick still exists at the start of `cleanup`, so it gets the credit. A minion victim also gives credit.
   - If the credited unit has `Veteran` at the start of `cleanup`, append the victim kind to its `chronicle`. If the chronicle then has more than 4 entries, remove the oldest. Victims are handled in gameId order, so the chronicle order is fixed.
2. **Drop** (dead units only). The equipped item with the lowest gameId becomes a ground item at the unit position, with age 0. It keeps its gameId and quality. Destroy the other items. A leaving unit drops nothing, and all its items are destroyed.
3. Destroy all minions with `ChildOf` this unit. Minions destroyed this way give no kill.
4. **Promotion.** If units have `MemberOf` this unit, the one with the lowest gameId that is not destroyed yet becomes the new head. A dead or leaving unit that waits in the list can be promoted. It is then handled in its turn, and the same rule applies again. A unit that lost its `MemberOf` in `morale` (§6.6 step 4) is not a member here.
   - The new head loses its `MemberOf` to this unit.
   - If this unit has a `MemberOf` parent and the new head is not `Fleeing`, the new head gets the same parent and the same offset. A `Fleeing` head gets no parent. A `Fleeing` unit that has `Morale` never has a `MemberOf` parent.
   - If the new head has no `Morale` and this unit has `Morale`, the new head takes the `Morale` values and the `Routed` tag of this unit.
   - Each other member of this unit gets `MemberOf(new head)`, and its offset becomes `old offset - new head old offset`.
5. Destroy the unit.

Then:

6. Destroy minions that are 300 ticks old. They give no kill and drop nothing.

Then remove all `Targets` and `Threat` relations to or from every unit destroyed so far.

7. Destroy projectiles that are `Spent`, that have no target, or that are 60 ticks old.
8. **Pickup.** Handle ground items in gameId order. Each one goes to the nearest unit of either team in 1.5 tiles that has fewer than 3 items. A minion and a fleeing unit can pick up. A tie goes to the lowest gameId. Quality stays the same. An item that an earlier pickup in this step gave to a unit counts toward its 3 items.
9. Destroy ground items that are 300 ticks old.

### 6.8 `objectives`

For each shrine in gameId order:

1. Count `c0` and `c1`: the units of each team within 4 tiles _(tune)_ of the shrine that are not `Fleeing`, plus the units of each team with `GarrisonOf` this shrine. All unit kinds count. This is one spatial search for each shrine, not one for each unit.
2. `progress = clamp(progress + clamp(c0 - c1, -5, 5), -200, 200)` _(tune)_.
3. If `progress == 200`, `owner = 0`. If `progress == -200`, `owner = 1`. Otherwise `owner` does not change.
4. If `owner` changed in step 3, every unit with `GarrisonOf` this shrine leaves the garrison (§6.14).
5. Garrison entry (§6.14).

Then set `Score.shrines0` and `Score.shrines1` to the number of shrines that each team owns.

### 6.9 `Threat`

`Threat` is a relation from a victim unit to an attacker unit, with an `amount`. The rules are in these places:

- Write and evict: §6.4 step 5.
- Decay: §6.5.
- Drop on flee: §6.6 step 4.
- Drop on destroy: §6.7.
- Read for retaliation: §6.2.

### 6.10 `Veteran`

- `killCount` grows in §6.7 step 1.
- In `stats`, a unit with `killCount >= 3` _(tune)_ and no `Veteran` gets `Veteran`.
- When `Veteran` is Added in this tick, the unit gets a `chronicle` with one entry, `-1`. The entry marks the promotion.
- The `chronicle` holds at most 4 victim kinds, oldest first. §6.7 step 1 appends to it.
- `Veteran` is never removed.

### 6.11 `stats`

1. Add `Veteran` as in §6.10.
2. Compute `bannered` for each unit as in §6.13.
3. Recompute derived stats for each unit with a change in this tick to its `Equips` relations, its item tags, its buffs, its `killCount`, its `Veteran` tag or its `bannered` value. Use change detection (`Added`, `Removed`, `Changed`).
4. Count alive units for each team. All unit kinds count.
5. If exactly one team has 0 alive units after tick 0 and `winner` is -1, set `winner` to the other team. A set `winner` never changes. The game does not stop.
6. Render extraction (§6.15). It sees the writes of steps 1 to 5.

### 6.12 Commander orders

Each team has a commander that names units by `gameId`. The keys come from draws. So a key can name a dead unit, an item, a projectile, a shrine, or a key that no entity has now.

On each tick where `tick % 10 == 0` _(tune)_, at the start of `ai/target`, team 0 and then team 1 give `ordersPerTeam` orders (§11). Let `n` be the value of the `gameId` counter at the start of `ai/target`. So every key that exists is in `[1, n - 1]`. Order `k` (from 0) of team `T` draws `ORDER_PROBES = 6` keys for each of its two roles. Probe `p` (from 0) of a role is `1 + randInt(n - 1, seed, tick, teamGameId(T), role, k * 6 + p)`, with `role` equal to `ORDER_SUBJECT` or `ORDER_OBJECT`.

- The **subject** is the unit of team `T` that the first probe names, taking the probes of `ORDER_SUBJECT` in `p` order. A probe that names no unit or a unit of the other team is skipped.
- The **object** is the unit of the other team that the first probe of `ORDER_OBJECT` names, in the same way.

Most keys name items or projectiles, so one draw would almost never find a unit and the rule would never take effect. A commander that looks again is the reason for the probes, and the commander sees the whole field, so the order has no sight limit. An order with no subject or no object is a **dead-key order**. It changes nothing.

An order **takes effect** when it has a subject and an object, and these are true at the start of the phase:

- The subject is not stunned, not `Fleeing`, not `Garrisoned`, not a healer and not a summoner.
- The object is not `Fleeing` and not `Garrisoned`.

When an order takes effect, the subject targets the object, `ordersT += 1` with the wrap of §1, and the subject skips the other steps of §6.2 in this tick. When an order does not take effect, it changes nothing. Orders go in `k` order. A later order to the same subject replaces the target from an earlier one, and each order that takes effect counts. The checks read start-of-phase values, so an earlier order does not change them.

### 6.13 Banner

A warlord carries a banner. Each unit below a living warlord gets more armor.

- The **chain** of a unit is the list of units that its `MemberOf` and `ChildOf` links reach, up to the unit that has neither link. That last unit is the **root**. A unit with no link is its own root.
- A unit has `bannered = 1` when its root is a warlord and the unit is not the root. Otherwise `bannered = 0`. There is no depth limit. The rule walks the full chain.
- In `stats`, each warlord in the world is alive, because `cleanup` destroys the dead. So a banner falls with its warlord in the same tick.
- A squad leader that loses its warlord link on flee (§6.6 step 4) loses the banner, and its members lose it too. A promoted head that is not a warlord carries no banner.

### 6.14 Garrison

Units can go into a shrine that their team owns. A unit in a garrison has the `Garrisoned` tag and `GarrisonOf` the shrine.

- **Entry** (§6.8 step 5). For a shrine with `owner` 0 or 1, take the units of the owner team within 4 tiles of the shrine (grid search) that are not `Fleeing` and not `Garrisoned`. Sort them by squared distance to the shrine. A tie goes to the lowest `gameId`. Take units in that order while the shrine has fewer than `garrisonCap` units with `GarrisonOf` it (§11). Shrines go in gameId order. The search sees start-of-phase contents, so skip a unit that an earlier shrine took in this step.
- **On entry.** Remove the `Targets` relation from the unit, and every `Targets` relation to it from units and projectiles. The unit leaves the kernel grid.
- **While garrisoned.** The unit does not move, does not choose a target, does not attack and does not pick up items. It is not a valid target and not a heal target. A grid search does not find it, so a mage splash does not hit it. Its buffs, burn damage, `Threat` decay, summons and lifetime continue as normal. Its `Threat` edges stay. Burn can kill it.
- **Exit.** The unit loses `Garrisoned` and `GarrisonOf` when its shrine changes owner (§6.8 step 4) or when it gets `Fleeing` (§6.6 step 4). It goes back into the kernel grid at its position, and it stays at that position. A destroyed unit leaves the garrison with all its relations.
- **Projectiles.** A projectile that targeted the unit has no target after the entry. It does not move and cannot hit, and `cleanup` destroys it (§6.7 step 7).

### 6.15 Render extraction

At the end of `stats`, the implementation writes a flat int32 **render buffer** for a renderer:

1. `unitCount`.
2. Each unit in `gameId` order: `gameId, kind, team, x, y, fx.div(hp * 255, maxHp), flags`. `flags` is the snapshot flags of §8.

Then it folds the buffer into the world value `renderChain`. Start with `h = renderChain >>> 0`. For each int32 of the buffer, for each of its 4 bytes in little-endian order: `h ^= byte`, then `h = imul(h, 0x01000193) >>> 0`. Then `renderChain = h | 0`. Before tick 0, `renderChain = 0x811c9dc5 | 0`.

`renderChain` is in the snapshot (§8). Each tick folds into it. So a run that skips the buffer on any tick gets a different hash at the end.

## 7. Formulas

### 7.1 Crit

A hit is a crit when `randInt(100, seed, tick, attackerGameId, CRIT) < 10`.

### 7.2 Damage

`damage(attack, armor, crit) = max(1, attack - armor) * (crit ? 2 : 1)`. Heal is the healer attack value, with no armor and no crit.

## 8. Snapshot

The **snapshot** is one flat int32 array in this order:

1. World: `tick, alive0, alive1, kills0, kills1, damage0, damage1, winner, shrines0, shrines1, orders0, orders1, renderChain` (`winner = -1` while there is none).
2. `shrineCount`, then each shrine in gameId order: `gameId, owner, progress, garrisonCount, (unitGameId)…`. The garrison units are in gameId order.
3. `unitCount`, then each unit in gameId order:
   `gameId, team, kind, x, y, hp, maxHp, attack, armor, speed, cooldown, targetGameId, leaderGameId, parentGameId, buffCount, (kind, ticksLeft)…, itemCount, (itemGameId, itemKind, quality)…, flags, killCount, lastHitByGameId, moraleSize0, moraleLost, threatCount, (attackerGameId, amount)…, chronicleCount, (victimKind)…`
   - A missing relation is `-1`. `leaderGameId` is the `MemberOf` parent. Buffs are in kind order. Items are in gameId order.
   - `flags`: bit 0 `Fleeing`, bit 1 `Veteran`, bit 2 `Routed`, bit 3 `Overwhelmed`, bit 4 `bannered`, bit 5 `Garrisoned`.
   - `lastHitByGameId` is `-1` when there is no `lastHitBy`, or when that unit does not exist now.
   - `moraleSize0` and `moraleLost` are `-1` for a unit without `Morale`.
   - `Threat` edges are in attacker gameId order.
   - The chronicle is oldest first. `chronicleCount` is 0 for a unit without `Veteran`.
4. `projectileCount`, then each in gameId order: `gameId, ownerGameId, targetGameId, x, y, age, speed, volley` (`volley` is 1 for an archer projectile, else 0).
5. `groundItemCount`, then each in gameId order: `gameId, itemKind, quality, x, y, age`.

## 9. Hash

FNV-1a 32-bit over the snapshot. Feed each int32 as 4 bytes, little-endian.

- **Verify mode:** the trace is the hash after each tick. The golden file is a JSON array of hex strings.
- **Bench mode:** only the hash after the last tick.

## 10. Save and load

The game saves the world at a fixed interval and loads one save. The hash trace must match a run without the load.

- **Save.** After each tick `t` with `t > 0` and `t % 100 == 0` _(tune)_, after the hash, the implementation saves the world. A new save replaces the old one.
- **Load.** After tick `loadTick` (§11) and its hash, the implementation loads the newest save. Let `S` be the tick of that save. The run then continues from tick `S + 1` to the last tick. So ticks `S + 1` to `loadTick` run two times.
- **Contents.** A save holds all state that a later tick reads: every entity with every field, tag, buff, age and cooldown, every relation with its data, `lastSummon`, `bannered`, the `gameId` counter, and every world value (§8 item 1 and `Score`). A save is a deep copy. Ticks after the save do not change it. The form is free: a native world clone, bytes or another form.
- **After load.** Native entity ids can change, but each `gameId` stays the same. The kernel grid must match §3.2 before the next search, so a full re-send is valid. No `Added`, `Removed` or `Changed` state from the discarded ticks can reach a later tick.
- **Driver.** The runner drives the schedule from the scenario (`SAVE_INTERVAL` and `loadTick`) through `Sim.save()` and `Sim.load(state)`. Every run kind uses it, and a headline or deep run counts the save and load time in its total. The state that `save` returns is opaque to the runner. A load replaces the live state of the same sim.
- **Trace length.** A full run has `ticks + (loadTick - S)` hashes, with `S = floor(loadTick / 100) * 100` (50 more in every scenario of §11). A run with `ticks` below `loadTick` never loads.
- **Check.** In verify mode the trace holds one hash for each tick in run order. Each hash must equal the golden hash of its tick. So the replayed ticks must give the same hashes as the first time.

## 11. Scenarios _(tune)_

| Scenario | targetPop each team | wavePeriod | maxSquadsPerWave | surgePeriod | surgeBase | surgeCap each team | garrisonCap | ordersPerTeam | Ticks | loadTick | Smoke ticks | Smoke loadTick |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `skirmish` | 800 | 200 | 70 | 120 | 14 | 1,200 | 8 | 8 | 2,000 | 1,550 | 400 | 350 |
| `battle` | 3,200 | 200 | 200 | 120 | 40 | 4,800 | 32 | 32 | 2,000 | 1,550 | 400 | 350 |
| `war` | 8,000 | 200 | 420 | 120 | 100 | 12,000 | 128 | 128 | 1,000 | 750 | 400 | 350 |

Every number in this table is _(tune)_. The `targetPop` values are first guesses for the peak targets below.

**Seeds.** Timing runs use one seed, `0xEC5A7E7A`. `pnpm verify` and the load budget check use K = 3 seeds: `0xEC5A7E7A`, `0x5EED0002` and `0x5EED0003`. Each scenario has a golden trace for each seed.

A smoke variant runs 400 ticks, so that it includes the first contact, the first surge and the first shrine captures.

**Peak entities** is the highest count, over all ticks, of entities that have a gameId. This includes units, warlords, minions, projectiles, ground items, equipped items and shrines. The peak targets are about 5k for `skirmish`, 20k for `battle` and 50k for `war`. `pnpm run profile` measures them.

Tuning must keep the game alive. In `battle`, each team must own a shrine on some tick.

## 12. Ticks

The first tick is tick 0. A tick runs all 9 phases. The snapshot after a tick holds that tick number. A scenario with `ticks = N` runs ticks `0` to `N - 1`, plus the replayed ticks of §10.
