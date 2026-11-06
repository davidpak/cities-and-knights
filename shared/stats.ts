/**
 * The game's numbers, kept as it goes (the event list itself keeps only the latest few): every roll, and for each
 * player what they produced, built, traded, stole, lost and played. Shown when the game ends.
 */
import type { GameEvent } from './engine.ts'
import { GOODS, handSize, type Good, type Hand } from './rules.ts'

export type PlayerStats = {
  /** cards from rolls, by kind (commodities too) */
  produced: Partial<Hand>
  /** the biggest single roll's take */
  bestRoll: number
  /** rolls that brought them nothing */
  dryRolls: number
  /** times they rolled, and how many of those were 7s */
  rolled: number
  sevens: number
  /** what they built (not counting the free setup pieces) */
  roads: number
  settlements: number
  cities: number
  walls: number
  improvements: number
  metropolises: number
  /** trades with players (as either side): how many, and the cards each way */
  trades: number
  tradedAway: number
  tradedIn: number
  /** trades with the bank: how many, cards paid in */
  bankTrades: number
  bankPaid: number
  /** cards taken from others (robber, sneaking, progress cards) and taken from them */
  stole: number
  lost: number
  /** sneaking: got away with it, caught at it */
  snatched: number
  caught: number
  discarded: number
  robberMoves: number
  /** the basic game's development cards */
  devBought: number
  devPlayed: number
  knightCards: number
  /** the expansion: progress cards drawn and played; knights raised, made stronger, readied, sent out */
  progressDrawn: number
  progressPlayed: number
  knightsBuilt: number
  knightsUpgraded: number
  knightsReadied: number
  knightMoves: number
  /** the barbarians: points for defending, cities (or walls) lost */
  defended: number
  pillaged: number
  /** a resource of their choosing from the waterworks */
  aqueduct: number
}
export type Stats = {
  /** how often each total came up (index 2..12) */
  rolls: number[]
  attacks: number
  players: PlayerStats[]
}

const blank = (): PlayerStats => ({
  produced: {}, bestRoll: 0, dryRolls: 0, rolled: 0, sevens: 0, roads: 0, settlements: 0, cities: 0, walls: 0, improvements: 0, metropolises: 0,
  trades: 0, tradedAway: 0, tradedIn: 0, bankTrades: 0, bankPaid: 0, stole: 0, lost: 0, snatched: 0, caught: 0, discarded: 0, robberMoves: 0,
  devBought: 0, devPlayed: 0, knightCards: 0, progressDrawn: 0, progressPlayed: 0, knightsBuilt: 0, knightsUpgraded: 0, knightsReadied: 0, knightMoves: 0,
  defended: 0, pillaged: 0, aqueduct: 0,
})
export const newStats = (players: number): Stats => ({ rolls: Array(13).fill(0), attacks: 0, players: Array.from({ length: players }, blank) })

const add = (h: Partial<Hand>, r: Good, n: number) => (h[r] = (h[r] ?? 0) + n)

/** counts one event into the stats */
export function tally(st: Stats, e: GameEvent) {
  const P = st.players
  switch (e.k) {
    case 'roll': {
      const t = e.dice[0] + e.dice[1]
      st.rolls[t]++
      P[e.p].rolled++
      if (t === 7) P[e.p].sevens++
      return
    }
    case 'gain': {
      const got = new Set(e.gains.map((g) => g.p))
      for (const g of e.gains) {
        for (const r of GOODS) if (g.got[r]) add(P[g.p].produced, r, g.got[r]!)
        P[g.p].bestRoll = Math.max(P[g.p].bestRoll, handSize(g.got))
      }
      P.forEach((ps, i) => !got.has(i) && ps.dryRolls++)
      return
    }
    case 'build':
      if (e.free) return
      if (e.what === 'road') P[e.p].roads++
      else if (e.what === 'settlement') P[e.p].settlements++
      else P[e.p].cities++
      return
    case 'buy':
      P[e.p].devBought++
      return
    case 'play':
      P[e.p].devPlayed++
      if (e.card === 'knight') P[e.p].knightCards++
      return
    case 'monopoly':
      P[e.p].stole += e.count
      return
    case 'bank':
      P[e.p].bankTrades++
      P[e.p].bankPaid += e.count
      return
    case 'trade':
      for (const [p, away, inn] of [
        [e.from, handSize(e.give), handSize(e.get)],
        [e.to, handSize(e.get), handSize(e.give)],
      ] as const) {
        P[p].trades++
        P[p].tradedAway += away
        P[p].tradedIn += inn
      }
      return
    case 'discard':
      P[e.p].discarded += e.count
      return
    case 'robber':
      P[e.p].robberMoves++
      return
    case 'steal':
      P[e.thief].stole++
      P[e.victim].lost++
      return
    case 'snatch':
      P[e.thief].stole++
      P[e.thief].snatched++
      P[e.victim].lost++
      return
    case 'caught':
      if (!e.r) P[e.thief].caught++
      return
    case 'take':
      if (e.what === 'progress') return
      P[e.p].stole += e.count
      P[e.from].lost += e.count
      return
    case 'attack':
      st.attacks++
      if (e.defender !== null) P[e.defender].defended++
      for (const x of e.pillaged) P[x.p].pillaged++
      return
    case 'pillage':
      P[e.p].pillaged++
      return
    case 'draw':
      P[e.p].progressDrawn++
      return
    case 'progress':
      P[e.p].progressPlayed++
      return
    case 'improve':
      P[e.p].improvements++
      return
    case 'metropolis':
      P[e.p].metropolises++
      return
    case 'wall':
      P[e.p].walls++
      return
    case 'knight':
      if (e.what === 'build') P[e.p].knightsBuilt++
      else if (e.what === 'promote') P[e.p].knightsUpgraded++
      else if (e.what === 'activate') P[e.p].knightsReadied++
      else if (e.what === 'move' || e.what === 'displace' || e.what === 'chase') P[e.p].knightMoves++
      return
    case 'aqueduct':
      P[e.p].aqueduct++
      return
  }
}
