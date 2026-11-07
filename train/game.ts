/**
 * A mirror of the Rust simulator's `Game` (sim/src/lib.rs), built from the real engine's `GameState`, plus the
 * reading helpers the encoder needs (sim/src/encode.rs, and the parts of lib.rs it calls). This lets the network
 * encoder and player (train/encode.ts, train/agent.ts) run over the live game exactly as the Rust trainer does.
 *
 * Indices follow the Rust side, NOT shared/rules.ts: terrains are [forest, pasture, fields, hills, mountains,
 * desert] and cards [knight, victoryPoint, roadBuilding, yearOfPlenty, monopoly] (the same orders sim/parity.ts
 * redefines for its fingerprint). The adapter maps the engine's names onto these.
 */
import { readFileSync } from 'node:fs'
import type { GameState, Phase as EnginePhase } from '../shared/engine.ts'

// ---------------------------------------------------------------- the board (the same topo.json the Rust side reads)

type TopoJ = {
  hexes: { vertices: number[]; neighbors: number[] }[]
  vertices: { hexes: number[]; neighbors: number[]; edges: number[] }[]
  edges: [number, number][]
  harbors: number[]
  tileSet: string[]
  numberSet: number[]
  harborSet: string[]
  cardSet: string[]
}
const topoJ: TopoJ = JSON.parse(readFileSync(new URL('../sim/topo.json', import.meta.url), 'utf8'))

export const HEXES = 19
export const VERTS = 54
export const EDGES = 72

export const Topo = {
  hexVertices: topoJ.hexes.map((h) => h.vertices),
  hexNeighbors: topoJ.hexes.map((h) => h.neighbors),
  vertHexes: topoJ.vertices.map((v) => v.hexes),
  vertNeighbors: topoJ.vertices.map((v) => v.neighbors),
  vertEdges: topoJ.vertices.map((v) => v.edges),
  edges: topoJ.edges,
  harbors: topoJ.harbors,
}

// ---------------------------------------------------------------- the rules' numbers and names (Rust order)

export const TERRAINS = ['forest', 'pasture', 'fields', 'hills', 'mountains', 'desert']
export const DESERT = 5
export const RES = ['lumber', 'brick', 'wool', 'grain', 'ore'] as const
export const CARDS = ['knight', 'victoryPoint', 'roadBuilding', 'yearOfPlenty', 'monopoly']
export const KNIGHT = 0
export const VP_CARD = 1
export const ROAD_BUILDING = 2
export const PLENTY = 3
export const MONOPOLY = 4
export const ANY = 5
/** the resource a terrain yields, by terrain index (forest lumber, pasture wool, fields grain, hills brick, mountains ore) */
export const YIELD = [0, 2, 3, 1, 4]

export const BANK_EACH = 19
export const WIN_POINTS = 10
export const HAND_LIMIT = 7
export const LONGEST_ROAD_MIN = 5
export const LARGEST_ARMY_MIN = 3
export const COST_ROAD = [1, 1, 0, 0, 0]
export const COST_SETTLEMENT = [1, 1, 1, 1, 0]
export const COST_CITY = [0, 0, 0, 2, 3]
export const COST_CARD = [0, 0, 1, 1, 1]

export const NO = -1

const terrainIdx = (t: string) => TERRAINS.indexOf(t)
const cardIdx = (c: string) => CARDS.indexOf(c)
const resIdx = (r: string) => (RES as readonly string[]).indexOf(r)
const harborIdx = (k: string) => (k === 'any' ? ANY : resIdx(k))

// ---------------------------------------------------------------- the state (a mirror of Rust's Game)

export type Player = {
  hand: number[] // [lumber, brick, wool, grain, ore]
  cards: [number, number][] // (card index, the turn it was bought)
  knights: number
  roads: number
  settlements: number
  cities: number
}

