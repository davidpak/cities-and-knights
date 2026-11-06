/**
 * A simple, honest bot: it only uses what that player could see, and only offers actions the rules accept.
 * It plays to win in a plain way (cities, then settlements, then roads toward open spots, then cards), so test games
 * finish, and so one person can fill empty seats to try the game.
 *
 * In the expansion it also keeps knights ready when the barbarians are near, grows its cities with commodities,
 * walls a city now and then, and plays its progress cards at plain targets.
 */
import { TOPO } from './board.ts'
import {
  activateSpots, affordable, canAct, canPlay, chaseSpots, citySpots, improveCost, knightMoves, knightSpots, pickTargets,
  promoteSpots, roadSpots, robberSpots, settlementSpots, tradeRatios, wallSpots,
  type Action, type GameState, type View,
} from './engine.ts'
import {
  BARBARIAN_STEPS, COMMODITIES, COST, GOODS, KNIGHT_COST, PROGRESS, RESOURCES, TRACKS, TRACK_GOOD, emptyHand, handSize, hasAll,
  type Good, type Hand, type Progress, type Resource,
} from './rules.ts'

type S = GameState | View
const PIPS: Record<number, number> = { 2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 8: 5, 9: 4, 10: 3, 11: 2, 12: 1 }
const pips = (s: S, v: number) => TOPO.vertices[v].hexes.reduce((n, h) => n + (PIPS[s.tiles[h].number ?? 0] ?? 0), 0)
const best = <T>(xs: T[], score: (x: T) => number) => xs.reduce((a, b) => (score(b) > score(a) ? b : a))
const pointsOf = (s: S, i: number) => ('points' in s.players[i] ? (s.players[i] as { points: number }).points : 0)

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
      const r = best(GOODS.filter((x) => left[x] > 0), (x) => left[x] + rnd())
      left[r]--
      cards[r]++
    }
    return { type: 'discard', cards }
  }

  if (ph.kind === 'progressDiscard') {
    if (!ph.owed[p]) return null
    const mine = s.players[p].progress ?? []
    if (!mine.length) return null
    return { type: 'discardProgress', card: pick(mine, rnd).card }
  }

  const o = ph.kind === 'main' ? s.offers.find((x) => x.from !== p && (x.to === undefined || x.to === p) && !x.declined.includes(p) && !x.accepted.includes(p)) : undefined
  if (o) {
    const fair = handSize(o.give) >= handSize(o.get) + o.any
    // a wildcard: give what we have most of (not a kind they give, and beyond what they ask for)
    const left = { ...hand }
    for (const r of GOODS) left[r] -= o.get[r] ?? 0
    const pick = emptyHand()
    for (let k = 0; k < o.any; k++) {
      const r = GOODS.filter((g) => left[g] > 0 && !(o.give[g] > 0)).sort((a, b) => left[b] - left[a])[0]
      if (!r) break
      left[r]--
      pick[r]++
    }
    const can = hasAll(hand, o.get) && handSize(pick) === o.any
    return can && fair && rnd() < 0.5 ? { type: 'acceptOffer', id: o.id, ...(o.any ? { pick } : {}) } : { type: 'declineOffer', id: o.id }
  }

  if (p !== s.current) return null

  switch (ph.kind) {
    case 'setup':
      if (ph.step === 'settlement') return { type: 'buildSettlement', vertex: best(settlementSpots(s, p), (v) => pips(s, v) + rnd()) }
      return { type: 'buildRoad', edge: pick(roadSpots(s, p), rnd) }
    case 'roll':
      if (s.mode !== 'knights' && canPlay(s, p, 'knight') && TOPO.hexes[s.robber].vertices.some((v) => s.buildings[v]?.owner === p)) return { type: 'playKnight' }
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
    case 'pick':
      return pickMove(s, p, rnd)
    case 'main':
      return s.mode === 'knights' ? knightsMove(s, p, hand, rnd) : mainMove(s, p, hand, rnd)
  }
  return null
}

function pick<T>(xs: T[], rnd: () => number): T {
  return xs[Math.floor(rnd() * xs.length)]
}

function mainMove(s: S, p: number, hand: Hand, rnd: () => number): Action {
  const me = s.players[p]
  const mineOpen = s.offers.find((x) => x.from === p)
  if (mineOpen) return mineOpen.accepted.length ? { type: 'confirmTrade', id: mineOpen.id, with: mineOpen.accepted[0] } : { type: 'cancelOffer', id: mineOpen.id }
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
  return tradeToward(s, p, hand, cities.length && me.pieces.city > 0 ? COST.city : spots.length ? COST.settlement : COST.road, rnd)
}

