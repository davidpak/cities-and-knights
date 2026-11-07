/**
 * What the network sees: a position, from one player's side, as numbers in [0, 1]. A line-for-line port of
 * sim/src/encode.rs; a test (train/enc-parity.ts) keeps the two identical, number by number. Arithmetic is wrapped
 * in Math.fround so it rounds the same way the Rust f32 code does.
 */
import { Game, Topo, HEXES, VERTS, EDGES, DESERT, ANY, YIELD, NO, PIPS, handSize, victoryPoints, ratios, production, longestRun } from './game.ts'

const HEX_F = 8
const VERT_F = 6 + 8 + 1
const EDGE_F = 4
const PLAYER_F = 23
const ME_F = 5 + 5 + 1 + 1
const GLOBAL_F = 5 + 1 + 8 + 4 + 1 + 1

export const FEATURES = HEXES * HEX_F + VERTS * VERT_F + EDGES * EDGE_F + 4 * PLAYER_F + ME_F + GLOBAL_F

const f32 = Math.fround
const min1 = (x: number) => Math.min(x, 1)
const THIRD = f32(1 / 3)

const PHASE_IDX: Record<Game['phase']['kind'], number> = { setup: 0, roll: 1, main: 2, discard: 3, robber: 4, steal: 5, roadBuilding: 6, over: 7 }

/** the position as `me` sees it. `bought` counts cards just bought whose kind `me` doesn't know yet. */
export function encode(g: Game, me: number, bought: number, out: Float32Array): void {
  out.fill(0)
  const n = g.players.length
  const rel = (p: number) => (p + n - me) % n
  let o = 0
  // tiles
  for (let h = 0; h < HEXES; h++) {
    out[o + g.terrain[h]] = 1
    out[o + 6] = f32(PIPS[g.number[h]] / 5)
    out[o + 7] = g.robber === h ? 1 : 0
    o += HEX_F
  }
  // corners
  const harbor = Array<number>(VERTS).fill(6)
  for (const [e, k] of g.harbors) for (const v of Topo.edges[e]) harbor[v] = k
  for (let v = 0; v < VERTS; v++) {
    if (harbor[v] < 6) out[o + harbor[v]] = 1
    if (g.owner[v] !== NO) {
      out[o + 6 + (g.kind[v] - 1) * 4 + rel(g.owner[v])] = 1
    } else if (Topo.vertNeighbors[v].every((u) => g.owner[u] === NO)) {
      out[o + 14] = 1
    }
    o += VERT_F
  }
  // sides
  for (let e = 0; e < EDGES; e++) {
    if (g.road[e] !== NO) out[o + rel(g.road[e])] = 1
    o += EDGE_F
  }
  // players, me first
  for (let k = 0; k < 4; k++) {
    if (k >= n) {
      o += PLAYER_F
      continue
    }
    const p = (me + k) % n
    const pl = g.players[p]
    out[o] = 1
    out[o + 1] = f32(victoryPoints(g, p, false) / 10)
    out[o + 2] = k === 0 ? f32(victoryPoints(g, p, true) / 10) : out[o + 1]
    out[o + 3] = f32(min1(f32(handSize(g, p) / 20)))
    out[o + 4] = f32(min1(f32((pl.cards.length + (k === 0 ? bought : 0)) / 10)))
    out[o + 5] = f32(min1(f32(pl.knights / 5)))
    out[o + 6] = f32(pl.roads / 15)
    out[o + 7] = f32(pl.settlements / 5)
    out[o + 8] = f32(pl.cities / 4)
    out[o + 9] = g.longestRoad === p ? 1 : 0
    out[o + 10] = g.largestArmy === p ? 1 : 0
    out[o + 11] = f32(min1(f32(longestRun(g, p) / 15)))
    const prod = production(g, p)
    for (let r = 0; r < 5; r++) out[o + 12 + r] = f32(min1(f32(prod[r] / 15)))
    const rt = ratios(g, p)
    for (let r = 0; r < 5; r++) out[o + 17 + r] = rt[r] === 2 ? 1 : 0
    out[o + 22] = rt.some((x) => x === 3) || rt.every((x) => x <= 3) ? 1 : 0
    o += PLAYER_F
  }
  // me: hand, cards I can play (bought before this turn), cards bought this turn (kind not shown), a card played
  const pl = g.players[me]
  for (let r = 0; r < 5; r++) out[o + r] = f32(min1(f32(pl.hand[r] / 10)))
  let fresh = bought
  for (const [c, turn] of pl.cards) {
    if (turn < g.turn) out[o + 5 + c] = f32(out[o + 5 + c] + THIRD)
    else fresh += 1
  }
  for (let c = 0; c < 5; c++) out[o + 5 + c] = f32(min1(out[o + 5 + c]))
  out[o + 10] = f32(min1(f32(fresh / 3)))
  out[o + 11] = g.cardPlayed ? 1 : 0
  o += ME_F
  // the bank, the pile, the phase, whose turn, the turn, setup's round
  for (let r = 0; r < 5; r++) out[o + r] = f32(g.bank[r] / 19)
  out[o + 5] = f32(Math.max(g.pileLen - bought, 0) / 25)
  out[o + 6 + PHASE_IDX[g.phase.kind]] = 1
  out[o + 14 + rel(g.current)] = 1
  out[o + 18] = f32(min1(f32(g.turn / 200)))
  out[o + 19] = g.phase.kind === 'setup' && g.phase.round === 2 ? 1 : 0
  o += GLOBAL_F
  if (o !== FEATURES) throw new Error(`encode wrote ${o}, expected ${FEATURES}`)
}

/** the quantised bytes the network is trained on (value * 255, rounded). The multiply is done in f32 (Math.fround)
 *  so it rounds exactly as the Rust `(v.clamp(0,1) * 255.).round()` does — otherwise a value a hair under x.5 in
 *  f64 but at x.5 in f32 would round the other way. */
export function quantise(x: Float32Array): Uint8Array {
  const out = new Uint8Array(x.length)
  for (let i = 0; i < x.length; i++) out[i] = Math.round(Math.fround(Math.min(Math.max(x[i], 0), 1) * 255))
  return out
}
