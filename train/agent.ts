/**
 * The network as a player, over the real engine (shared/engine.ts), with the same choice rules as sim/src/agent.rs:
 * try each legal move, encode the position it leads to (an afterstate), ask the network the mover's chance of
 * winning, and take the best. A card bought is counted but its kind not shown; a steal goes to the leader; discards
 * are chosen a card at a time. No exploring (matches are played straight).
 *
 * Afterstates for ordinary moves are produced by the engine's own `apply` (it is pure), so the network plays exactly
 * the game it will face in the browser; only "buy a card" is special (pay, don't draw, count one unknown).
 */
import { apply, type Action, type GameState } from '../shared/engine.ts'
import {
  Game, Player, gameFromState, handSize, victoryPoints, settlementSpots, roadSpots, ratios, canPlay, has, owed,
  RES, VERTS, HEXES, KNIGHT, ROAD_BUILDING, PLENTY, MONOPOLY, COST_SETTLEMENT, COST_CITY, COST_ROAD, COST_CARD,
} from './game.ts'
import { encode, FEATURES } from './encode.ts'
import { Net, value as netValue } from './net.ts'

/** most bank trades a player makes in one turn (as in agent.rs) */
export const TRADES_A_TURN = 3

const X = new Float32Array(FEATURES)

/** how good a position is for p: 1 or 0 if the game is over, else the network's chance */
function val(net: Net, g: Game, p: number, bought: number): number {
  encode(g, p, bought, X)
  if (g.phase.kind === 'over') return g.phase.winner === p ? 1 : 0
  return netValue(net, X, g.players.length)
}

const clonePlayer = (pl: Player): Player => ({ ...pl, hand: [...pl.hand] })
/** a mirror cloned deeply enough to edit one player's hand and the bank (buy-a-card, discards) */
function editable(g: Game): Game {
  return { ...g, players: g.players.map(clonePlayer), bank: [...g.bank] }
}

const fullHand = (c: number[]) => ({ lumber: c[0], brick: c[1], wool: c[2], grain: c[3], ore: c[4], paper: 0, cloth: 0, coin: 0 })

/** every legal move for the actor, as engine actions, in the same order agent.rs/lib.rs lists them */
export function legalMoves(g: Game, p: number): Action[] {
  const out: Action[] = []
  const me = g.players[p]
  switch (g.phase.kind) {
    case 'over':
    case 'discard':
      break
    case 'setup':
      if (g.phase.road) for (const e of roadSpots(g, p)) out.push({ type: 'buildRoad', edge: e })
      else for (const v of settlementSpots(g, p)) out.push({ type: 'buildSettlement', vertex: v })
      break
    case 'roll':
      out.push({ type: 'roll' })
      if (canPlay(g, p, KNIGHT)) out.push({ type: 'playKnight' })
      break
    case 'robber':
      for (let h = 0; h < HEXES; h++) if (h !== g.robber) out.push({ type: 'moveRobber', hex: h })
      break
    case 'steal':
      for (const v of g.phase.victims) out.push({ type: 'steal', victim: v })
      break
    case 'roadBuilding':
      for (const e of roadSpots(g, p)) out.push({ type: 'buildRoad', edge: e })
      break
    case 'main': {
      if (me.settlements > 0 && has(me.hand, COST_SETTLEMENT)) for (const v of settlementSpots(g, p)) out.push({ type: 'buildSettlement', vertex: v })
      if (me.cities > 0 && has(me.hand, COST_CITY)) for (let v = 0; v < VERTS; v++) if (g.owner[v] === p && g.kind[v] === 1) out.push({ type: 'buildCity', vertex: v })
      if (me.roads > 0 && has(me.hand, COST_ROAD)) for (const e of roadSpots(g, p)) out.push({ type: 'buildRoad', edge: e })
      if (g.pileLen > 0 && has(me.hand, COST_CARD)) out.push({ type: 'buyCard' })
      if (canPlay(g, p, KNIGHT)) out.push({ type: 'playKnight' })
      if (canPlay(g, p, ROAD_BUILDING) && me.roads > 0 && roadSpots(g, p).length > 0) out.push({ type: 'playRoadBuilding' })
      if (canPlay(g, p, PLENTY)) {
        for (let x = 0; x < 5; x++)
          for (let y = x; y < 5; y++) {
            const ok = x === y ? g.bank[x] >= 2 : g.bank[x] >= 1 && g.bank[y] >= 1
            if (ok) out.push({ type: 'playYearOfPlenty', take: [RES[x], RES[y]] })
          }
      }
      if (canPlay(g, p, MONOPOLY)) for (let r = 0; r < 5; r++) out.push({ type: 'playMonopoly', resource: RES[r] })
      const rt = ratios(g, p)
      for (let give = 0; give < 5; give++) {
        if (me.hand[give] < rt[give]) continue
        for (let get = 0; get < 5; get++) if (get !== give && g.bank[get] > 0) out.push({ type: 'bankTrade', give: RES[give], get: RES[get] })
      }
      out.push({ type: 'endTurn' })
      break
    }
  }
  return out
}

/** the move player p makes. `trades` carries how many bank trades p has made this turn, so it can't trade in circles. */
export function decide(s: GameState, p: number, net: Net, trades: { turn: number; count: number }): Action {
  const g = gameFromState(s)

  // a discard: drop cards one at a time, each the one whose loss hurts least
  const toDiscard = owed(g, p)
  if (toDiscard > 0) {
    const copy = editable(g)
    const cards = [0, 0, 0, 0, 0]
    for (let d = 0; d < toDiscard; d++) {
      let best = -Infinity
      let bestR = 0
      for (let r = 0; r < 5; r++) {
        if (copy.players[p].hand[r] === 0) continue
        const c = editable(copy)
        c.players[p].hand[r] -= 1
        c.bank[r] += 1
        const v = val(net, c, p, 0)
        if (v > best) {
          best = v
          bestR = r
        }
      }
      copy.players[p].hand[bestR] -= 1
      copy.bank[bestR] += 1
      cards[bestR] += 1
    }
    return { type: 'discard', cards: fullHand(cards) }
  }

  // a steal: from whoever leads (on points showing, then cards held, then seat)
  if (g.phase.kind === 'steal') {
    let bestV = g.phase.victims[0]
    let bestKey = -Infinity
    for (const v of g.phase.victims) {
      const key = victoryPoints(g, v, false) * 3 + handSize(g, v)
      // ties (including the explicit seat tiebreak) go to the later victim, as Rust's max_by_key does
      if (key >= bestKey) {
        bestKey = key
        bestV = v
      }
    }
    return { type: 'steal', victim: bestV }
  }

  let moves = legalMoves(g, p)
  if (trades.turn === g.turn && trades.count >= TRADES_A_TURN) moves = moves.filter((a) => a.type !== 'bankTrade')

  let best = -Infinity
  let bestMove = moves[0]
  for (const a of moves) {
    let v: number
    if (a.type === 'roll') {
      v = val(net, g, p, 0)
    } else if (a.type === 'buyCard') {
      const c = editable(g)
      for (let r = 0; r < 5; r++) {
        c.players[p].hand[r] -= COST_CARD[r]
        c.bank[r] += COST_CARD[r]
      }
      v = val(net, c, p, 1)
    } else {
      const r = apply(s, p, a)
      if (!r.ok) continue
      v = val(net, gameFromState(r.state), p, 0)
    }
    if (v > best) {
      best = v
      bestMove = a
    }
  }
  return bestMove
}
