/**
 * A simple, honest bot: it only uses what that player could see, and only offers actions the rules accept.
 * It plays to win in a plain way (cities, then settlements, then roads toward open spots, then cards), so test games
 * finish, and so one person can fill empty seats to try the game.
 */
import { TOPO } from './board.ts'
import {
  affordable, canPlay, citySpots, roadSpots, robberSpots, settlementSpots, tradeRatios,
  type Action, type GameState, type View,
} from './engine.ts'
import { COST, RESOURCES, emptyHand, handSize, type Hand, type Resource } from './rules.ts'

type S = GameState | View
const PIPS: Record<number, number> = { 2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 8: 5, 9: 4, 10: 3, 11: 2, 12: 1 }
const pips = (s: S, v: number) => TOPO.vertices[v].hexes.reduce((n, h) => n + (PIPS[s.tiles[h].number ?? 0] ?? 0), 0)
const best = <T>(xs: T[], score: (x: T) => number) => xs.reduce((a, b) => (score(b) > score(a) ? b : a))

/** the next thing player p would do, or null when nothing is theirs to do */
export function botAction(s: S, p: number, rnd: () => number): Action | null {
  const ph = s.phase
  const hand = s.players[p].hand
  if (!hand) return null
  if (ph.kind === 'over') return null

  if (ph.kind === 'discard') {
    const owed = ph.owed[p]
    if (!owed) return null
    const left = { ...hand }
    const cards = emptyHand()
    for (let i = 0; i < owed; i++) {
      const r = best(RESOURCES.filter((x) => left[x] > 0), (x) => left[x] + rnd())
      left[r]--
      cards[r]++
    }
    return { type: 'discard', cards }
  }

  if (s.offer && s.offer.from !== p && ph.kind === 'main' && !s.offer.declined.includes(p) && !s.offer.accepted.includes(p)) {
    const o = s.offer
    const fair = handSize(o.give) >= handSize(o.get)
    const can = RESOURCES.every((r) => hand[r] >= o.get[r])
    return can && fair && rnd() < 0.5 ? { type: 'acceptOffer' } : { type: 'declineOffer' }
  }

  if (p !== s.current) return null

  switch (ph.kind) {
    case 'setup':
      if (ph.step === 'settlement') return { type: 'buildSettlement', vertex: best(settlementSpots(s, p), (v) => pips(s, v) + rnd()) }
      return { type: 'buildRoad', edge: pick(roadSpots(s, p), rnd) }
    case 'roll':
      if (canPlay(s, p, 'knight') && TOPO.hexes[s.robber].vertices.some((v) => s.buildings[v]?.owner === p)) return { type: 'playKnight' }
      return { type: 'roll' }
    case 'robber': {
      const hexes = robberSpots(s).filter((h) => !TOPO.hexes[h].vertices.some((v) => s.buildings[v]?.owner === p))
      const score = (h: number) =>
        TOPO.hexes[h].vertices.filter((v) => s.buildings[v] !== undefined).length * (PIPS[s.tiles[h].number ?? 0] ?? 0) + rnd()
      return { type: 'moveRobber', hex: best(hexes.length ? hexes : robberSpots(s), score) }
    }
    case 'steal':
      return { type: 'steal', victim: pick(ph.victims, rnd) }
    case 'roadBuilding':
      return { type: 'buildRoad', edge: pick(roadSpots(s, p), rnd) }
    case 'main':
      return mainMove(s, p, hand, rnd)
  }
}

function pick<T>(xs: T[], rnd: () => number): T {
  return xs[Math.floor(rnd() * xs.length)]
}

function mainMove(s: S, p: number, hand: Hand, rnd: () => number): Action {
  const me = s.players[p]
  if (s.offer?.from === p) return s.offer.accepted.length ? { type: 'confirmTrade', with: s.offer.accepted[0] } : { type: 'cancelOffer' }
  if (!s.cardPlayed) {
    if (canPlay(s, p, 'monopoly')) {
      return { type: 'playMonopoly', resource: pick([...RESOURCES], rnd) }
    }
    if (canPlay(s, p, 'yearOfPlenty')) {
      const want = RESOURCES.filter((r) => s.bank[r] > 0)
      if (want.length) return { type: 'playYearOfPlenty', take: [pick(want, rnd), pick(want, rnd)].sort() as [Resource, Resource] }
    }
    if (canPlay(s, p, 'roadBuilding') && me.pieces.road > 0 && roadSpots(s, p).length) return { type: 'playRoadBuilding' }
    if (canPlay(s, p, 'knight') && rnd() < 0.5) return { type: 'playKnight' }
  }
  const cities = citySpots(s, p)
  if (cities.length && me.pieces.city > 0 && affordable(s, p, 'city')) return { type: 'buildCity', vertex: best(cities, (v) => pips(s, v)) }
  const spots = settlementSpots(s, p)
  if (spots.length && me.pieces.settlement > 0 && affordable(s, p, 'settlement')) return { type: 'buildSettlement', vertex: best(spots, (v) => pips(s, v) + rnd()) }
  const roads = roadSpots(s, p)
  if (roads.length && me.pieces.road > 0 && affordable(s, p, 'road') && (spots.length === 0 || rnd() < 0.25)) {
    return { type: 'buildRoad', edge: best(roads, (e) => pips(s, TOPO.edges[e].a) + pips(s, TOPO.edges[e].b) + rnd() * 6) }
  }
  if ((typeof s.pile === 'number' ? s.pile : s.pile.length) > 0) {
    if (affordable(s, p, 'card') && rnd() < 0.6) return { type: 'buyCard' }
  }
  // trade toward the next thing to build
  const goal = cities.length && me.pieces.city > 0 ? COST.city : spots.length ? COST.settlement : COST.road
  const ratios = tradeRatios(s, p)
  const need = RESOURCES.filter((r) => hand[r] < ((goal as Partial<Hand>)[r] ?? 0) && s.bank[r] > 0)
  const spare = RESOURCES.filter((r) => hand[r] - ((goal as Partial<Hand>)[r] ?? 0) >= ratios[r])
  if (need.length && spare.length) return { type: 'bankTrade', give: pick(spare, rnd), get: pick(need, rnd) }
  return { type: 'endTurn' }
}
