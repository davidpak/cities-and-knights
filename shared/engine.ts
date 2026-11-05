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
  BANK_EACH, CARD_NAME, CARD_SET, COST, HAND_LIMIT, HARBOR_SET, LARGEST_ARMY_MIN, LONGEST_ROAD_MIN, NUMBER_SET, PIECES,
  RESOURCES, TILE_SET, WIN_POINTS, YIELD, addTo, emptyHand, handSize, hasAll,
  type Buildable, type Card, type Hand, type HarborKind, type PlayerColor, type Resource, type Terrain,
} from './rules.ts'

// ---------------------------------------------------------------- state

export type Tile = { terrain: Terrain; number: number | null }
export type Harbor = { edge: number; kind: HarborKind }
export type Building = { owner: number; kind: 'settlement' | 'city' }
export type HeldCard = { card: Card; turn: number }

export type Player = {
  id: string
  name: string
  color: PlayerColor
  hand: Hand
  cards: HeldCard[]
  knights: number
  pieces: { road: number; settlement: number; city: number }
}

export type Phase =
  | { kind: 'setup'; round: 1 | 2; step: 'settlement' | 'road'; settlement?: number }
  | { kind: 'roll' }
  | { kind: 'discard'; owed: Record<number, number> }
  | { kind: 'robber'; then: 'roll' | 'main' }
  | { kind: 'steal'; hex: number; victims: number[]; then: 'roll' | 'main' }
  | { kind: 'main' }
  | { kind: 'roadBuilding'; left: number }
  | { kind: 'over'; winner: number }

/** a trade put to the table: others say yes or no, then the one who offered picks who to trade with */
export type Offer = { from: number; give: Hand; get: Hand; accepted: number[]; declined: number[] }

/**
 * What happened, one thing at a time, so the table can show it plainly: who rolled what, who got which cards, who
 * traded what with whom. A stolen card's kind is kept only in the thief's and the victim's copies (see viewFor).
 */
export type GameEvent = { n: number } & (
  | { k: 'roll'; p: number; dice: [number, number] }
  | { k: 'gain'; gains: { p: number; got: Partial<Hand> }[]; short?: Resource[] }
  | { k: 'build'; p: number; what: 'road' | 'settlement' | 'city'; at: number; free?: boolean }
  | { k: 'buy'; p: number }
  | { k: 'play'; p: number; card: Card }
  | { k: 'monopoly'; p: number; r: Resource; count: number }
  | { k: 'plenty'; p: number; take: [Resource, Resource] }
  | { k: 'bank'; p: number; give: Resource; count: number; get: Resource }
  | { k: 'offer'; p: number; give: Hand; get: Hand }
  | { k: 'answer'; p: number; yes: boolean }
  | { k: 'trade'; from: number; to: number; give: Hand; get: Hand }
  | { k: 'seven'; p: number; discards: Record<number, number> }
  | { k: 'discard'; p: number; count: number }
  | { k: 'robber'; p: number; hex: number }
  | { k: 'steal'; thief: number; victim: number; r?: Resource }
  | { k: 'award'; what: 'road' | 'army'; p: number | null; was: number | null }
  | { k: 'turn'; p: number }
  | { k: 'win'; p: number; points: number }
)
type EventBody = GameEvent extends infer E ? (E extends { n: number } ? Omit<E, 'n'> : never) : never

export type LogEntry = { n: number; text: string; player?: number }