/** a faithful mirror of Rust's Phase; the encoder needs the bucket, the agent needs owed/victims/round/left */
export type Phase =
  | { kind: 'setup'; round: number; road: boolean; settlement: number }
  | { kind: 'roll' }
  | { kind: 'main' }
  | { kind: 'discard'; owed: number[] }
  | { kind: 'robber'; then: 'roll' | 'main' }
  | { kind: 'steal'; hex: number; victims: number[]; then: 'roll' | 'main' }
  | { kind: 'roadBuilding'; left: number }
  | { kind: 'over'; winner: number }

export type Game = {
  terrain: number[]
  number: number[]
  harbors: [number, number][] // (edge, kind index)
  players: Player[]
  owner: number[] // per vertex, NO if none
  kind: number[] // per vertex, 1 settlement, 2 city
  road: number[] // per edge, owner or NO
  robber: number
  bank: number[]
  pileLen: number
  current: number
  turn: number
  phase: Phase
  cardPlayed: boolean
  longestRoad: number
  largestArmy: number
}

const handArr = (h: Record<string, number>) => RES.map((r) => h[r] ?? 0)

function phaseOf(ph: EnginePhase, n: number): Phase {
  switch (ph.kind) {
    case 'setup':
      return { kind: 'setup', round: ph.round, road: ph.step === 'road', settlement: ph.settlement ?? NO }
    case 'roll':
      return { kind: 'roll' }
    case 'main':
      return { kind: 'main' }
    case 'discard': {
      const owed = Array<number>(n).fill(0)
      for (const [i, m] of Object.entries(ph.owed)) owed[Number(i)] = m
      return { kind: 'discard', owed }
    }
    case 'robber':
      return { kind: 'robber', then: ph.then }
    case 'steal':
      return { kind: 'steal', hex: ph.hex, victims: [...ph.victims], then: ph.then }
    case 'roadBuilding':
      return { kind: 'roadBuilding', left: ph.left }
    case 'over':
      return { kind: 'over', winner: ph.winner }
    default:
      throw new Error(`phase ${ph.kind} is not in the base game`)
  }
}

/** build the mirror from a real engine state (base game only) */
export function gameFromState(s: GameState): Game {
  const n = s.players.length
  const owner = Array<number>(VERTS).fill(NO)
  const kind = Array<number>(VERTS).fill(0)
  for (const [v, b] of Object.entries(s.buildings)) {
    owner[Number(v)] = b.owner
    kind[Number(v)] = b.kind === 'city' ? 2 : 1
  }
  const road = Array<number>(EDGES).fill(NO)
  for (const [e, o] of Object.entries(s.roads)) road[Number(e)] = o
  return {
    terrain: s.tiles.map((t) => terrainIdx(t.terrain)),
    number: s.tiles.map((t) => t.number ?? 0),
    harbors: s.harbors.map((h) => [h.edge, harborIdx(h.kind)] as [number, number]),
    players: s.players.map((p) => ({
      hand: handArr(p.hand),
      cards: p.cards.map((c) => [cardIdx(c.card), c.turn] as [number, number]),
      knights: p.knights,
      roads: p.pieces.road,
      settlements: p.pieces.settlement,
      cities: p.pieces.city,
    })),
    owner,
    kind,
    road,
    robber: s.robber,
    bank: handArr(s.bank),
    pileLen: s.pile.length,
    current: s.current,
    turn: s.turn,
    phase: phaseOf(s.phase, n),
    cardPlayed: s.cardPlayed,
    longestRoad: s.longestRoad ?? NO,
    largestArmy: s.largestArmy ?? NO,
  }
}

// ---------------------------------------------------------------- reading the state (ported from lib.rs / encode.rs)

export const handSize = (g: Game, p: number) => g.players[p].hand.reduce((a, b) => a + b, 0)