/** trade with the bank toward the next thing to build, or end the turn */
function tradeToward(s: S, p: number, hand: Hand, goal: Partial<Hand>, rnd: () => number): Action {
  const ratios = tradeRatios(s, p)
  const kinds: readonly Good[] = s.mode === 'knights' ? GOODS : RESOURCES
  const need = kinds.filter((r) => hand[r] < (goal[r] ?? 0) && s.bank[r] > 0)
  const spare = kinds.filter((r) => hand[r] - (goal[r] ?? 0) >= ratios[r])
  if (need.length && spare.length) return { type: 'bankTrade', give: pick(spare, rnd), get: pick(need, rnd) }
  return { type: 'endTurn' }
}

// ---------------------------------------------------------------- the expansion

/** progress cards worth playing as soon as they can be (Augury is only for before a roll, and is skipped) */
const PLAY_NOW: Progress[] = ['trader', 'charter', 'corner', 'guild', 'bargain', 'caravan', 'sheriff', 'turncoat', 'envoy', 'ruse', 'unrest', 'spy', 'rally', 'feast', 'scaffold', 'mason', 'surveyor', 'irrigation', 'mining', 'physician', 'roadCrew', 'smith']

function knightsMove(s: S, p: number, hand: Hand, rnd: () => number): Action {
  const me = s.players[p]
  const x = s.x!
  const mineOpen = s.offers.find((x) => x.from === p)
  if (mineOpen) return mineOpen.accepted.length ? { type: 'confirmTrade', id: mineOpen.id, with: mineOpen.accepted[0] } : { type: 'cancelOffer', id: mineOpen.id }

  // the barbarians: keep enough knights ready to pull our weight
  const near = x.barbarian >= BARBARIAN_STEPS - 3
  const myDefense = Object.values(x.knights).filter((k) => k.owner === p && k.active).reduce((n, k) => n + k.level, 0)
  const myCities = Object.values(s.buildings).filter((b) => b.owner === p && b.kind === 'city').length
  if (near && myDefense < Math.max(1, myCities)) {
    const rest = activateSpots(s, p)
    if (rest.length && hasAll(hand, KNIGHT_COST.activate)) return { type: 'activateKnight', vertex: best(rest, (v) => x.knights[v].level) }
    const spots = knightSpots(s, p)
    if (spots.length && me.pieces.knight[1] > 0 && hasAll(hand, KNIGHT_COST.knight)) return { type: 'buildKnight', vertex: best(spots, (v) => pips(s, v) + rnd()) }
  }

  // progress cards, at plain targets
  for (const c of me.progress ?? []) {
    if (!PLAY_NOW.includes(c.card)) continue
    if (playable(s, p, c.card)) return { type: 'playProgress', card: c.card }
  }

  // the robber on one of our tiles, and a ready knight beside it: chase it off
  const chase = chaseSpots(s, p)
  if (chase.length && TOPO.hexes[s.robber].vertices.some((v) => s.buildings[v]?.owner === p)) return { type: 'chaseRobber', from: chase[0] }

  const cities = citySpots(s, p)
  if (cities.length && me.pieces.city > 0 && affordable(s, p, 'city')) return { type: 'buildCity', vertex: best(cities, (v) => pips(s, v)) }
  // grow a city: the track we're furthest along that we can pay for
  const tracks = TRACKS.filter((t) => {
    const cost = improveCost(s, p, t)
    return cost && hasAll(hand, cost)
  })
  if (tracks.length) return { type: 'improve', track: best(tracks, (t) => x.levels[p][t] + rnd()) }
  const spots = settlementSpots(s, p)
  if (spots.length && me.pieces.settlement > 0 && affordable(s, p, 'settlement')) return { type: 'buildSettlement', vertex: best(spots, (v) => pips(s, v) + rnd()) }
  const walls = wallSpots(s, p)
  if (walls.length && hasAll(hand, KNIGHT_COST.wall) && rnd() < 0.4) return { type: 'buildWall', vertex: walls[0] }
  // a knight now and then, and raise one when there's ore to spare
  const promote = promoteSpots(s, p)
  if (promote.length && hasAll(hand, KNIGHT_COST.promote) && rnd() < 0.3) return { type: 'promoteKnight', vertex: promote[0] }
  const kspots = knightSpots(s, p)
  if (kspots.length && me.pieces.knight[1] > 0 && hasAll(hand, KNIGHT_COST.knight) && rnd() < 0.35) return { type: 'buildKnight', vertex: best(kspots, (v) => pips(s, v) + rnd()) }
  // a ready knight with somewhere better to stand, or a weaker knight of someone else's to push away
  for (const [v, k] of Object.entries(x.knights)) {
    if (k.owner !== p || !canAct(s, Number(v)) || rnd() < 0.7) continue
    const moves = knightMoves(s, Number(v)).filter((w) => x.knights[w] !== undefined)
    if (moves.length) return { type: 'moveKnight', from: Number(v), to: moves[0] }
  }
  const roads = roadSpots(s, p)
  if (roads.length && me.pieces.road > 0 && affordable(s, p, 'road') && (spots.length === 0 || rnd() < 0.25)) {
    return { type: 'buildRoad', edge: best(roads, (e) => pips(s, TOPO.edges[e].a) + pips(s, TOPO.edges[e].b) + rnd() * 6) }
  }
  // trade toward a city, or the next improvement
  const t = best([...TRACKS], (t) => hand[TRACK_GOOD[t]] - x.levels[p][t])
  const goal = cities.length && me.pieces.city > 0 ? COST.city : (improveCost(s, p, t) ?? (spots.length ? COST.settlement : COST.road))
  return tradeToward(s, p, hand, goal, rnd)
}

