/**
 * The rules, as one pure function: apply(state, player, action) gives the next state or says why not.
 *
 * The server owns the real state and is the only thing that calls apply for real. Clients use the same helpers
 * (legal spots, costs, ratios) to show what can be clicked, so a click that is offered always succeeds.
 *
 * All chance (the board, the cards, the dice, a stolen card) comes from a seeded generator kept in the state, so a
 * game replays exactly from its seed and actions. The seed and the card pile are stripped from what clients see.
 */
import { TOPO } from './board.ts'
import {
  BANK_EACH, BARBARIAN_STEPS, CARD_NAME, CARD_SET, CITY_YIELD, COMMODITIES, COMMODITY_EACH, COST, EVENT_FACES, GOODS,
  HAND_LIMIT, HAND_LIMIT_PER_WALL, HARBOR_SET, KNIGHT_COST, KNIGHT_PIECES, KNIGHT_POINTS, LARGEST_ARMY_MIN,
  LONGEST_ROAD_MIN, MAX_LEVEL, NUMBER_SET, PIECES, PROGRESS, PROGRESS_CARDS, PROGRESS_LIMIT, PROGRESS_POINTS,
  RESOURCES, TILE_SET, TRACKS, TRACK_GOOD, WALLS, WIN_POINTS, YIELD, addTo, emptyHand, fullHand, handSize, hasAll,
  type Buildable, type Card, type EventFace, type Good, type Hand, type HarborKind, type PlayerColor,
  type Progress, type Resource, type Terrain, type Track,
} from './rules.ts'

// ---------------------------------------------------------------- state

export type Tile = { terrain: Terrain; number: number | null }
export type Harbor = { edge: number; kind: HarborKind }
export type Building = { owner: number; kind: 'settlement' | 'city' }
export type HeldCard = { card: Card; turn: number }
export type HeldProgress = { card: Progress; turn: number }
export type Level = 1 | 2 | 3

/** a knight on a corner: its strength, and whether it stands ready (activated on `readyTurn`: it may act from the
 *  next turn on) */
export type Knight = { owner: number; level: Level; active: boolean; readyTurn: number; promotedTurn: number }

export type Player = {
  id: string
  name: string
  color: PlayerColor
  hand: Hand
  cards: HeldCard[]
  knights: number
  pieces: { road: number; settlement: number; city: number; knight: Record<Level, number>; wall: number }
  /** the expansion's progress cards in hand (point cards are laid down at once: see Expansion.points) */
  progress: HeldProgress[]
}

/** everything the expansion adds to the table */
export type Expansion = {
  knights: Record<number, Knight>
  /** city corners with a wall */
  walls: Record<number, number>
  /** the corner each track's metropolis stands on */
  metropolis: Record<Track, number | null>
  /** each player's level in each track, 0 to 5 */
  levels: Record<Track, number>[]
  /** the barbarians' ship: steps taken toward the island (it lands at BARBARIAN_STEPS) */
  barbarian: number
  /** (while a roll is worked out: who still picks a city to lose, and from which) */
  pillage?: Record<number, number[]>
  /** how many times they've landed (the robber stays in the desert until the first time) */
  attacks: number
  /** points won defending the island */
  defenders: number[]
  /** the three progress piles (only counts reach players) */
  decks: Record<Track, Progress[]>
  /** point cards laid down, per player */
  points: Progress[][]
  merchant: { hex: number; owner: number } | null
  /** the event die's last face */
  event: EventFace | null
  /** this turn's 2:1 charter, and this turn's discount on an improvement */
  charter: { p: number; good: Good; turn: number } | null
  scaffold: { p: number; turn: number } | null
}

/** what a progress card is waiting for */
export type PickNeed = 'hex' | 'road' | 'enemyKnight' | 'knightSpot' | 'player' | 'resource' | 'commodity' | 'good' | 'number' | 'myCity' | 'mySettlement' | 'token' | 'theirCard'

export type Phase =
  | { kind: 'setup'; round: 1 | 2; step: 'settlement' | 'road'; settlement?: number }
  | { kind: 'roll' }
  | { kind: 'discard'; owed: Record<number, number>; then?: 'robber' | 'main' }
  | { kind: 'robber'; then: 'roll' | 'main'; all?: boolean }
  /** the robber picks one card, face down, from a victim's fan (each victim's fan is theirs to arrange, and secret) */
  | { kind: 'steal'; hex: number; victims: number[]; then: 'roll' | 'main'; fans: Record<number, Good[]> }
  | { kind: 'main' }
  | { kind: 'roadBuilding'; left: number }
  /** a progress card waiting for its target (step counts the targets taken; data what they were) */
  | { kind: 'pick'; card: Progress; need: PickNeed; step: number; data: number[]; then: 'roll' | 'main' }
  /** someone holds more than four progress cards: they put back the extra, then play goes on */
  | { kind: 'progressDiscard'; owed: Record<number, number>; then: Phase }
  /** a thief caught sneaking a card gives the victim one of their choice */
  | { kind: 'payback'; thief: number; victim: number; then: Phase }
  /** the barbarians won: each player who loses a city and has more than one to lose picks which (their cities here) */
  | { kind: 'pillage'; owed: Record<number, number[]>; then: Phase }
  | { kind: 'over'; winner: number }

/**
 * A trade put to another player (`to`): they say yes, and it happens; they say no, and it's gone.
 * Without `to` it's put to the whole table: others say yes or no, then the one who offered picks who to trade with.
 * `any` asks for that many more cards of the answerer's choosing (a wildcard): each yes says which (`picks`).
 * Several offers may be open at once.
 */
export type Offer = { id: number; from: number; to?: number; give: Hand; get: Hand; any: number; accepted: number[]; declined: number[]; picks: Record<number, Hand>; expires?: number }
/** how long an offer stays open (ms): then it closes by itself (the server keeps the time, and writes `expires`) */
export const OFFER_MS = 30_000
/** at most this many offers open at once */
export const MAX_OFFERS = 4

/**
 * What happened, one thing at a time, so the table can show it plainly: who rolled what, who got which cards, who
 * traded what with whom. A stolen card's kind is kept only in the thief's and the victim's copies (see viewFor).
 */
export type GameEvent = { n: number } & (
  | { k: 'roll'; p: number; dice: [number, number]; event?: EventFace }
  | { k: 'gain'; gains: { p: number; got: Partial<Hand> }[]; short?: Resource[] }
  | { k: 'build'; p: number; what: 'road' | 'settlement' | 'city'; at: number; free?: boolean }
  | { k: 'buy'; p: number }
  | { k: 'play'; p: number; card: Card }
  | { k: 'monopoly'; p: number; r: Resource; count: number }
  | { k: 'plenty'; p: number; take: [Resource, Resource] }
  | { k: 'bank'; p: number; give: Good; count: number; get: Good }
  | { k: 'offer'; p: number; to?: number; give: Hand; get: Hand; any?: number }
  | { k: 'answer'; p: number; yes: boolean }
  | { k: 'trade'; from: number; to: number; give: Hand; get: Hand }
  | { k: 'seven'; p: number; discards: Record<number, number> }
  | { k: 'discard'; p: number; count: number }
  | { k: 'robber'; p: number; hex: number }
  | { k: 'steal'; thief: number; victim: number; r?: Good }
  /** a card sneaked away (only the thief, and the victim without the thief's name, ever see this) */
  | { k: 'snatch'; thief: number; victim: number; r?: Good }
  /** caught sneaking a card; the card given back for it */
  | { k: 'caught'; thief: number; victim: number; r?: Good }
  /** a city picked to lose to the barbarians (or its wall) */
  | { k: 'pillage'; p: number; at: number; wall: boolean }
  | { k: 'barbarians'; at: number }
  | { k: 'attack'; strength: number; defense: number[]; won: boolean; defender: number | null; tied: number[]; pillaged: { p: number; at: number; wall: boolean }[] }
  | { k: 'draw'; p: number; track: Track; card?: Progress }
  | { k: 'improve'; p: number; track: Track; level: number }
  | { k: 'metropolis'; p: number; track: Track; at: number; from: number | null }
  | { k: 'knight'; p: number; what: 'build' | 'promote' | 'activate' | 'move' | 'displace' | 'chase' | 'lost'; at: number; to?: number; level?: number; victim?: number }
  | { k: 'wall'; p: number; at: number }
  | { k: 'progress'; p: number; card: Progress }
  | { k: 'merchant'; p: number; hex: number }
  | { k: 'take'; p: number; from: number; count: number; what?: Good | 'progress'; card?: Progress }
  | { k: 'swap'; p: number; a: number; b: number }
  | { k: 'unroad'; p: number; at: number; owner: number }
  | { k: 'aqueduct'; p: number; r: Resource }
  | { k: 'award'; what: 'road' | 'army'; p: number | null; was: number | null }
  | { k: 'turn'; p: number }
  | { k: 'win'; p: number; points: number }
)
type EventBody = GameEvent extends infer E ? (E extends { n: number } ? Omit<E, 'n'> : never) : never

export type LogEntry = { n: number; text: string; player?: number }

export type GameState = {
  /** 'knights': the expansion (knights, barbarians, commodities, city improvements, progress cards) */
  mode: 'base' | 'knights'
  x: Expansion | null
  rng: number
  tiles: Tile[]
  harbors: Harbor[]
  players: Player[]
  buildings: Record<number, Building>
  roads: Record<number, number>
  robber: number
  bank: Hand
  pile: Card[]
  current: number
  turn: number
  phase: Phase
  dice: [number, number] | null
  /** counts up on every roll, so clients know to play the throw */
  rolls: number
  cardPlayed: boolean
  offers: Offer[]
  offerSeq: number
  /**
   * A card being sneaked out of someone's hand (dragged across the table). The victim has a moment to catch it
   * ('catch'); if they don't, the server ends it ('snatchEnd') and the thief has a card at random. Caught: the
   * thief owes them a card of their choice ('payback' phase).
   */
  snatch: { id: number; thief: number; victim: number } | null
  /** the turn each player last tried a snatch (once a turn) */
  snatched: Record<number, number>
  longestRoad: number | null
  largestArmy: number | null
  log: LogEntry[]
  logCount: number
  events: GameEvent[]
  eventCount: number
}