export function victoryPoints(g: Game, p: number, hidden: boolean): number {
  let vp = 0
  for (let v = 0; v < VERTS; v++) if (g.owner[v] === p) vp += g.kind[v]
  if (g.longestRoad === p) vp += 2
  if (g.largestArmy === p) vp += 2
  if (hidden) vp += g.players[p].cards.filter((c) => c[0] === VP_CARD).length
  return vp
}

/** the bank's rate for each resource (4, or better at a harbour p owns) */
export function ratios(g: Game, p: number): number[] {
  const out = [4, 4, 4, 4, 4]
  for (const [e, k] of g.harbors) {
    const [a, b] = Topo.edges[e]
    if (g.owner[a] !== p && g.owner[b] !== p) continue
    for (let r = 0; r < 5; r++) out[r] = Math.min(out[r], k === ANY ? 3 : k === r ? 2 : 4)
  }
  return out
}

/** a player's production in pips, by resource (PIPS[number] summed over the tiles their towns touch) */
export const PIPS = [0, 0, 1, 2, 3, 4, 5, 0, 5, 4, 3, 2, 1]
export function production(g: Game, p: number): number[] {
  const out = [0, 0, 0, 0, 0]
  for (let v = 0; v < VERTS; v++) {
    if (g.owner[v] !== p) continue
    for (const h of Topo.vertHexes[v]) {
      if (g.terrain[h] === DESERT) continue
      const r = YIELD[g.terrain[h]]
      out[r] = Math.fround(out[r] + Math.fround(PIPS[g.number[h]] * g.kind[v]))
    }
  }
  return out
}

const blockedFor = (g: Game, p: number, v: number) => g.owner[v] !== NO && g.owner[v] !== p
const roadTouches = (g: Game, p: number, v: number) => Topo.vertEdges[v].some((e) => g.road[e] === p)

/** the longest single run of p's roads (an opponent's building cuts a run) */
export function longestRun(g: Game, p: number): number {
  const used = Array<boolean>(EDGES).fill(false)
  let best = 0
  const walk = (v: number, len: number) => {
    if (len > best) best = len
    if (blockedFor(g, p, v)) return
    for (const e of Topo.vertEdges[v]) {
      if (g.road[e] !== p || used[e]) continue
      used[e] = true
      const [a, b] = Topo.edges[e]
      walk(a === v ? b : a, len + 1)
      used[e] = false
    }
  }
  for (let e = 0; e < EDGES; e++) {
    if (g.road[e] !== p) continue
    for (const to of Topo.edges[e]) {
      used[e] = true
      walk(to, 1)
      used[e] = false
    }
  }
  return best
}

export function settlementSpots(g: Game, p: number): number[] {
  const setup = g.phase.kind === 'setup'
  const out: number[] = []
  for (let v = 0; v < VERTS; v++) {
    if (g.owner[v] !== NO || Topo.vertNeighbors[v].some((nb) => g.owner[nb] !== NO)) continue
    if (setup || roadTouches(g, p, v)) out.push(v)
  }
  return out
}

export function roadSpots(g: Game, p: number): number[] {
  const out: number[] = []
  if (g.phase.kind === 'setup') {
    if (g.phase.settlement === NO) return out
    for (const e of Topo.vertEdges[g.phase.settlement]) if (g.road[e] === NO) out.push(e)
    return out
  }
  for (let e = 0; e < EDGES; e++) {
    if (g.road[e] !== NO) continue
    const ok = Topo.edges[e].some((v) => g.owner[v] === p || (!blockedFor(g, p, v) && roadTouches(g, p, v)))
    if (ok) out.push(e)
  }
  return out
}

export const canPlay = (g: Game, p: number, card: number) =>
  !g.cardPlayed && g.players[p].cards.some((c) => c[0] === card && c[1] < g.turn)

export const has = (h: number[], cost: number[]) => cost.every((c, r) => h[r] >= c)

export const owed = (g: Game, p: number) => (g.phase.kind === 'discard' ? g.phase.owed[p] : 0)
