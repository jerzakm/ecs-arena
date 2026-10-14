export interface Item { gameId: number; kind: number; quality: number }
export interface Edge { attacker: number; amount: number }
export interface Morale { size0: number; lost: number }
export interface Unit {
  gameId: number; team: number; kind: number
  x: number; y: number
  h: number // grid handle
  hp: number; maxHp: number; attack: number; armor: number; speed: number; cooldown: number
  target: number
  memberOf: number
  offX: number; offY: number
  childOf: number
  items: Item[]
  itemMask: number // item tags: bit k is set while the unit holds an item of kind k
  buffs: [number, number, number] // ticksLeft by buff kind, 0 = absent
  threat: Edge[] // victim side of Threat, ascending attacker gameId
  morale: Morale | null
  fleeing: boolean; routed: boolean; veteran: boolean
  overwhelmed: boolean // set at the start of combat
  bannered: boolean // the root of its MemberOf and ChildOf chain is a warlord and it is not the root
  killCount: number
  lastHitBy: number
  chronicle: number[]
  lastSummon: number
  age: number
  // scratch, valid inside one phase or between two adjacent phases
  sx: number; sy: number
  dmgIn: number; healIn: number; stunIn: boolean; burnIn: boolean; hasteIn: boolean
  dead: boolean; destroyed: boolean
}
export interface Projectile {
  gameId: number; owner: number; target: number; x: number; y: number; age: number; speed: number; volley: boolean
  ownerTeam: number; ownerKind: number; attack: number; crit: boolean; spent: boolean // fixed at fire time
}
export interface GroundItem { gameId: number; kind: number; quality: number; x: number; y: number; age: number }
export interface Shrine { gameId: number; y: number; owner: number; progress: number }
export interface DamageIntent { victim: Unit; attacker: number; team: number; value: number }

/**
 * Optional region timer (runner/src/budget.ts). `begin` and `end` bracket a named facet region and may nest.
 * `naive` names the regions that run their naive code (same hash, slower). Without it every call is a no-op.
 */
export interface Regions {
  begin(name: string): void
  end(name: string): void
  naive: ReadonlySet<string>
}

/** Optional work-count hooks (runner/src/profile.ts). `add` accumulates, `set` records a per-tick gauge. Never read back. */
export interface Counters {
  add(name: string, n?: number): void
  set(name: string, v: number): void
}