export type Action =
  | { type: 'buildSettlement'; vertex: number }
  | { type: 'buildRoad'; edge: number }
  | { type: 'buildCity'; vertex: number }
  | { type: 'roll' }
  | { type: 'discard'; cards: Hand }
  | { type: 'moveRobber'; hex: number }
  | { type: 'steal'; victim: number; index?: number }
  | { type: 'arrange'; order: Good[] }
  | { type: 'pillage'; vertex: number }
  /** sneak a card from someone (any player, during any main phase, once a turn) */
  | { type: 'snatch'; victim: number }
  /** the victim, in time: caught! */
  | { type: 'catch' }
  /** (the server only, when the moment has passed: the thief gets away with it) */
  | { type: 'snatchEnd' }
  /** caught: the card you give back */
  | { type: 'payback'; card: Good }
  | { type: 'buyCard' }
  | { type: 'playKnight' }
  | { type: 'playRoadBuilding' }
  | { type: 'playYearOfPlenty'; take: [Resource, Resource] }
  | { type: 'playMonopoly'; resource: Resource }
  | { type: 'bankTrade'; give: Good; get: Good }
  | { type: 'offerTrade'; give: Hand; get: Hand; to?: number; any?: number }
  /** without an id: all of yours */
  | { type: 'cancelOffer'; id?: number }
  /** `pick`: the cards you choose for its wildcard */
  | { type: 'acceptOffer'; id?: number; pick?: Partial<Hand> }
  | { type: 'declineOffer'; id?: number }
  | { type: 'confirmTrade'; with: number; id?: number }
  | { type: 'endTurn' }
  // the expansion
  | { type: 'buildKnight'; vertex: number }
  | { type: 'promoteKnight'; vertex: number }
  | { type: 'activateKnight'; vertex: number }
  | { type: 'moveKnight'; from: number; to: number }
  | { type: 'chaseRobber'; from: number }
  | { type: 'buildWall'; vertex: number }
  | { type: 'improve'; track: Track }
  | { type: 'playProgress'; card: Progress }
  | { type: 'pick'; target: number | Good }
  | { type: 'cancelPick' }
  | { type: 'discardProgress'; card: Progress }

export type Result = { ok: true; state: GameState } | { ok: false; error: string }

// ---------------------------------------------------------------- chance