export type GameState = {
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
  offer: Offer | null
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
  | { type: 'steal'; victim: number }
  | { type: 'buyCard' }
  | { type: 'playKnight' }
  | { type: 'playRoadBuilding' }
  | { type: 'playYearOfPlenty'; take: [Resource, Resource] }
  | { type: 'playMonopoly'; resource: Resource }
  | { type: 'bankTrade'; give: Resource; get: Resource }
  | { type: 'offerTrade'; give: Hand; get: Hand }
  | { type: 'cancelOffer' }
  | { type: 'acceptOffer' }
  | { type: 'declineOffer' }
  | { type: 'confirmTrade'; with: number }
  | { type: 'endTurn' }

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

export function newGame(seats: Seat[], seed: number): GameState {
  if (seats.length < 2 || seats.length > 4) throw new Error('2 to 4 players')
  const s: GameState = {
    rng: seed | 0,
    tiles: [],
    harbors: [],
    players: [],
    buildings: {},
    roads: {},
    robber: 0,
    bank: { lumber: BANK_EACH, brick: BANK_EACH, wool: BANK_EACH, grain: BANK_EACH, ore: BANK_EACH },
    pile: [],
    current: 0,
    turn: 0,
    phase: { kind: 'setup', round: 1, step: 'settlement' },
    dice: null,
    rolls: 0,
    cardPlayed: false,
    offer: null,
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
  s.pile = shuffle(s, CARD_SET)
  const colors: PlayerColor[] = ['red', 'blue', 'orange', 'white']
  s.players = shuffle(s, seats).map((seat, i) => ({
    id: seat.id,
    name: seat.name,
    color: colors[i],
    hand: emptyHand(),
    cards: [],
    knights: 0,
    pieces: { ...PIECES },
  }))
  log(s, `${s.players[0].name} goes first. Place a settlement and a road.`)
  return s
}

/** tiles and numbers, shuffled until no two red numbers (6 and 8) touch */
function dealTiles(s: GameState): Tile[] {
  for (;;) {
    const terrains = shuffle(s, TILE_SET)
    const numbers = shuffle(s, NUMBER_SET)
    let n = 0
    const tiles = terrains.map((terrain) => ({ terrain, number: terrain === 'desert' ? null : numbers[n++] }))
    const red = (i: number) => tiles[i].number === 6 || tiles[i].number === 8
    const ok = TOPO.hexes.every((h, i) => !red(i) || h.neighbors.every((j) => !red(j)))
    if (ok) return tiles
  }
}

// ---------------------------------------------------------------- reading the state

/** what the helpers below read: the full state or a player's view of it */
export type Readable = {
  buildings: Record<number, Building>
  roads: Record<number, number>
  phase: Phase
  robber: number
  harbors: Harbor[]
  turn: number
  cardPlayed: boolean
  players: { hand: Hand | null; cards: HeldCard[] | null }[]
}

export const resourceOf = (t: Tile): Resource | null => (t.terrain === 'desert' ? null : YIELD[t.terrain])

export function victoryPoints(s: GameState, p: number, hidden = true): number {
  let vp = 0
  for (const b of Object.values(s.buildings)) if (b.owner === p) vp += b.kind === 'city' ? 2 : 1
  if (s.longestRoad === p) vp += 2
  if (s.largestArmy === p) vp += 2
  if (hidden) vp += s.players[p].cards.filter((c) => c.card === 'victoryPoint').length
  return vp
}

/** the harbour trade ratio for each resource */
export function tradeRatios(s: Readable, p: number): Record<Resource, number> {
  const out = { lumber: 4, brick: 4, wool: 4, grain: 4, ore: 4 }
  for (const h of s.harbors) {
    const e = TOPO.edges[h.edge]
    const mine = [e.a, e.b].some((v) => s.buildings[v]?.owner === p)
    if (!mine) continue
    for (const r of RESOURCES) out[r] = Math.min(out[r], h.kind === 'any' ? 3 : h.kind === r ? 2 : 4)
  }
  return out
}

const roadTouches = (s: Readable, p: number, v: number) => TOPO.vertices[v].edges.some((e) => s.roads[e] === p)
const blockedFor = (s: Readable, p: number, v: number) => s.buildings[v] !== undefined && s.buildings[v].owner !== p

/** corners where p may put a settlement right now (in setup, anywhere far enough from others) */
export function settlementSpots(s: Readable, p: number): number[] {
  const setup = s.phase.kind === 'setup'
  return TOPO.vertices
    .map((v, i) => ({ v, i }))
    .filter(({ v, i }) => s.buildings[i] === undefined && v.neighbors.every((n) => s.buildings[n] === undefined) && (setup || roadTouches(s, p, i)))
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
  if (victoryPoints(s, p) >= WIN_POINTS) {
    s.phase = { kind: 'over', winner: p }
    s.offer = null
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
      if (b) owed[b.owner][r] += b.kind === 'city' ? 2 : 1
    }
  })
  const short: Resource[] = []
  for (const r of RESOURCES) {
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
  const gains = owed.flatMap((h, i) => (handSize(h) ? [{ p: i, got: Object.fromEntries(RESOURCES.filter((r) => h[r]).map((r) => [r, h[r]])) as Partial<Hand> }] : []))
  ev(s, { k: 'gain', gains, ...(short.length ? { short } : {}) })
  const got = owed
    .map((h, i) => ({ i, list: RESOURCES.filter((r) => h[r] > 0).map((r) => `${h[r]} ${r}`) }))
    .filter((x) => x.list.length)
  for (const g of got) log(s, `${s.players[g.i].name} collects ${g.list.join(', ')}.`, g.i)
}

function afterRobber(s: GameState, hex: number, then: 'roll' | 'main') {
  const victims = victimsAt(s, hex, s.current)
  if (victims.length === 0) s.phase = { kind: then }
  else if (victims.length === 1) {
    steal(s, victims[0])
    s.phase = { kind: then }
  } else s.phase = { kind: 'steal', hex, victims, then }
}

function steal(s: GameState, victim: number) {
  const h = s.players[victim].hand
  const bag = RESOURCES.flatMap((r) => Array<Resource>(h[r]).fill(r))
  if (bag.length === 0) return
  const r = bag[Math.floor(rand(s) * bag.length)]
  h[r]--
  s.players[s.current].hand[r]++
  ev(s, { k: 'steal', thief: s.current, victim, r })
  log(s, `${s.players[s.current].name} takes a card from ${s.players[victim].name}.`, s.current)
}

function startTurn(s: GameState) {
  s.phase = { kind: 'roll' }
  s.dice = null
  s.cardPlayed = false
  s.offer = null
}

export function apply(state: GameState, p: number, a: Action): Result {
  const s: GameState = structuredClone(state)
  const r = step(s, p, a)
  if (r) return fail(r)
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
    if (RESOURCES.some((r) => !Number.isInteger(a.cards[r]) || a.cards[r] < 0) || !hasAll(me.hand, a.cards)) return 'You do not have those cards.'
    pay(s, p, a.cards)
    delete ph.owed[p]
    ev(s, { k: 'discard', p, count: n })
    log(s, `${me.name} discards ${n}.`, p)
    if (Object.keys(ph.owed).length === 0) s.phase = { kind: 'robber', then: 'main' }
    return
  }
  if (a.type === 'acceptOffer' || a.type === 'declineOffer') {
    const o = s.offer
    if (!o || ph.kind !== 'main') return 'There is no trade on the table.'
    if (o.from === p) return 'That is your own offer.'
    if (o.accepted.includes(p) || o.declined.includes(p)) return 'You have already answered.'
    if (a.type === 'acceptOffer' && !hasAll(me.hand, o.get)) return 'You do not have what they ask for.'
    ;(a.type === 'acceptOffer' ? o.accepted : o.declined).push(p)
    ev(s, { k: 'answer', p, yes: a.type === 'acceptOffer' })
    return
  }

  if (!mine) return 'It is not your turn.'

  switch (a.type) {
    case 'buildSettlement': {
      const v = a.vertex
      if (ph.kind === 'setup') {
        if (ph.step !== 'settlement') return 'Place your road first.'
        if (!settlementSpots(s, p).includes(v)) return 'You cannot build there.'
        s.buildings[v] = { owner: p, kind: 'settlement' }
        me.pieces.settlement--
        ev(s, { k: 'build', p, what: 'settlement', at: v, free: true })
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
      const d1 = 1 + Math.floor(rand(s) * 6)
      const d2 = 1 + Math.floor(rand(s) * 6)
      s.dice = [d1, d2]
      s.rolls++
      ev(s, { k: 'roll', p, dice: [d1, d2] })
      const total = d1 + d2
      log(s, `${me.name} rolls ${total}.`, p)
      if (total !== 7) {
        produce(s, total)
        s.phase = { kind: 'main' }
        return
      }
      const owed: Record<number, number> = {}
      s.players.forEach((pl, i) => {
        const n = handSize(pl.hand)
        if (n > HAND_LIMIT) owed[i] = Math.floor(n / 2)
      })
      ev(s, { k: 'seven', p, discards: { ...owed } })
      s.phase = Object.keys(owed).length ? { kind: 'discard', owed } : { kind: 'robber', then: 'main' }
      return
    }
    case 'moveRobber': {
      if (ph.kind !== 'robber') return 'You cannot move the robber now.'
      if (!robberSpots(s).includes(a.hex)) return 'Move the robber to a different tile.'
      s.robber = a.hex
      ev(s, { k: 'robber', p, hex: a.hex })
      log(s, `${me.name} moves the robber.`, p)
      afterRobber(s, a.hex, ph.then)
      return
    }
    case 'steal': {
      if (ph.kind !== 'steal') return 'There is nobody to steal from.'
      if (!ph.victims.includes(a.victim)) return 'Pick someone next to the robber.'
      steal(s, a.victim)
      s.phase = { kind: ph.then }
      return
    }
    case 'buyCard': {
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
      if (!RESOURCES.includes(a.give) || !RESOURCES.includes(a.get) || a.give === a.get) return 'Pick two different resources.'
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
      const valid = (h: Hand) => RESOURCES.every((r) => Number.isInteger(h[r]) && h[r] >= 0)
      if (!valid(a.give) || !valid(a.get)) return 'That is not a trade.'
      if (handSize(a.give) === 0 || handSize(a.get) === 0) return 'Offer something and ask for something.'
      if (RESOURCES.some((r) => a.give[r] > 0 && a.get[r] > 0)) return 'You cannot give and get the same resource.'
      if (!hasAll(me.hand, a.give)) return 'You do not have what you are offering.'
      s.offer = { from: p, give: { ...a.give }, get: { ...a.get }, accepted: [], declined: [] }
      ev(s, { k: 'offer', p, give: { ...a.give }, get: { ...a.get } })
      return
    }
    case 'cancelOffer': {
      s.offer = null
      return
    }
    case 'confirmTrade': {
      const o = s.offer
      if (!o || o.from !== p || ph.kind !== 'main') return 'You have no trade on the table.'
      if (!o.accepted.includes(a.with)) return 'They have not said yes.'
      const them = s.players[a.with]
      if (!hasAll(me.hand, o.give)) return 'You no longer have what you offered.'
      if (!hasAll(them.hand, o.get)) return 'They no longer have what you asked for.'
      addTo(me.hand, o.give, -1)
      addTo(them.hand, o.give, 1)
      addTo(them.hand, o.get, -1)
      addTo(me.hand, o.get, 1)
      ev(s, { k: 'trade', from: p, to: a.with, give: { ...o.give }, get: { ...o.get } })
      log(s, `${me.name} trades with ${them.name}.`, p)
      s.offer = null
      return
    }
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

// ---------------------------------------------------------------- what each player may see

export type View = Omit<GameState, 'rng' | 'pile' | 'players'> & {
  pile: number
  you: number
  players: (Omit<Player, 'hand' | 'cards'> & { hand: Hand | null; handCount: number; cards: HeldCard[] | null; cardCount: number; points: number })[]
}

/** the state as player `you` may see it (-1 for a spectator): others' hands and cards become counts */
export function viewFor(s: GameState, you: number): View {
  const over = s.phase.kind === 'over'
  const { rng: _r, pile, players, ...rest } = s
  void _r
  const base = structuredClone(rest)
  base.events = base.events.map((e) => (e.k === 'steal' && !over && you !== e.thief && you !== e.victim ? { ...e, r: undefined } : e))
  return {
    ...base,
    pile: pile.length,
    you,
    players: players.map((pl, i) => ({
      ...structuredClone(pl),
      hand: i === you ? { ...pl.hand } : null,
      handCount: handSize(pl.hand),
      cards: i === you || over ? structuredClone(pl.cards) : null,
      cardCount: pl.cards.length,
      points: victoryPoints(s, i, i === you || over),
    })),
  }
}