/** a progress card the rules will let us play right now (the same checks the engine makes) */
function playable(s: S, p: number, card: Progress): boolean {
  const me = s.players[p]
  const x = s.x!
  if (s.offers.length) return false
  switch (card) {
    case 'roadCrew':
      return me.pieces.road > 0 && roadSpots(s, p).length > 0
    case 'smith':
      return promoteSpots(s, p).length > 0
    case 'rally':
      return activateSpots(s, p).length > 0
    case 'mason':
      return me.pieces.wall > 0 && wallSpots(s, p).length > 0
    case 'physician':
      return me.pieces.city > 0 && hasAll(me.hand!, { ore: 2, grain: 1 }) && citySpots(s, p).length > 0
    case 'turncoat':
      return Object.values(x.knights).some((k) => k.owner !== p)
    case 'caravan':
    case 'feast':
    case 'unrest':
    case 'irrigation':
    case 'mining':
    case 'scaffold':
    case 'sheriff':
      return true
  }
  const probe = { ...(s as View), phase: { kind: 'pick' as const, card, need: NEED[card]!, step: 0, data: [], then: 'main' as const } }
  return pickTargets(probe as never, p).length > 0
}

const NEED: Partial<Record<Progress, 'hex' | 'good' | 'resource' | 'commodity' | 'player' | 'enemyKnight' | 'road' | 'number' | 'myCity' | 'token' | 'mySettlement'>> = {
  trader: 'hex', charter: 'good', corner: 'resource', guild: 'commodity', bargain: 'player', turncoat: 'enemyKnight', envoy: 'road',
  ruse: 'enemyKnight', spy: 'player', augury: 'number', mason: 'myCity', surveyor: 'token', physician: 'mySettlement',
}

function pickMove(s: S, p: number, rnd: () => number): Action {
  const ph = s.phase
  if (ph.kind !== 'pick') return { type: 'cancelPick' }
  const targets = pickTargets(s as never, p)
  if (!targets.length) return { type: 'cancelPick' }
  const x = s.x!
  const hand = s.players[p].hand!
  let t: number | Good = pick(targets, rnd)
  switch (ph.need) {
    case 'resource':
    case 'good':
    case 'commodity':
      // what we have least of (a charter: what we have most of, to trade away)
      t = ph.card === 'charter' ? best(targets as Good[], (g) => hand[g] + rnd()) : best(targets as Good[], (g) => -hand[g] + rnd())
      break
    case 'player':
      t = best(targets as number[], (i) => pointsOf(s, i) + (s.players[i] as { handCount?: number }).handCount! / 10 + rnd())
      break
    case 'enemyKnight':
      t = best(targets as number[], (v) => x.knights[v].level + rnd())
      break
    case 'knightSpot':
    case 'mySettlement':
      t = best(targets as number[], (v) => pips(s, v) + rnd())
      break
    case 'hex':
      t = best(targets as number[], (h) => (PIPS[s.tiles[h].number ?? 0] ?? 0) + rnd())
      break
  }
  void COMMODITIES
  void PROGRESS
  return { type: 'pick', target: t }
}