/** mulberry32: a step of the generator, kept in the state */
function rand(s: GameState): number {
  let t = (s.rng = (s.rng + 0x6d2b79f5) | 0)
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
function shuffle<T>(s: GameState, a: T[]): T[] {
  const out = [...a]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand(s) * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

// ---------------------------------------------------------------- setting up

export type Seat = { id: string; name: string }

export type Options = { knights?: boolean }

export function newGame(seats: Seat[], seed: number, opts: Options = {}): GameState {
  if (seats.length < 2 || seats.length > 4) throw new Error('2 to 4 players')
  const knights = !!opts.knights
  const s: GameState = {
    mode: knights ? 'knights' : 'base',
    x: null,
    rng: seed | 0,
    tiles: [],
    harbors: [],
    players: [],
    buildings: {},
    roads: {},
    robber: 0,
    bank: { lumber: BANK_EACH, brick: BANK_EACH, wool: BANK_EACH, grain: BANK_EACH, ore: BANK_EACH, paper: knights ? COMMODITY_EACH : 0, cloth: knights ? COMMODITY_EACH : 0, coin: knights ? COMMODITY_EACH : 0 },
    pile: [],
    current: 0,
    turn: 0,
    phase: { kind: 'setup', round: 1, step: 'settlement' },
    dice: null,
    rolls: 0,
    cardPlayed: false,
    offers: [],
    offerSeq: 0,
    snatch: null,
    snatched: {},
    longestRoad: null,
    largestArmy: null,
    log: [],
    logCount: 0,
    events: [],
    eventCount: 0,
  }
  s.tiles = dealTiles(s)
  s.robber = s.tiles.findIndex((t) => t.terrain === 'desert')
  s.harbors = shuffle(s, HARBOR_SET).map((kind, i) => ({ edge: TOPO.harbors[i], kind }))
  s.pile = knights ? [] : shuffle(s, CARD_SET)
  const colors: PlayerColor[] = ['red', 'blue', 'orange', 'white']
  s.players = shuffle(s, seats).map((seat, i) => ({
    id: seat.id,
    name: seat.name,
    color: colors[i],
    hand: emptyHand(),
    cards: [],
    knights: 0,
    pieces: { ...PIECES, knight: { ...KNIGHT_PIECES }, wall: knights ? WALLS : 0 },
    progress: [],
  }))
  if (knights) {
    const deck = (t: Track) => shuffle(s, PROGRESS_CARDS.filter((c) => PROGRESS[c].track === t).flatMap((c) => Array<Progress>(PROGRESS[c].count).fill(c)))
    s.x = {
      knights: {},
      walls: {},
      metropolis: { trade: null, politics: null, science: null },
      levels: s.players.map(() => ({ trade: 0, politics: 0, science: 0 })),
      barbarian: 0,
      attacks: 0,
      defenders: s.players.map(() => 0),
      decks: { trade: deck('trade'), politics: deck('politics'), science: deck('science') },
      points: s.players.map(() => []),
      merchant: null,
      event: null,
      charter: null,
      scaffold: null,
    }
  }
  log(s, `${s.players[0].name} goes first. Place a settlement and a road.`)
  return s
}

export const winPoints = (s: { mode: GameState['mode'] }) => (s.mode === 'knights' ? KNIGHT_POINTS : WIN_POINTS)

/** tiles and numbers, shuffled until no two red numbers (6 and 8) touch and no two touching tiles share a number */
function dealTiles(s: GameState): Tile[] {
  for (;;) {
    const terrains = shuffle(s, TILE_SET)
    const numbers = shuffle(s, NUMBER_SET)
    let n = 0
    const tiles = terrains.map((terrain) => ({ terrain, number: terrain === 'desert' ? null : numbers[n++] }))
    const red = (i: number) => tiles[i].number === 6 || tiles[i].number === 8
    const ok = TOPO.hexes.every((h, i) => h.neighbors.every((j) => !(red(i) && red(j)) && (tiles[i].number === null || tiles[i].number !== tiles[j].number)))
    if (ok) return tiles
  }
}

// ---------------------------------------------------------------- reading the state

/** what the helpers below read: the full state or a player's view of it */
export type Readable = {
  mode?: GameState['mode']
  x?: (Omit<Expansion, 'decks'> & { decks: Record<Track, Progress[] | number> }) | null
  tiles?: Tile[]
  buildings: Record<number, Building>
  roads: Record<number, number>
  phase: Phase
  robber: number
  harbors: Harbor[]
  turn: number
  cardPlayed: boolean
  players: { hand: Hand | null; cards: HeldCard[] | null; pieces?: Player['pieces']; progress?: HeldProgress[] | null }[]
}

export const resourceOf = (t: Tile): Resource | null => (t.terrain === 'desert' ? null : YIELD[t.terrain])

export function victoryPoints(s: GameState, p: number, hidden = true): number {
  let vp = 0
  for (const b of Object.values(s.buildings)) if (b.owner === p) vp += b.kind === 'city' ? 2 : 1
  if (s.longestRoad === p) vp += 2
  if (s.largestArmy === p) vp += 2
  if (hidden) vp += s.players[p].cards.filter((c) => c.card === 'victoryPoint').length
  const x = s.x
  if (x) {
    for (const t of TRACKS) if (x.metropolis[t] !== null && s.buildings[x.metropolis[t]!]?.owner === p) vp += 2
    vp += x.defenders[p] + x.points[p].length
    if (x.merchant?.owner === p) vp += 1
  }
  return vp
}

/** the bank's rate for each kind of card: 4, or better at a harbour; in the expansion also commodities (3 at an
 *  any-kind harbour, 2 with a level-3 trade improvement), the trader's tile 2, and a charter's pick 2 */
export function tradeRatios(s: Readable, p: number): Record<Good, number> {
  const out: Record<Good, number> = { lumber: 4, brick: 4, wool: 4, grain: 4, ore: 4, paper: 4, cloth: 4, coin: 4 }
  for (const h of s.harbors) {
    const e = TOPO.edges[h.edge]
    const mine = [e.a, e.b].some((v) => s.buildings[v]?.owner === p)
    if (!mine) continue
    for (const r of GOODS) out[r] = Math.min(out[r], h.kind === 'any' ? 3 : h.kind === r ? 2 : 4)
  }
  const x = s.x
  if (x) {
    if (x.levels[p].trade >= 3) for (const c of COMMODITIES) out[c] = Math.min(out[c], 2)
    if (x.merchant?.owner === p && s.tiles) {
      const r = resourceOf(s.tiles[x.merchant.hex])
      if (r) out[r] = 2
    }
    if (x.charter?.p === p && x.charter.turn === s.turn) out[x.charter.good] = 2
  }
  return out
}

const roadTouches = (s: Readable, p: number, v: number) => TOPO.vertices[v].edges.some((e) => s.roads[e] === p)
/** someone else's building or knight stands there: a road can't run through it */
const blockedFor = (s: Readable, p: number, v: number) => (s.buildings[v] !== undefined && s.buildings[v].owner !== p) || (s.x?.knights[v] !== undefined && s.x.knights[v].owner !== p)

/** corners where p may put a settlement right now (in setup, anywhere far enough from others) */
export function settlementSpots(s: Readable, p: number): number[] {
  const setup = s.phase.kind === 'setup'
  return TOPO.vertices
    .map((v, i) => ({ v, i }))
    .filter(({ v, i }) => s.buildings[i] === undefined && s.x?.knights[i] === undefined && v.neighbors.every((n) => s.buildings[n] === undefined) && (setup || roadTouches(s, p, i)))
    .map(({ i }) => i)
}

/** sides where p may put a road right now */
export function roadSpots(s: Readable, p: number): number[] {
  const ph = s.phase
  if (ph.kind === 'setup') {
    if (ph.settlement === undefined) return []
    return TOPO.vertices[ph.settlement].edges.filter((e) => s.roads[e] === undefined)
  }
  return TOPO.edges
    .map((e, i) => ({ e, i }))
    .filter(({ e, i }) => {
      if (s.roads[i] !== undefined) return false
      return [e.a, e.b].some((v) => s.buildings[v]?.owner === p || (!blockedFor(s, p, v) && roadTouches(s, p, v)))
    })
    .map(({ i }) => i)
}

export function citySpots(s: Readable, p: number): number[] {
  return Object.entries(s.buildings)
    .filter(([, b]) => b.owner === p && b.kind === 'settlement')
    .map(([v]) => Number(v))
}

// ---------------------------------------------------------------- the expansion: where things may go

const isFree = (s: Readable, v: number) => s.buildings[v] === undefined && s.x?.knights[v] === undefined

/** corners where p may put a new knight: free, on p's roads */
export function knightSpots(s: Readable, p: number): number[] {
  if (!s.x) return []
  return TOPO.vertices.map((_, i) => i).filter((v) => isFree(s, v) && roadTouches(s, p, v))
}

/** the strongest knight p may have: 2, or 3 with a level-3 politics improvement */
export const knightCap = (s: Readable, p: number): Level => ((s.x?.levels[p].politics ?? 0) >= 3 ? 3 : 2)

/** p's knights that may be raised a strength now */
export function promoteSpots(s: Readable, p: number): number[] {
  const x = s.x
  const pieces = s.players[p].pieces
  if (!x || !pieces) return []
  return Object.entries(x.knights)
    .filter(([, k]) => k.owner === p && k.level < knightCap(s, p) && k.promotedTurn !== s.turn && pieces.knight[(k.level + 1) as Level] > 0)
    .map(([v]) => Number(v))
}

export const activateSpots = (s: Readable, p: number): number[] =>
  s.x ? Object.entries(s.x.knights).filter(([, k]) => k.owner === p && !k.active).map(([v]) => Number(v)) : []

/** a knight that may act this turn: ready, and not readied this very turn */
export const canAct = (s: Readable, v: number) => {
  const k = s.x?.knights[v]
  return !!k && k.active && k.readyTurn < s.turn
}

/** where p's knight at `from` may go: along p's own roads, past nothing of anyone else's, to a free corner or onto a
 *  weaker knight of someone else's (which it pushes away) */
export function knightMoves(s: Readable, from: number): number[] {
  const x = s.x
  const k = x?.knights[from]
  if (!x || !k) return []
  const p = k.owner
  const seen = new Set([from])
  const out: number[] = []
  const todo = [from]
  while (todo.length) {
    const v = todo.pop()!
    for (const e of TOPO.vertices[v].edges) {
      if (s.roads[e] !== p) continue
      const ed = TOPO.edges[e]
      const w = ed.a === v ? ed.b : ed.a
      if (seen.has(w)) continue
      seen.add(w)
      const b = s.buildings[w]
      const other = x.knights[w]
      if (b && b.owner !== p) continue
      if (other && other.owner !== p) {
        if (other.level < k.level) out.push(w)
        continue
      }
      if (!b && !other) out.push(w)
      todo.push(w)
    }
  }
  return out.sort((a, b) => a - b)
}

/** p's ready knights next to the robber, which may chase it away (only once the barbarians have landed once) */
export function chaseSpots(s: Readable, p: number): number[] {
  const x = s.x
  if (!x || x.attacks === 0) return []
  return TOPO.hexes[s.robber].vertices.filter((v) => x.knights[v]?.owner === p && canAct(s, v))
}

export const wallSpots = (s: Readable, p: number): number[] =>
  s.x && (s.players[p].pieces?.wall ?? 0) > 0
    ? Object.entries(s.buildings).filter(([v, b]) => b.owner === p && b.kind === 'city' && s.x!.walls[Number(v)] === undefined).map(([v]) => Number(v))
    : []

/** what the next level of a track costs p now (null: there's no next level, or p has no city) */
export function improveCost(s: Readable, p: number, t: Track): Partial<Hand> | null {
  const x = s.x
  if (!x) return null
  const level = x.levels[p][t]
  if (level >= MAX_LEVEL) return null
  if (!Object.values(s.buildings).some((b) => b.owner === p && b.kind === 'city')) return null
  const off = x.scaffold?.p === p && x.scaffold.turn === s.turn ? 1 : 0
  return { [TRACK_GOOD[t]]: Math.max(0, level + 1 - off) }
}

/** the most cards p may hold when a 7 is rolled */
export const handLimit = (s: Readable, p: number) => HAND_LIMIT + (s.x ? Object.values(s.x.walls).filter((o) => o === p).length * HAND_LIMIT_PER_WALL : 0)

/** land tiles next to p's buildings (for the trader, irrigation, mining) */
export function tilesBy(s: Readable, p: number): number[] {
  const out = new Set<number>()
  for (const [v, b] of Object.entries(s.buildings)) if (b.owner === p) for (const h of TOPO.vertices[Number(v)].hexes) out.add(h)
  return [...out].sort((a, b) => a - b)
}

/** roads with an open end (nothing there: no building, no knight, none of the owner's other roads) */
export function openRoads(s: Readable): number[] {
  return Object.entries(s.roads)
    .map(([e, o]) => ({ e: Number(e), o }))
    .filter(({ e, o }) => {
      const ed = TOPO.edges[e]
      return [ed.a, ed.b].some((v) => s.buildings[v]?.owner !== o && s.x?.knights[v]?.owner !== o && !TOPO.vertices[v].edges.some((x) => x !== e && s.roads[x] === o))
    })
    .map(({ e }) => e)
}

/** what a waiting progress card may be pointed at now */
export function pickTargets(s: Readable & { tiles: Tile[]; players: { points?: number }[] }, p: number): (number | Good)[] {
  const ph = s.phase
  if (ph.kind !== 'pick' || !s.x) return []
  const x = s.x
  const points = (i: number) => s.players[i].points ?? 0
  const others = s.players.map((_, i) => i).filter((i) => i !== p)
  switch (ph.need) {
    case 'hex':
      if (ph.card === 'trader') return tilesBy(s, p).filter((h) => s.tiles[h].terrain !== 'desert' && x.merchant?.hex !== h)
      return robberSpots(s)
    case 'road':
      return openRoads(s)
    case 'enemyKnight':
      return Object.entries(x.knights)
        .filter(([v, k]) => k.owner !== p && (ph.card !== 'ruse' || roadTouches(s, p, Number(v))))
        .map(([v]) => Number(v))
    case 'knightSpot':
      return knightSpots(s, p)
    case 'player':
      if (ph.card === 'bargain') return others.filter((i) => points(i) > points(p))
      if (ph.card === 'spy') return others.filter((i) => ((s.players[i] as { progressCount?: number }).progressCount ?? s.players[i].progress?.length ?? 0) > 0)
      return others
    case 'resource':
      return [...RESOURCES]
    case 'commodity':
      return [...COMMODITIES]
    case 'good':
      return [...GOODS]
    case 'number':
      return [2, 3, 4, 5, 6, 8, 9, 10, 11, 12]
    case 'token':
      return s.tiles.map((t, i) => ({ t, i })).filter(({ t, i }) => t.number !== null && ![2, 12, 6, 8].includes(t.number) && !ph.data.includes(i)).map(({ i }) => i)
    case 'myCity':
      return Object.entries(s.buildings).filter(([v, b]) => b.owner === p && b.kind === 'city' && x.walls[Number(v)] === undefined).map(([v]) => Number(v))
    case 'mySettlement':
      return citySpots(s, p)
    case 'theirCard': {
      // (the Spy, looking at someone's progress cards: which of them, by place)
      const them = s.players[ph.data[0]] as { progressCount?: number; progress?: unknown[] | null }
      return Array.from({ length: them.progressCount ?? them.progress?.length ?? 0 }, (_, i) => i)
    }
  }
}

export function robberSpots(s: Readable): number[] {
  return TOPO.hexes.map((_, i) => i).filter((i) => i !== s.robber)
}

/** players with a building on the hex who have something to take */
export function victimsAt(s: GameState, hex: number, thief: number): number[] {
  const out = new Set<number>()
  for (const v of TOPO.hexes[hex].vertices) {
    const b = s.buildings[v]
    if (b && b.owner !== thief && handSize(s.players[b.owner].hand) > 0) out.add(b.owner)
  }
  return [...out].sort((a, b) => a - b)
}

/** the longest single run of p's roads (an opponent's building cuts a run) */
export function longestRun(s: Readable, p: number): number {
  const mine = Object.entries(s.roads).filter(([, o]) => o === p).map(([e]) => Number(e))
  if (mine.length === 0) return 0
  const used = new Set<number>()
  let best = 0
  const walk = (v: number, len: number) => {
    best = Math.max(best, len)
    if (blockedFor(s, p, v)) return
    for (const e of TOPO.vertices[v].edges) {
      if (s.roads[e] !== p || used.has(e)) continue
      used.add(e)
      const ed = TOPO.edges[e]
      walk(ed.a === v ? ed.b : ed.a, len + 1)
      used.delete(e)
    }
  }
  for (const e of mine) {
    const ed = TOPO.edges[e]
    for (const to of [ed.a, ed.b]) {
      used.add(e)
      walk(to, 1)
      used.delete(e)
    }
  }
  return best
}

export const canPlay = (s: Readable, p: number, card: Card) =>
  !s.cardPlayed && (s.players[p].cards ?? []).some((c) => c.card === card && c.turn < s.turn)

export const affordable = (s: Readable, p: number, what: Buildable) => {
  const h = s.players[p].hand
  return h !== null && hasAll(h, COST[what])
}

// ---------------------------------------------------------------- the rules

function log(s: GameState, text: string, player?: number) {
  s.log.push({ n: s.logCount++, text, player })
  if (s.log.length > 60) s.log.splice(0, s.log.length - 60)
}

function ev(s: GameState, e: EventBody) {
  s.events.push({ ...e, n: s.eventCount++ } as GameEvent)
  if (s.events.length > 80) s.events.splice(0, s.events.length - 80)
}

const fail = (error: string): Result => ({ ok: false, error })

function pay(s: GameState, p: number, cost: Partial<Hand>) {
  addTo(s.players[p].hand, cost, -1)
  addTo(s.bank, cost, 1)
}

function updateLongestRoad(s: GameState) {
  const runs = s.players.map((_, i) => longestRun(s, i))
  const max = Math.max(...runs)
  const before = s.longestRoad
  if (max < LONGEST_ROAD_MIN) s.longestRoad = null
  else if (before !== null && runs[before] === max) s.longestRoad = before
  else {
    const top = runs.flatMap((r, i) => (r === max ? [i] : []))
    s.longestRoad = top.length === 1 ? top[0] : null
  }
  if (s.longestRoad !== before) {
    ev(s, { k: 'award', what: 'road', p: s.longestRoad, was: before })
    if (s.longestRoad !== null) log(s, `${s.players[s.longestRoad].name} takes Longest Road (${max}).`, s.longestRoad)
    else log(s, 'Nobody holds Longest Road now.')
  }
}

function checkWin(s: GameState) {
  if (s.phase.kind === 'over') return
  const p = s.current
  if (victoryPoints(s, p) >= winPoints(s)) {
    s.phase = { kind: 'over', winner: p }
    s.offers = []
    ev(s, { k: 'win', p, points: victoryPoints(s, p) })
    log(s, `${s.players[p].name} wins with ${victoryPoints(s, p)} points!`, p)
  }
}

function produce(s: GameState, roll: number) {
  const owed = s.players.map(() => emptyHand())
  s.tiles.forEach((t, hi) => {
    const r = resourceOf(t)
    if (!r || t.number !== roll || hi === s.robber) return
    for (const v of TOPO.hexes[hi].vertices) {
      const b = s.buildings[v]
      if (!b) continue
      if (b.kind === 'settlement') owed[b.owner][r] += 1
      else if (s.mode === 'knights') addTo(owed[b.owner], CITY_YIELD[t.terrain as Exclude<Terrain, 'desert'>])
      else owed[b.owner][r] += 2
    }
  })
  const short: Good[] = []
  for (const r of GOODS) {
    const takers = owed.flatMap((h, i) => (h[r] > 0 ? [i] : []))
    const total = takers.reduce((n, i) => n + owed[i][r], 0)
    if (total === 0) continue
    if (total <= s.bank[r]) {
      for (const i of takers) {
        s.players[i].hand[r] += owed[i][r]
        s.bank[r] -= owed[i][r]
      }
    } else if (takers.length === 1) {
      owed[takers[0]][r] = s.bank[r]
      s.players[takers[0]].hand[r] += s.bank[r]
      s.bank[r] = 0
    } else {
      for (const i of takers) owed[i][r] = 0
      short.push(r)
      log(s, `The bank is short of ${r}: nobody gets any.`)
    }
  }
  const gains = owed.flatMap((h, i) => (handSize(h) ? [{ p: i, got: Object.fromEntries(GOODS.filter((r) => h[r]).map((r) => [r, h[r]])) as Partial<Hand> }] : []))
  ev(s, { k: 'gain', gains, ...(short.length ? { short } : { }) } as EventBody)
  const got = owed
    .map((h, i) => ({ i, list: GOODS.filter((r) => h[r] > 0).map((r) => `${h[r]} ${r}`) }))
    .filter((x) => x.list.length)
  for (const g of got) log(s, `${s.players[g.i].name} collects ${g.list.join(', ')}.`, g.i)
  // the waterworks (science level 3): a roll that brought you nothing brings you a resource of your choosing (the one
  // you have least of)
  const x = s.x
  if (x)
    s.players.forEach((pl, i) => {
      if (x.levels[i].science < 3 || handSize(owed[i]) > 0) return
      const r = [...RESOURCES].filter((g) => s.bank[g] > 0).sort((a, b) => pl.hand[a] - pl.hand[b])[0]
      if (!r) return
      pl.hand[r]++
      s.bank[r]--
      ev(s, { k: 'aqueduct', p: i, r })
    })
}

// ---------------------------------------------------------------- the expansion: what happens

/** from the bank to p, as much as there is */
function fromBank(s: GameState, p: number, d: Partial<Hand>) {
  for (const g of GOODS) {
    const n = Math.min(d[g] ?? 0, s.bank[g])
    s.bank[g] -= n
    s.players[p].hand[g] += n
  }
}

/** up to n cards at random from one hand to another (of the given kinds only, if given) */
function takeRandom(s: GameState, from: number, to: number, n: number, only: readonly Good[] = GOODS): number {
  let taken = 0
  for (let i = 0; i < n; i++) {
    const h = s.players[from].hand
    const bag = only.flatMap((g) => Array<Good>(h[g]).fill(g))
    if (!bag.length) break
    const g = bag[Math.floor(rand(s) * bag.length)]
    h[g]--
    s.players[to].hand[g]++
    taken++
  }
  return taken
}

/** p takes the top progress card of a track; a point card is laid down at once */
function drawProgress(s: GameState, p: number, t: Track) {
  const x = s.x!
  const card = x.decks[t].pop()
  if (!card) return
  if (PROGRESS_POINTS.includes(card)) {
    x.points[p].push(card)
    ev(s, { k: 'draw', p, track: t, card })
    log(s, `${s.players[p].name} lays down ${PROGRESS[card].name} (a point).`, p)
  } else {
    s.players[p].progress.push({ card, turn: s.turn })
    ev(s, { k: 'draw', p, track: t, card })
  }
}

const pipsOf = (s: GameState, v: number) =>
  TOPO.vertices[v].hexes.reduce((n, h) => n + ({ 2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 8: 5, 9: 4, 10: 3, 11: 2, 12: 1 } as Record<number, number>)[s.tiles[h].number ?? 0] || n, 0)

/** the barbarians land. Every city on the island is one of their strength; every ready knight's strength stands
 *  against them. Held off: the strongest defender alone earns a point (equal strongest: each draws a progress card).
 *  Beaten: whoever gave least (of those with a city they can lose) loses one: a walled one loses its wall instead,
 *  otherwise a city becomes a settlement again. Metropolises can't be taken. Then every knight stands down. */
function barbariansLand(s: GameState) {
  const x = s.x!
  const strength = Object.values(s.buildings).filter((b) => b.kind === 'city').length
  const defense = s.players.map((_, i) => Object.values(x.knights).filter((k) => k.owner === i && k.active).reduce((n, k) => n + k.level, 0))
  const total = defense.reduce((a, b) => a + b, 0)
  const won = total >= strength
  let defender: number | null = null
  let tied: number[] = []
  const pillaged: { p: number; at: number; wall: boolean }[] = []
  const metro = new Set(Object.values(x.metropolis).filter((v): v is number => v !== null))
  if (won) {
    const max = Math.max(...defense)
    const top = defense.flatMap((d, i) => (d === max && max > 0 ? [i] : []))
    if (top.length === 1) {
      defender = top[0]
      x.defenders[defender]++
      log(s, `The barbarians are driven off. ${s.players[defender].name} defended the island best (a point).`, defender)
    } else {
      tied = top
      for (const i of top) {
        const t = [...TRACKS].filter((t) => x.decks[t].length).sort((a, b) => x.levels[i][b] - x.levels[i][a])[0]
        if (t) drawProgress(s, i, t)
      }
      log(s, 'The barbarians are driven off.')
    }
  } else {
    const cities = (i: number) => Object.entries(s.buildings).filter(([v, b]) => b.owner === i && b.kind === 'city' && !metro.has(Number(v))).map(([v]) => Number(v))
    const eligible = s.players.map((_, i) => i).filter((i) => cities(i).length > 0)
    if (eligible.length) {
      const min = Math.min(...eligible.map((i) => defense[i]))
      for (const i of eligible.filter((i) => defense[i] === min)) {
        const mine = cities(i)
        // with a choice of cities, they pick (the 'pillage' phase); with one, it's that one
        if (mine.length > 1) x.pillage = { ...(x.pillage ?? {}), [i]: mine }
        else pillaged.push(pillage(s, i, mine[0]))
      }
      log(s, 'The barbarians win: cities are pillaged.')
    }
  }
  for (const k of Object.values(x.knights)) k.active = false
  x.barbarian = 0
  x.attacks++
  ev(s, { k: 'attack', strength, defense, won, defender, tied, pillaged })
  if (pillaged.length) updateLongestRoad(s)
}

/** p's city at v is pillaged: a wall round it falls instead; else it goes back to a settlement */
function pillage(s: GameState, p: number, v: number) {
  const x = s.x!
  if (x.walls[v] !== undefined) {
    delete x.walls[v]
    s.players[p].pieces.wall++
    return { p, at: v, wall: true }
  }
  const pl = s.players[p]
  pl.pieces.city++
  if (pl.pieces.settlement > 0) {
    s.buildings[v] = { owner: p, kind: 'settlement' }
    pl.pieces.settlement--
  } else delete s.buildings[v]
  return { p, at: v, wall: false }
}

/** after a roll: if someone has a city to pick for the barbarians, that comes first */
function holdForPillage(s: GameState) {
  const x = s.x
  if (!x?.pillage || !Object.keys(x.pillage).length) return
  s.phase = { kind: 'pillage', owed: x.pillage, then: s.phase }
  delete x.pillage
}

/** reaching level 4 of a track first raises a metropolis on one of your cities; reaching 5 first takes it from
 *  someone who only has 4 */
function settleMetropolis(s: GameState, p: number, t: Track) {
  const x = s.x!
  const level = x.levels[p][t]
  if (level < 4) return
  const at = x.metropolis[t]
  const owner = at !== null ? s.buildings[at]?.owner : undefined
  if (owner === p) return
  if (at !== null && owner !== undefined && !(level === 5 && x.levels[owner][t] < 5)) return
  const taken = new Set(Object.values(x.metropolis).filter((v): v is number => v !== null))
  const mine = Object.entries(s.buildings).filter(([v, b]) => b.owner === p && b.kind === 'city' && !taken.has(Number(v))).map(([v]) => Number(v))
  if (!mine.length) return
  const v = mine.sort((a, b) => pipsOf(s, b) - pipsOf(s, a))[0]
  x.metropolis[t] = v
  ev(s, { k: 'metropolis', p, track: t, at: v, from: owner ?? null })
  log(s, `${s.players[p].name} raises a metropolis.`, p)
}

/** a knight pushed off its corner moves along its owner's roads to the nearest free corner, or leaves the board */
function relocate(s: GameState, k: Knight, from: number) {
  const x = s.x!
  const seen = new Set([from])
  let ring = [from]
  while (ring.length) {
    const next: number[] = []
    for (const v of ring)
      for (const e of TOPO.vertices[v].edges) {
        if (s.roads[e] !== k.owner) continue
        const ed = TOPO.edges[e]
        const w = ed.a === v ? ed.b : ed.a
        if (seen.has(w)) continue
        seen.add(w)
        const b = s.buildings[w]
        if ((b && b.owner !== k.owner) || (x.knights[w] && x.knights[w].owner !== k.owner)) continue
        if (!b && !x.knights[w]) {
          x.knights[w] = k
          return w
        }
        next.push(w)
      }
    ring = next.sort((a, b) => a - b)
  }
  s.players[k.owner].pieces.knight[k.level]++
  ev(s, { k: 'knight', p: k.owner, what: 'lost', at: from, level: k.level })
  return null
}

/** anyone over the four-card limit puts the extra back before play goes on */
function enforceProgressLimit(s: GameState) {
  if (!s.x || s.phase.kind === 'over' || s.phase.kind === 'progressDiscard') return
  const owed: Record<number, number> = {}
  s.players.forEach((pl, i) => {
    if (pl.progress.length > PROGRESS_LIMIT) owed[i] = pl.progress.length - PROGRESS_LIMIT
  })
  if (Object.keys(owed).length) s.phase = { kind: 'progressDiscard', owed, then: s.phase }
}

/** a roll (or an augury's chosen number): in the expansion the red die, the yellow one and the event die */
function rollDice(s: GameState, p: number, forced?: number) {
  const me = s.players[p]
  const x = s.x
  const d1 = forced !== undefined ? Math.floor(forced / 2) : 1 + Math.floor(rand(s) * 6)
  const d2 = forced !== undefined ? forced - Math.floor(forced / 2) : 1 + Math.floor(rand(s) * 6)
  s.dice = [d1, d2]
  s.rolls++
  const total = d1 + d2
  if (!x) {
    ev(s, { k: 'roll', p, dice: [d1, d2] })
    log(s, `${me.name} rolls ${total}.`, p)
  } else {
    const face = EVENT_FACES[Math.floor(rand(s) * 6)]
    x.event = face
    ev(s, { k: 'roll', p, dice: [d1, d2], event: face })
    log(s, `${me.name} rolls ${total}.`, p)
    if (face === 'ship') {
      x.barbarian++
      ev(s, { k: 'barbarians', at: x.barbarian })
      if (x.barbarian >= BARBARIAN_STEPS) barbariansLand(s)
    } else {
      // a gate: everyone far enough along that track, by the red die, draws one of its cards
      for (let k = 0; k < s.players.length; k++) {
        const i = (p + k) % s.players.length
        const level = x.levels[i][face]
        if (level >= 1 && d1 <= level + 1) drawProgress(s, i, face)
      }
    }
  }
  if (total !== 7) {
    produce(s, total)
    s.phase = { kind: 'main' }
    return
  }
  const owed: Record<number, number> = {}
  s.players.forEach((pl, i) => {
    const n = handSize(pl.hand)
    if (n > handLimit(s, i)) owed[i] = Math.floor(n / 2)
  })
  ev(s, { k: 'seven', p, discards: { ...owed } })
  // in the expansion the robber stays in the desert until the barbarians have landed once
  const robs = !x || x.attacks > 0
  s.phase = Object.keys(owed).length ? { kind: 'discard', owed, then: robs ? 'robber' : 'main' } : robs ? { kind: 'robber', then: 'main' } : { kind: 'main' }
}

const bagOf = (h: Hand) => GOODS.flatMap((r) => Array<Good>(h[r]).fill(r))
/** a hand as a fan of face-down cards, in a random order */
const fanOf = (s: GameState, h: Hand) => shuffle(s, bagOf(h))
/** is this order exactly the cards of this hand? */
const sameCards = (order: Good[], h: Hand) => order.length === handSize(h) && GOODS.every((r) => order.filter((g) => g === r).length === h[r])

function afterRobber(s: GameState, hex: number, then: 'roll' | 'main') {
  const victims = victimsAt(s, hex, s.current)
  if (victims.length === 0) s.phase = { kind: then }
  else s.phase = { kind: 'steal', hex, victims, then, fans: Object.fromEntries(victims.map((v) => [v, fanOf(s, s.players[v].hand)])) }
}

/** the thief takes the card at `index` of the victim's fan (or, without one, a card at random) */
function steal(s: GameState, victim: number, fan?: Good[], index?: number) {
  const h = s.players[victim].hand
  const bag = fan && sameCards(fan, h) ? fan : bagOf(h)
  if (bag.length === 0) return
  const r = index !== undefined && fan === bag ? bag[index] : bag[Math.floor(rand(s) * bag.length)]
  h[r]--
  s.players[s.current].hand[r]++
  ev(s, { k: 'steal', thief: s.current, victim, r })
  log(s, `${s.players[s.current].name} takes a card from ${s.players[victim].name}.`, s.current)
}

function startTurn(s: GameState) {
  s.phase = { kind: 'roll' }
  s.dice = null
  s.cardPlayed = false
  s.offers = []
  s.snatch = null
}

/** an offer settled with `to`: the offer's give one way; its get, and the wildcard's pick, the other */
function trade(s: GameState, o: Offer, to: number, pick: Hand): string | void {
  const from = s.players[o.from]
  const them = s.players[to]
  const get = fullHand(o.get)
  addTo(get, pick, 1)
  if (!hasAll(from.hand, o.give)) return o.from === s.current ? 'You no longer have what you offered.' : 'They no longer have what they offered.'
  if (!hasAll(them.hand, get)) return 'They no longer have what you asked for.'
  addTo(from.hand, o.give, -1)
  addTo(them.hand, o.give, 1)
  addTo(them.hand, get, -1)
  addTo(from.hand, get, 1)
  ev(s, { k: 'trade', from: o.from, to, give: { ...o.give }, get })
  log(s, `${from.name} trades with ${them.name}.`, o.from)
}

export function apply(state: GameState, p: number, a: Action): Result {
  const s: GameState = structuredClone(state)
  const r = step(s, p, a)
  if (r) return fail(r)
  enforceProgressLimit(s)
  checkWin(s)
  return { ok: true, state: s }
}

/** changes s in place; returns an error message, or nothing when it worked */
function step(s: GameState, p: number, a: Action): string | void {
  const ph = s.phase
  if (ph.kind === 'over') return 'The game is over.'
  const me = s.players[p]
  if (!me) return 'You are not in this game.'
  const mine = p === s.current

  // things other players can do out of turn
  if (a.type === 'discard') {
    if (ph.kind !== 'discard' || !(p in ph.owed)) return 'You have nothing to discard.'
    const n = handSize(a.cards)
    if (n !== ph.owed[p]) return `Discard exactly ${ph.owed[p]}.`
    if (GOODS.some((r) => !Number.isInteger(a.cards[r] ?? 0) || (a.cards[r] ?? 0) < 0) || !hasAll(me.hand, a.cards)) return 'You do not have those cards.'
    pay(s, p, a.cards)
    delete ph.owed[p]
    ev(s, { k: 'discard', p, count: n })
    log(s, `${me.name} discards ${n}.`, p)
    if (Object.keys(ph.owed).length === 0) s.phase = ph.then === 'main' ? { kind: 'main' } : { kind: 'robber', then: 'main' }
    return
  }
  if (a.type === 'snatch') {
    if (ph.kind !== 'main' || s.snatch) return 'Not now.'
    if (a.victim === p || !s.players[a.victim]) return 'Pick someone else.'
    if (s.snatched[p] === s.turn) return 'Once a turn.'
    if (!handSize(s.players[a.victim].hand)) return 'They have no cards.'
    s.snatch = { id: s.eventCount + 1, thief: p, victim: a.victim }
    s.snatched[p] = s.turn
    return
  }
  if (a.type === 'catch') {
    const sn = s.snatch
    if (!sn || sn.victim !== p) return 'Nothing to catch.'
    s.snatch = null
    ev(s, { k: 'caught', thief: sn.thief, victim: sn.victim })
    // they owe a card back (if they have one)
    if (handSize(s.players[sn.thief].hand)) s.phase = { kind: 'payback', thief: sn.thief, victim: sn.victim, then: s.phase }
    return
  }
  if (a.type === 'snatchEnd') {
    const sn = s.snatch
    if (!sn || sn.thief !== p) return 'Nothing to end.'
    s.snatch = null
    const h = s.players[sn.victim].hand
    const bag = GOODS.flatMap((r) => Array<Good>(h[r]).fill(r))
    if (!bag.length) return
    const r = bag[Math.floor(rand(s) * bag.length)]
    h[r]--
    s.players[sn.thief].hand[r]++
    ev(s, { k: 'snatch', thief: sn.thief, victim: sn.victim, r })
    return
  }
  if (a.type === 'payback') {
    if (ph.kind !== 'payback' || ph.thief !== p) return 'Nothing to give back.'
    if (!(me.hand[a.card] > 0)) return 'You do not have that card.'
    me.hand[a.card]--
    s.players[ph.victim].hand[a.card]++
    ev(s, { k: 'caught', thief: p, victim: ph.victim, r: a.card })
    s.phase = ph.then
    return
  }
  if (a.type === 'pillage') {
    if (ph.kind !== 'pillage' || !ph.owed[p]) return 'Nothing to pick.'
    if (!ph.owed[p].includes(a.vertex)) return 'Pick one of your cities.'
    const lost = pillage(s, p, a.vertex)
    delete ph.owed[p]
    ev(s, { k: 'pillage', ...lost })
    updateLongestRoad(s)
    if (!Object.keys(ph.owed).length) s.phase = ph.then
    return
  }
  if (a.type === 'arrange') {
    if (ph.kind !== 'steal' || !ph.victims.includes(p)) return 'Nothing to arrange.'
    if (!Array.isArray(a.order) || !sameCards(a.order, me.hand)) return 'Those are not your cards.'
    ph.fans[p] = [...a.order]
    return
  }
  if (a.type === 'discardProgress') {
    if (ph.kind !== 'progressDiscard' || !ph.owed[p]) return 'You may keep your progress cards.'
    const i = me.progress.findIndex((c) => c.card === a.card)
    if (i < 0) return 'You do not have that card.'
    const [c] = me.progress.splice(i, 1)
    s.x!.decks[PROGRESS[c.card].track].unshift(c.card)
    if (--ph.owed[p] === 0) delete ph.owed[p]
    if (Object.keys(ph.owed).length === 0) s.phase = ph.then
    return
  }
  if (a.type === 'acceptOffer' || a.type === 'declineOffer') {
    if (ph.kind !== 'main') return 'There is no trade on the table.'
    const open = s.offers.filter((o) => o.from !== p && (o.to === undefined || o.to === p) && !o.accepted.includes(p) && !o.declined.includes(p))
    const o = a.id !== undefined ? open.find((x) => x.id === a.id) : open[open.length - 1]
    if (!o) return 'There is no trade on the table.'
    let pick = emptyHand()
    if (a.type === 'acceptOffer') {
      if (o.any) {
        if (!a.pick || GOODS.some((r) => !Number.isInteger(a.pick![r] ?? 0) || (a.pick![r] ?? 0) < 0)) return 'Pick the cards to give.'
        pick = fullHand(a.pick)
        if (handSize(pick) !== o.any) return `Pick ${o.any}.`
        if (GOODS.some((r) => pick[r] > 0 && o.give[r] > 0)) return 'Not a kind they give.'
        if (s.mode !== 'knights' && COMMODITIES.some((c) => pick[c])) return 'That is not a trade.'
      }
      const owed = fullHand(o.get)
      addTo(owed, pick, 1)
      if (!hasAll(me.hand, owed)) return 'You do not have what they ask for.'
    }
    ev(s, { k: 'answer', p, yes: a.type === 'acceptOffer' })
    if (o.to === undefined) {
      ;(a.type === 'acceptOffer' ? o.accepted : o.declined).push(p)
      if (a.type === 'acceptOffer' && o.any) o.picks[p] = pick
      return
    }
    // an offer made to you alone: no closes it, yes makes the trade there and then
    s.offers = s.offers.filter((x) => x !== o)
    if (a.type === 'declineOffer') return
    return trade(s, o, p, pick)
  }

  if (!mine) return 'It is not your turn.'

  switch (a.type) {
    case 'buildSettlement': {
      const v = a.vertex
      if (ph.kind === 'setup') {
        if (ph.step !== 'settlement') return 'Place your road first.'
        if (!settlementSpots(s, p).includes(v)) return 'You cannot build there.'
        // in the expansion the second piece placed is a city
        const city = s.mode === 'knights' && ph.round === 2
        s.buildings[v] = { owner: p, kind: city ? 'city' : 'settlement' }
        if (city) me.pieces.city--
        else me.pieces.settlement--
        ev(s, { k: 'build', p, what: city ? 'city' : 'settlement', at: v, free: true })
        if (ph.round === 2) {
          for (const h of TOPO.vertices[v].hexes) {
            const r = resourceOf(s.tiles[h])
            if (r && s.bank[r] > 0) {
              me.hand[r]++
              s.bank[r]--
            }
          }
        }
        s.phase = { kind: 'setup', round: ph.round, step: 'road', settlement: v }
        return
      }
      if (ph.kind !== 'main') return 'You cannot build now.'
      if (me.pieces.settlement === 0) return 'You have no settlements left.'
      if (!affordable(s, p, 'settlement')) return 'You cannot afford a settlement.'
      if (!settlementSpots(s, p).includes(v)) return 'You cannot build there.'
      pay(s, p, COST.settlement)
      s.buildings[v] = { owner: p, kind: 'settlement' }
      me.pieces.settlement--
      ev(s, { k: 'build', p, what: 'settlement', at: v })
      log(s, `${me.name} builds a settlement.`, p)
      updateLongestRoad(s)
      return
    }
    case 'buildRoad': {
      const e = a.edge
      if (ph.kind === 'setup') {
        if (ph.step !== 'road') return 'Place your settlement first.'
        if (!roadSpots(s, p).includes(e)) return 'The road must touch the settlement you just placed.'
        s.roads[e] = p
        me.pieces.road--
        ev(s, { k: 'build', p, what: 'road', at: e, free: true })
        const n = s.players.length
        if (ph.round === 1) {
          if (s.current < n - 1) {
            s.current++
            s.phase = { kind: 'setup', round: 1, step: 'settlement' }
          } else s.phase = { kind: 'setup', round: 2, step: 'settlement' }
        } else if (s.current > 0) {
          s.current--
          s.phase = { kind: 'setup', round: 2, step: 'settlement' }
        } else {
          s.turn = 1
          startTurn(s)
          ev(s, { k: 'turn', p: 0 })
          log(s, `Setup is done. ${s.players[0].name}, roll the dice.`)
          return
        }
        log(s, `${s.players[s.current].name}, place a settlement and a road.`, s.current)
        return
      }
      if (ph.kind === 'roadBuilding') {
        if (!roadSpots(s, p).includes(e)) return 'You cannot build a road there.'
        s.roads[e] = p
        me.pieces.road--
        ev(s, { k: 'build', p, what: 'road', at: e, free: true })
        const left = ph.left - 1
        s.phase = left > 0 && me.pieces.road > 0 && roadSpots(s, p).length > 0 ? { kind: 'roadBuilding', left } : { kind: 'main' }
        updateLongestRoad(s)
        return
      }
      if (ph.kind !== 'main') return 'You cannot build now.'
      if (me.pieces.road === 0) return 'You have no roads left.'
      if (!affordable(s, p, 'road')) return 'You cannot afford a road.'
      if (!roadSpots(s, p).includes(e)) return 'You cannot build a road there.'
      pay(s, p, COST.road)
      s.roads[e] = p
      me.pieces.road--
      ev(s, { k: 'build', p, what: 'road', at: e })
      updateLongestRoad(s)
      return
    }
    case 'buildCity': {
      if (ph.kind !== 'main') return 'You cannot build now.'
      if (me.pieces.city === 0) return 'You have no cities left.'
      if (!affordable(s, p, 'city')) return 'You cannot afford a city.'
      if (!citySpots(s, p).includes(a.vertex)) return 'A city must replace one of your settlements.'
      pay(s, p, COST.city)
      s.buildings[a.vertex] = { owner: p, kind: 'city' }
      me.pieces.city--
      me.pieces.settlement++
      ev(s, { k: 'build', p, what: 'city', at: a.vertex })
      log(s, `${me.name} builds a city.`, p)
      return
    }
    case 'roll': {
      if (ph.kind !== 'roll') return 'You have already rolled.'
      rollDice(s, p)
      holdForPillage(s)
      return
    }
    case 'moveRobber': {
      if (ph.kind !== 'robber') return 'You cannot move the robber now.'
      if (!robberSpots(s).includes(a.hex)) return 'Move the robber to a different tile.'
      s.robber = a.hex
      ev(s, { k: 'robber', p, hex: a.hex })
      log(s, `${me.name} moves the robber.`, p)
      if (ph.all) {
        for (const v of victimsAt(s, a.hex, p)) steal(s, v)
        s.phase = { kind: ph.then }
        return
      }
      afterRobber(s, a.hex, ph.then)
      return
    }
    case 'steal': {
      if (ph.kind !== 'steal') return 'There is nobody to steal from.'
      if (!ph.victims.includes(a.victim)) return 'Pick someone next to the robber.'
      const fan = ph.fans?.[a.victim]
      if (a.index !== undefined && (!Number.isInteger(a.index) || a.index < 0 || a.index >= handSize(s.players[a.victim].hand))) return 'Pick one of their cards.'
      steal(s, a.victim, fan, a.index)
      s.phase = { kind: ph.then }
      return
    }
    case 'buyCard': {
      if (s.mode === 'knights') return 'This game has progress cards instead.'
      if (ph.kind !== 'main') return 'You cannot buy a card now.'
      if (s.pile.length === 0) return 'There are no cards left.'
      if (!affordable(s, p, 'card')) return 'You cannot afford a card.'
      pay(s, p, COST.card)
      me.cards.push({ card: s.pile.pop()!, turn: s.turn })
      ev(s, { k: 'buy', p })
      log(s, `${me.name} buys a card.`, p)
      return
    }
    case 'playKnight':
    case 'playRoadBuilding':
    case 'playYearOfPlenty':
    case 'playMonopoly': {
      if (s.mode === 'knights') return 'This game has progress cards instead.'
      const card: Card = ({ playKnight: 'knight', playRoadBuilding: 'roadBuilding', playYearOfPlenty: 'yearOfPlenty', playMonopoly: 'monopoly' } as const)[a.type]
      const when = card === 'knight' ? ph.kind === 'roll' || ph.kind === 'main' : ph.kind === 'main'
      if (!when) return 'You cannot play that card now.'
      if (s.cardPlayed) return 'You have already played a card this turn.'
      if (!canPlay(s, p, card)) return 'You do not have that card (or bought it this turn).'
      if (a.type === 'playYearOfPlenty' && (a.take.some((r) => !RESOURCES.includes(r)) || a.take.length !== 2)) return 'Pick two resources.'
      if (a.type === 'playYearOfPlenty') {
        const need = emptyHand()
        for (const r of a.take) need[r]++
        if (!hasAll(s.bank, need)) return 'The bank does not have those.'
      }
      if (a.type === 'playMonopoly' && !RESOURCES.includes(a.resource)) return 'Pick a resource.'
      if (a.type === 'playRoadBuilding' && (me.pieces.road === 0 || roadSpots(s, p).length === 0)) return 'You have nowhere to build a road.'
      me.cards.splice(me.cards.findIndex((c) => c.card === card && c.turn < s.turn), 1)
      s.cardPlayed = true
      ev(s, { k: 'play', p, card })
      log(s, `${me.name} plays ${CARD_NAME[card]}.`, p)
      if (a.type === 'playKnight') {
        me.knights++
        const holder = s.largestArmy
        if (me.knights >= LARGEST_ARMY_MIN && holder !== p && (holder === null || me.knights > s.players[holder].knights)) {
          s.largestArmy = p
          ev(s, { k: 'award', what: 'army', p, was: holder })
          log(s, `${me.name} takes Largest Army (${me.knights}).`, p)
        }
        s.phase = { kind: 'robber', then: ph.kind === 'roll' ? 'roll' : 'main' }
      } else if (a.type === 'playRoadBuilding') {
        s.phase = { kind: 'roadBuilding', left: 2 }
      } else if (a.type === 'playYearOfPlenty') {
        for (const r of a.take) {
          me.hand[r]++
          s.bank[r]--
        }
        ev(s, { k: 'plenty', p, take: a.take })
      } else {
        let n = 0
        s.players.forEach((o, i) => {
          if (i === p) return
          n += o.hand[a.resource]
          me.hand[a.resource] += o.hand[a.resource]
          o.hand[a.resource] = 0
        })
        ev(s, { k: 'monopoly', p, r: a.resource, count: n })
        log(s, `${me.name} collects ${n} ${a.resource}.`, p)
      }
      return
    }
    case 'bankTrade': {
      if (ph.kind !== 'main') return 'You cannot trade now.'
      const kinds: readonly Good[] = s.mode === 'knights' ? GOODS : RESOURCES
      if (!kinds.includes(a.give) || !kinds.includes(a.get) || a.give === a.get) return 'Pick two different kinds of card.'
      const ratio = tradeRatios(s, p)[a.give]
      if (me.hand[a.give] < ratio) return `You need ${ratio} ${a.give}.`
      if (s.bank[a.get] === 0) return `The bank has no ${a.get}.`
      me.hand[a.give] -= ratio
      s.bank[a.give] += ratio
      me.hand[a.get]++
      s.bank[a.get]--
      ev(s, { k: 'bank', p, give: a.give, count: ratio, get: a.get })
      log(s, `${me.name} trades ${ratio} ${a.give} for 1 ${a.get} with the bank.`, p)
      return
    }
    case 'offerTrade': {
      if (ph.kind !== 'main') return 'You cannot trade now.'
      const valid = (h: Hand) => GOODS.every((r) => Number.isInteger(h[r] ?? 0) && (h[r] ?? 0) >= 0) && (s.mode === 'knights' || COMMODITIES.every((c) => !h[c]))
      const any = a.any ?? 0
      if (!valid(a.give) || !valid(a.get) || !Number.isInteger(any) || any < 0 || any > 7) return 'That is not a trade.'
      if (handSize(a.give) === 0 || handSize(a.get) + any === 0) return 'Offer something and ask for something.'
      if (GOODS.some((r) => a.give[r] > 0 && a.get[r] > 0)) return 'You cannot give and get the same kind.'
      if (!hasAll(me.hand, a.give)) return 'You do not have what you are offering.'
      if (a.to !== undefined && (a.to === p || !s.players[a.to])) return 'Pick another player to trade with.'
      if (s.offers.filter((o) => o.from === p).length >= MAX_OFFERS) return 'Too many offers open.'
      const give = fullHand(a.give)
      const get = fullHand(a.get)
      s.offers.push({ id: ++s.offerSeq, from: p, ...(a.to !== undefined ? { to: a.to } : {}), give, get, any, accepted: [], declined: [], picks: {} })
      ev(s, { k: 'offer', p, ...(a.to !== undefined ? { to: a.to } : {}), give: { ...give }, get: { ...get }, ...(any ? { any } : {}) })
      return
    }
    case 'cancelOffer': {
      s.offers = s.offers.filter((o) => o.from !== p || (a.id !== undefined && o.id !== a.id))
      return
    }
    case 'confirmTrade': {
      const o = s.offers.find((x) => x.from === p && (a.id === undefined || x.id === a.id) && x.accepted.includes(a.with))
      if (!o || ph.kind !== 'main') return 'You have no trade on the table.'
      const err = trade(s, o, a.with, o.picks[a.with] ?? emptyHand())
      if (err) return err
      s.offers = s.offers.filter((x) => x !== o)
      return
    }
    case 'buildKnight':
    case 'promoteKnight':
    case 'activateKnight':
    case 'moveKnight':
    case 'chaseRobber':
    case 'buildWall':
    case 'improve':
    case 'playProgress':
    case 'pick':
    case 'cancelPick':
      if (!s.x) return 'That is part of the expansion.'
      return expansionStep(s, p, a)
    case 'endTurn': {
      if (ph.kind !== 'main') return ph.kind === 'roll' ? 'Roll the dice first.' : 'Finish what you are doing first.'
      s.current = (s.current + 1) % s.players.length
      s.turn++
      startTurn(s)
      ev(s, { k: 'turn', p: s.current })
      log(s, `${s.players[s.current].name}'s turn.`, s.current)
      return
    }
  }
  return 'Unknown action.'
}

// ---------------------------------------------------------------- the expansion's moves

type ExpansionAction = Extract<Action, { type: 'buildKnight' | 'promoteKnight' | 'activateKnight' | 'moveKnight' | 'chaseRobber' | 'buildWall' | 'improve' | 'playProgress' | 'pick' | 'cancelPick' }>

/** what each progress card asks for first (none: it happens at once) */
const FIRST_NEED: Partial<Record<Progress, PickNeed>> = {
  trader: 'hex',
  charter: 'good',
  corner: 'resource',
  guild: 'commodity',
  bargain: 'player',
  turncoat: 'enemyKnight',
  envoy: 'road',
  ruse: 'enemyKnight',
  spy: 'player',
  augury: 'number',
  mason: 'myCity',
  surveyor: 'token',
  physician: 'mySettlement',
}

const withPoints = (s: GameState) => ({ ...s, players: s.players.map((pl, i) => ({ ...pl, points: victoryPoints(s, i) })) })

function expansionStep(s: GameState, p: number, a: ExpansionAction): string | void {
  const x = s.x!
  const ph = s.phase
  const me = s.players[p]
  const main = ph.kind === 'main'
  switch (a.type) {
    case 'buildKnight': {
      if (!main) return 'You cannot build now.'
      if (me.pieces.knight[1] === 0) return 'You have no knights left.'
      if (!hasAll(me.hand, KNIGHT_COST.knight)) return 'A knight costs 1 wool and 1 ore.'
      if (!knightSpots(s, p).includes(a.vertex)) return 'A knight goes on a free corner on your roads.'
      pay(s, p, KNIGHT_COST.knight)
      x.knights[a.vertex] = { owner: p, level: 1, active: false, readyTurn: -1, promotedTurn: s.turn }
      me.pieces.knight[1]--
      ev(s, { k: 'knight', p, what: 'build', at: a.vertex, level: 1 })
      log(s, `${me.name} raises a knight.`, p)
      updateLongestRoad(s)
      return
    }
    case 'promoteKnight': {
      if (!main) return 'You cannot do that now.'
      if (!promoteSpots(s, p).includes(a.vertex)) return 'That knight cannot be raised now.'
      if (!hasAll(me.hand, KNIGHT_COST.promote)) return 'Raising a knight costs 1 wool and 1 ore.'
      pay(s, p, KNIGHT_COST.promote)
      promote(s, p, a.vertex)
      return
    }
    case 'activateKnight': {
      if (!main) return 'You cannot do that now.'
      if (!activateSpots(s, p).includes(a.vertex)) return 'That is not one of your resting knights.'
      if (!hasAll(me.hand, KNIGHT_COST.activate)) return 'Readying a knight costs 1 grain.'
      pay(s, p, KNIGHT_COST.activate)
      const k = x.knights[a.vertex]
      k.active = true
      k.readyTurn = s.turn
      ev(s, { k: 'knight', p, what: 'activate', at: a.vertex, level: k.level })
      return
    }
    case 'moveKnight': {
      if (!main) return 'You cannot do that now.'
      const k = x.knights[a.from]
      if (!k || k.owner !== p) return 'That is not your knight.'
      if (!canAct(s, a.from)) return k.active ? 'A knight readied this turn can act from your next turn.' : 'Ready the knight first (1 grain).'
      if (!knightMoves(s, a.from).includes(a.to)) return 'It cannot get there along your roads.'
      delete x.knights[a.from]
      const other = x.knights[a.to]
      if (other) {
        delete x.knights[a.to]
        x.knights[a.to] = { ...k, active: false }
        const went = relocate(s, other, a.to)
        ev(s, { k: 'knight', p, what: 'displace', at: a.from, to: a.to, level: k.level, victim: other.owner })
        log(s, `${me.name}'s knight pushes ${s.players[other.owner].name}'s away${went === null ? ' (it leaves the board)' : ''}.`, p)
      } else {
        x.knights[a.to] = { ...k, active: false }
        ev(s, { k: 'knight', p, what: 'move', at: a.from, to: a.to, level: k.level })
      }
      updateLongestRoad(s)
      return
    }
    case 'chaseRobber': {
      if (!main) return 'You cannot do that now.'
      if (!chaseSpots(s, p).includes(a.from)) return 'You need a ready knight next to the robber.'
      x.knights[a.from].active = false
      ev(s, { k: 'knight', p, what: 'chase', at: a.from, level: x.knights[a.from].level })
      s.phase = { kind: 'robber', then: 'main' }
      return
    }
    case 'buildWall': {
      if (!main) return 'You cannot build now.'
      if (!wallSpots(s, p).includes(a.vertex)) return 'A wall goes round one of your cities.'
      if (!hasAll(me.hand, KNIGHT_COST.wall)) return 'A city wall costs 2 brick.'
      pay(s, p, KNIGHT_COST.wall)
      x.walls[a.vertex] = p
      me.pieces.wall--
      ev(s, { k: 'wall', p, at: a.vertex })
      log(s, `${me.name} builds a city wall.`, p)
      return
    }
    case 'improve': {
      if (!main) return 'You cannot do that now.'
      if (!TRACKS.includes(a.track)) return 'Pick a track.'
      const cost = improveCost(s, p, a.track)
      if (!cost) return x.levels[p][a.track] >= MAX_LEVEL ? 'That track is complete.' : 'You need a city first.'
      if (!hasAll(me.hand, cost)) return `That costs ${handSize(cost)} ${TRACK_GOOD[a.track]}.`
      pay(s, p, cost)
      if (x.scaffold?.p === p && x.scaffold.turn === s.turn) x.scaffold = null
      x.levels[p][a.track]++
      ev(s, { k: 'improve', p, track: a.track, level: x.levels[p][a.track] })
      log(s, `${me.name} improves ${a.track} to ${x.levels[p][a.track]}.`, p)
      settleMetropolis(s, p, a.track)
      return
    }
    case 'playProgress': {
      const card = a.card
      if (!PROGRESS[card]) return 'There is no such card.'
      const i = me.progress.findIndex((c) => c.card === card)
      if (i < 0) return 'You do not have that card.'
      if (card === 'augury' ? ph.kind !== 'roll' : !main) return card === 'augury' ? 'Augury is played before you roll.' : 'You cannot play that now.'
      if (s.offers.length) return 'Settle the trades on the table first.'
      const need = FIRST_NEED[card]
      const then = ph.kind === 'roll' ? 'roll' : 'main'
      if (need) {
        const pending: Phase = { kind: 'pick', card, need, step: 0, data: [], then }
        const probe = { ...withPoints(s), phase: pending }
        if (!pickTargets(probe, p).length) return 'There is nothing to use it on now.'
        if (card === 'mason' && me.pieces.wall === 0) return 'You have no walls left.'
        if (card === 'physician' && (me.pieces.city === 0 || !hasAll(me.hand, { ore: 2, grain: 1 }))) return 'That needs a city piece, 2 ore and 1 grain.'
        if (card === 'turncoat' && Object.values(x.knights).every((k) => k.owner === p)) return 'There is nothing to use it on now.'
        me.progress.splice(i, 1)
        // a card played goes back under its pile
        x.decks[PROGRESS[card].track].unshift(card)
        ev(s, { k: 'progress', p, card })
        s.phase = pending
        return
      }
      if (card === 'roadCrew' && (me.pieces.road === 0 || roadSpots(s, p).length === 0)) return 'You have nowhere to build a road.'
      if (card === 'smith' && promoteSpots(s, p).length === 0) return 'None of your knights can be raised.'
      if (card === 'rally' && activateSpots(s, p).length === 0) return 'Your knights are all ready.'
      me.progress.splice(i, 1)
      x.decks[PROGRESS[card].track].unshift(card)
      ev(s, { k: 'progress', p, card })
      log(s, `${me.name} plays ${PROGRESS[card].name}.`, p)
      const mine = victoryPoints(s, p)
      switch (card) {
        case 'caravan':
          s.players.forEach((_, o) => {
            if (o === p) return
            const n = takeRandom(s, o, p, 1, COMMODITIES)
            if (n) ev(s, { k: 'take', p, from: o, count: n })
          })
          return
        case 'feast':
          s.players.forEach((_, o) => {
            if (o === p || victoryPoints(s, o) <= mine) return
            const n = takeRandom(s, o, p, 2)
            if (n) ev(s, { k: 'take', p, from: o, count: n })
          })
          return
        case 'unrest': {
          const owed: Record<number, number> = {}
          s.players.forEach((pl, o) => {
            if (o !== p && victoryPoints(s, o) >= mine && handSize(pl.hand) >= 2) owed[o] = Math.floor(handSize(pl.hand) / 2)
          })
          if (Object.keys(owed).length) s.phase = { kind: 'discard', owed, then: 'main' }
          return
        }
        case 'rally':
          for (const k of Object.values(x.knights)) if (k.owner === p && !k.active) (k.active = true), (k.readyTurn = s.turn)
          return
        case 'irrigation':
        case 'mining': {
          const terrain: Terrain = card === 'irrigation' ? 'fields' : 'mountains'
          const n = tilesBy(s, p).filter((h) => s.tiles[h].terrain === terrain).length
          fromBank(s, p, card === 'irrigation' ? { grain: 2 * n } : { ore: 2 * n })
          return
        }
        case 'scaffold':
          x.scaffold = { p, turn: s.turn }
          return
        case 'smith': {
          for (let k = 0; k < 2; k++) {
            const spots = promoteSpots(s, p).sort((a, b) => x.knights[a].level - x.knights[b].level)
            if (!spots.length) break
            promote(s, p, spots[0])
          }
          return
        }
        case 'roadCrew':
          s.phase = { kind: 'roadBuilding', left: 2 }
          return
        case 'sheriff':
          s.phase = { kind: 'robber', then: 'main', all: true }
          return
      }
      return
    }
    case 'cancelPick': {
      if (ph.kind !== 'pick') return 'Nothing is waiting.'
      if (ph.step > 0) return 'It has already begun.'
      // (taken back out from under its pile, where playing it put it)
      const deck = s.x!.decks[PROGRESS[ph.card].track]
      const at = deck.indexOf(ph.card)
      if (at >= 0) deck.splice(at, 1)
      me.progress.push({ card: ph.card, turn: s.turn })
      s.phase = { kind: ph.then }
      return
    }
    case 'pick': {
      if (ph.kind !== 'pick') return 'Nothing is waiting for a pick.'
      const targets = pickTargets(withPoints(s), p)
      if (!targets.includes(a.target)) return 'Pick one of the highlighted things.'
      const t = a.target
      const done = () => (s.phase = { kind: ph.then })
      switch (ph.card) {
        case 'trader':
          x.merchant = { hex: t as number, owner: p }
          ev(s, { k: 'merchant', p, hex: t as number })
          log(s, `${me.name} sends the trader out.`, p)
          return void done()
        case 'charter':
          x.charter = { p, good: t as Good, turn: s.turn }
          return void done()
        case 'corner':
        case 'guild': {
          const g = t as Good
          const most = ph.card === 'corner' ? 2 : 1
          s.players.forEach((pl, o) => {
            if (o === p) return
            const n = Math.min(most, pl.hand[g])
            pl.hand[g] -= n
            me.hand[g] += n
            if (n) ev(s, { k: 'take', p, from: o, count: n, what: g })
          })
          return void done()
        }
        case 'bargain': {
          const n = takeRandom(s, t as number, p, 2)
          ev(s, { k: 'take', p, from: t as number, count: n })
          return void done()
        }
        case 'spy': {
          // first who, then (looking at their cards) which one
          if (ph.step === 0) {
            s.phase = { ...ph, step: 1, need: 'theirCard', data: [t as number] }
            return
          }
          const from = s.players[ph.data[0]]
          const c = from.progress.splice(t as number, 1)[0]
          me.progress.push({ card: c.card, turn: s.turn })
          ev(s, { k: 'take', p, from: ph.data[0], count: 1, what: 'progress', card: c.card })
          return void done()
        }
        case 'envoy': {
          const e = t as number
          const owner = s.roads[e]
          delete s.roads[e]
          s.players[owner].pieces.road++
          ev(s, { k: 'unroad', p, at: e, owner })
          updateLongestRoad(s)
          return void done()
        }
        case 'ruse': {
          const v = t as number
          const k = x.knights[v]
          delete x.knights[v]
          const went = relocate(s, k, v)
          ev(s, { k: 'knight', p, what: 'displace', at: v, to: went ?? undefined, level: k.level, victim: k.owner })
          updateLongestRoad(s)
          return void done()
        }
        case 'turncoat': {
          if (ph.step === 0) {
            const v = t as number
            const k = x.knights[v]
            delete x.knights[v]
            s.players[k.owner].pieces.knight[k.level]++
            ev(s, { k: 'knight', p: k.owner, what: 'lost', at: v, level: k.level })
            updateLongestRoad(s)
            // one of yours as strong as it was (or the strongest you can field) comes in, free
            const level = ([k.level, 2, 1] as Level[]).find((l) => l <= knightCap(s, p) && me.pieces.knight[l] > 0)
            if (level === undefined || !knightSpots(s, p).length) return void done()
            s.phase = { ...ph, need: 'knightSpot', step: 1, data: [level] }
            return
          }
          const level = ph.data[0] as Level
          x.knights[t as number] = { owner: p, level, active: false, readyTurn: -1, promotedTurn: s.turn }
          me.pieces.knight[level]--
          ev(s, { k: 'knight', p, what: 'build', at: t as number, level })
          updateLongestRoad(s)
          return void done()
        }
        case 'augury':
          s.phase = { kind: 'roll' }
          rollDice(s, p, t as number)
          holdForPillage(s)
          return
        case 'mason':
          x.walls[t as number] = p
          me.pieces.wall--
          ev(s, { k: 'wall', p, at: t as number })
          return void done()
        case 'surveyor': {
          if (ph.step === 0) {
            s.phase = { ...ph, step: 1, data: [t as number] }
            return
          }
          const a0 = ph.data[0]
          const b0 = t as number
          const n = s.tiles[a0].number
          s.tiles[a0].number = s.tiles[b0].number
          s.tiles[b0].number = n
          ev(s, { k: 'swap', p, a: a0, b: b0 })
          return void done()
        }
        case 'physician': {
          const v = t as number
          pay(s, p, { ore: 2, grain: 1 })
          s.buildings[v] = { owner: p, kind: 'city' }
          me.pieces.city--
          me.pieces.settlement++
          ev(s, { k: 'build', p, what: 'city', at: v })
          return void done()
        }
      }
      return 'Unknown pick.'
    }
  }
}

function promote(s: GameState, p: number, v: number) {
  const k = s.x!.knights[v]
  const me = s.players[p]
  me.pieces.knight[k.level]++
  k.level = (k.level + 1) as Level
  me.pieces.knight[k.level]--
  k.promotedTurn = s.turn
  ev(s, { k: 'knight', p, what: 'promote', at: v, level: k.level })
}

// ---------------------------------------------------------------- what each player may see

export type View = Omit<GameState, 'rng' | 'pile' | 'players' | 'x'> & {
  pile: number
  you: number
  x: (Omit<Expansion, 'decks'> & { decks: Record<Track, number> }) | null
  players: (Omit<Player, 'hand' | 'cards' | 'progress'> & { hand: Hand | null; handCount: number; cards: HeldCard[] | null; cardCount: number; progress: HeldProgress[] | null; progressCount: number; points: number })[]
}

/** the state as player `you` may see it (-1 for a spectator): others' hands and cards become counts */
export function viewFor(s: GameState, you: number): View {
  const over = s.phase.kind === 'over'
  const { rng: _r, pile, players, x, ...rest } = s
  void _r
  const base = structuredClone(rest)
  // a fan's order is its holder's secret: others see only how many cards are in it
  if (base.phase.kind === 'steal') base.phase.fans = Object.fromEntries(Object.entries(base.phase.fans ?? {}).map(([v, f]) => [v, Number(v) === you ? f : f.map(() => 'lumber' as Good)]))
  base.events = base.events.map((e) => {
    if (over) return e
    if (e.k === 'steal' && you !== e.thief && you !== e.victim) return { ...e, r: undefined }
    // a card sneaked away: the thief knows; the victim knows a card went, not who took it; nobody else knows at all
    if (e.k === 'snatch' && you !== e.thief) return you === e.victim ? { ...e, thief: -1 } : null
    // a drawn progress card is the drawer's secret (point cards are laid down for all to see), and so is a spied one
    if (e.k === 'draw' && e.p !== you && e.card && !PROGRESS_POINTS.includes(e.card)) return { ...e, card: undefined }
    if (e.k === 'take' && e.card && you !== e.p && you !== e.from) return { ...e, card: undefined }
    return e
  }).filter((e): e is GameEvent => e !== null)
  // a snatch under way: the victim sees that it's happening, not who; the thief sees theirs; nobody else anything
  if (base.snatch && you !== base.snatch.thief) base.snatch = you === base.snatch.victim ? { ...base.snatch, thief: -1 } : null
  const xv = x ? { ...structuredClone(x), decks: { trade: x.decks.trade.length, politics: x.decks.politics.length, science: x.decks.science.length } } : null
  return {
    ...base,
    x: xv,
    pile: pile.length,
    you,
    players: players.map((pl, i) => ({
      ...structuredClone(pl),
      hand: i === you ? { ...pl.hand } : null,
      handCount: handSize(pl.hand),
      cards: i === you || over ? structuredClone(pl.cards) : null,
      cardCount: pl.cards.length,
      progress: i === you || over || (s.phase.kind === 'pick' && s.phase.card === 'spy' && s.phase.need === 'theirCard' && s.phase.data[0] === i && s.current === you) ? structuredClone(pl.progress) : null,
      progressCount: pl.progress.length,
      points: victoryPoints(s, i, i === you || over),
    })),
  }
}
