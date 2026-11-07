/**
 * The bots. They only use what their player could see, and only offer actions the rules accept.
 *
 * Four levels:
 *  - easy:   plain and a little careless (builds what it can, trades at random, now and then forgets to build).
 *  - normal: plans toward a goal, loosely.
 *  - hard:   plans well, trades for what speeds its plan, watches the leader, keeps its hand under the limit.
 *  - expert: plans tightly, counts every card it sees (who holds what), won't feed a leader, aims its offers at
 *            whoever holds the card, times its monopolies, and races for the longest road, largest army, metropolises.
 *
 * The plan: every goal it could chase (a city here, a settlement there with a road or two, a card, a knight, an
 * improvement, the longest road) is worth points and production; each is weighed against how many rounds it would
 * take to afford from what the bot holds, makes and can trade. The best value per round waited wins. A trade (with
 * the bank or a player) is good when it brings the goals nearer; a card is worth keeping when a goal needs it. This
 * is the build-plan idea of the classic Catan agents, sharpened by a rounds-to-afford estimate and card counting.
 *
 * And a personality: a merchant trades all day and pays over the odds; a builder loves roads; a warlord fights and
 * keeps knights; a scholar buys cards and climbs science; a magpie sneaks cards; one who holds a grudge remembers who
 * robbed it and pays them back, even when that costs it. Each bot keeps a little memory (grudges, and who holds which
 * cards) in its Brain.
 */
import { TOPO } from './board.ts'
import {
  activateSpots, affordable, canAct, canPlay, chaseSpots, citySpots, handLimit, improveCost, knightMoves, knightSpots, longestRun, pickTargets,
  promoteSpots, resourceOf, roadSpots, robberSpots, settlementSpots, tradeRatios, wallSpots, winPoints,
  type Action, type GameState, type View,
} from './engine.ts'
import {
  BARBARIAN_STEPS, CITY_YIELD, COMMODITIES, COST, GOODS, KNIGHT_COST, LARGEST_ARMY_MIN, LONGEST_ROAD_MIN, MAX_LEVEL, RESOURCES, TRACKS,
  TRACK_GOOD, emptyHand, handSize, hasAll,
  type Good, type Hand, type Progress, type Resource,
} from './rules.ts'

type S = GameState | View

export const LEVELS = ['easy', 'normal', 'hard', 'expert'] as const
export type Level = (typeof LEVELS)[number]
export const PERSONAS = ['steady', 'merchant', 'builder', 'warlord', 'grudge', 'magpie', 'scholar'] as const
export type Persona = (typeof PERSONAS)[number]
/** what a bot remembers between moves: the last event it read, its grudges, and its count of everyone's cards */
export type Memory = { seen: number; grudge: number[]; est: Hand[]; unk: number[]; goal?: string }
/** people: the seats played by people (offers that reach them are kept few) */
export type Brain = { level: Level; persona: Persona; mem?: Memory; people?: number[] }

export const brain = (level: Level = 'normal', persona: Persona = 'steady'): Brain => ({ level, persona })

/** the bots at the table: each name has its own way of playing */
export const BOT_CAST: { name: string; persona: Persona }[] = [
  { name: 'Bramble', persona: 'grudge' },
  { name: 'Clover', persona: 'merchant' },
  { name: 'Wren', persona: 'builder' },
  { name: 'Flint', persona: 'warlord' },
  { name: 'Pip', persona: 'magpie' },
  { name: 'Juniper', persona: 'scholar' },
  { name: 'Moss', persona: 'steady' },
]
/** one word for each, for the lobby */
export const PERSONA_TAG: Record<Persona, string> = {
  steady: 'Steady', merchant: 'Trader', builder: 'Builder', warlord: 'Warlord', grudge: 'Grudges', magpie: 'Sneaky', scholar: 'Scholar',
}
export const LEVEL_NAME: Record<Level, string> = { easy: 'Easy', normal: 'Normal', hard: 'Hard', expert: 'Expert' }

const LV: Record<Level, { noise: number; offers: number; leader: number; count: boolean; hold: boolean; accept: number }> = {
  easy: { noise: 1, offers: 0, leader: 0, count: false, hold: false, accept: 0 },
  normal: { noise: 0.45, offers: 1, leader: 0.3, count: false, hold: false, accept: 0.15 },
  hard: { noise: 0.12, offers: 2, leader: 1, count: false, hold: true, accept: 0.08 },
  expert: { noise: 0, offers: 3, leader: 1.4, count: true, hold: true, accept: 0.05 },
}
type Traits = { offers: number; accept: number; road: number; settle: number; army: number; cards: number; grudge: number; decay: number; snatch: number; science: number; knights: number; generous: boolean }
const BASE: Traits = { offers: 0, accept: 0, road: 1, settle: 1, army: 1, cards: 1, grudge: 0.35, decay: 0.9, snatch: 0, science: 1, knights: 1, generous: false }
const PE: Record<Persona, Traits> = {
  steady: BASE,
  merchant: { ...BASE, offers: 3, accept: -0.12, generous: true },
  builder: { ...BASE, road: 1.7, settle: 1.2, cards: 0.8 },
  warlord: { ...BASE, army: 1.6, knights: 1.6, grudge: 0.8 },
  grudge: { ...BASE, grudge: 2.6, decay: 0.985 },
  magpie: { ...BASE, snatch: 0.3, accept: 0.05 },
  scholar: { ...BASE, cards: 1.5, science: 1.6, road: 0.85 },
}

/** (for tuning runs: expert's weights) */
const TUNE: Record<string, number> = { settle: 1, road: 1, card: 1, city: 1, H: 1, prod: 0.2, accept: 0, disc: 0, look: 1, commit: 0, greedy: 2, ...((globalThis as { __botTune?: Record<string, number> }).__botTune ?? {}) }
const tune = (c: { b: Brain }, k: string) => (c.b.level === 'expert' ? TUNE[k] : k === 'prod' ? 0.2 : ['accept', 'disc', 'commit', 'greedy'].includes(k) ? 0 : 1)

const PIPS: Record<number, number> = { 2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 8: 5, 9: 4, 10: 3, 11: 2, 12: 1 }
const pipsOf = (s: S, h: number) => PIPS[s.tiles[h].number ?? 0] ?? 0
const pips = (s: S, v: number) => TOPO.vertices[v].hexes.reduce((n, h) => n + pipsOf(s, h), 0)
const best = <T>(xs: T[], score: (x: T) => number) => xs.reduce((a, b) => (score(b) > score(a) ? b : a))
const ptsOf = (s: S, i: number) => {
  const pl = s.players[i] as { points?: number }
  if (typeof pl.points === 'number') return pl.points
  return Object.values(s.buildings).reduce((n, b) => n + (b.owner === i ? (b.kind === 'city' ? 2 : 1) : 0), 0)
}
const countOf = (s: S, i: number) => {
  const pl = s.players[i] as { handCount?: number; hand: Hand | null }
  return typeof pl.handCount === 'number' ? pl.handCount : pl.hand ? handSize(pl.hand) : 0
}
const pileOf = (s: S) => (typeof s.pile === 'number' ? s.pile : s.pile.length)
/** h minus d (or plus, with sign 1) */
const sub = (h: Hand, d: Partial<Hand>, sign = -1): Hand => {
  const o = { ...h }
  for (const g of GOODS) o[g] += sign * (d[g] ?? 0)
  return o
}
function pick<T>(xs: T[], rnd: () => number): T {
  return xs[Math.floor(rnd() * xs.length)]
}

// ---------------------------------------------------------------- the moment, as the bot sees it

type Ctx = {
  s: S
  p: number
  rnd: () => number
  b: Brain
  lv: (typeof LV)[Level]
  pe: Traits
  hand: Hand
  n: number
  win: number
  kinds: readonly Good[]
  /** pips per good from our buildings (36 pips = one card a roll) */
  rate: Hand
  ratios: Record<Good, number>
  vp: number
  /** how many more rounds the game should last for us */
  H: number
  mem: Memory
  /** what each good is worth to us, roughly (one we don't make: more) */
  w: Record<Good, number>
}

function ctxOf(s: S, p: number, rnd: () => number, b: Brain): Ctx {
  const hand = s.players[p].hand!
  const n = s.players.length
  const kinds: readonly Good[] = s.mode === 'knights' ? GOODS : RESOURCES
  const rate = production(s, p, true)
  const vp = ptsOf(s, p)
  const win = winPoints(s)
  const H = Math.max(3, Math.min(18, (win - vp) * 2.2))
  const w = {} as Record<Good, number>
  for (const g of GOODS) w[g] = (COMMODITIES.includes(g as never) ? 1.1 : 1) * (1 + 0.8 / (1 + rate[g] / 3))
  const mem = remember(s, p, b)
  const lv = { ...LV[b.level] }
  if (b.level === 'expert') {
    const t = TUNE as Record<string, number | undefined>
    if (t.noise !== undefined) lv.noise = t.noise
    if (t.leader !== undefined) lv.leader = t.leader
    if (t.count !== undefined) lv.count = !!t.count
    if (t.offers !== undefined) lv.offers = t.offers
    if (t.acc !== undefined) lv.accept = t.acc
  }
  return { s, p, rnd, b, lv, pe: PE[b.persona], hand, n, win, kinds, rate, ratios: tradeRatios(s, p), vp, H, mem, w }
}

/** what a building on v makes, in pips per good */
function yieldAt(s: S, v: number, city: boolean, robber = false): Hand {
  const out = emptyHand()
  for (const h of TOPO.vertices[v].hexes) {
    if (robber && s.robber === h) continue
    const t = s.tiles[h]
    const r = resourceOf(t)
    if (!r) continue
    const pp = pipsOf(s, h)
    if (!city) out[r] += pp
    else if (s.mode === 'knights') for (const [g, k] of Object.entries(CITY_YIELD[t.terrain as keyof typeof CITY_YIELD])) out[g as Good] += pp * (k ?? 0)
    else out[r] += 2 * pp
  }
  return out
}
function production(s: S, p: number, robber: boolean): Hand {
  const out = emptyHand()
  for (const [v, b] of Object.entries(s.buildings)) {
    if (b.owner !== p) continue
    const y = yieldAt(s, Number(v), b.kind === 'city', robber)
    for (const g of GOODS) out[g] += y[g]
  }
  return out
}

/** about how many rounds until `need` can be paid from h, with what we make and can trade with the bank */
function eta(c: Ctx, h: Hand, need: Partial<Hand>): number {
  const per = c.n / 36
  for (let i = 0; i <= 40; i++) {
    const t = i * 0.5
    let def = 0
    let sur = 0
    for (const g of c.kinds) {
      const have = h[g] + c.rate[g] * per * t
      const nd = need[g] ?? 0
      if (have < nd) def += nd - have
      else sur += Math.floor((have - nd) / c.ratios[g] + 1e-9)
    }
    if (def <= 1e-9 || sur >= Math.ceil(def - 1e-9)) return t
  }
  return 25
}

// ---------------------------------------------------------------- memory: grudges and card counting

function remember(s: S, p: number, b: Brain): Memory {
  const n = s.players.length
  const mem: Memory = b.mem ?? { seen: -1, grudge: Array(n).fill(0), est: s.players.map(() => emptyHand()), unk: Array(n).fill(0) }
  b.mem = mem
  const pe = PE[b.persona]
  const loseAny = (i: number, k: number) => {
    for (let j = 0; j < k; j++) {
      const known = handSize(mem.est[i])
      if (mem.unk[i] >= 1 && mem.unk[i] >= known) mem.unk[i]--
      else if (known > 0) mem.est[i][best(GOODS.filter((x) => mem.est[i][x] > 0), (x) => mem.est[i][x])]--
      else mem.unk[i] = Math.max(0, mem.unk[i] - 1)
    }
  }
  const lose = (i: number, g: Good | undefined, k = 1) => {
    if (!g) return loseAny(i, k)
    const have = mem.est[i][g]
    mem.est[i][g] = Math.max(0, have - k)
    if (have < k) mem.unk[i] = Math.max(0, mem.unk[i] - (k - have))
  }
  const add = (i: number, d: Partial<Hand>, sign = 1) => {
    for (const g of GOODS) {
      const k = d[g] ?? 0
      if (!k) continue
      if (sign > 0) mem.est[i][g] += k
      else lose(i, g, k)
    }
  }
  const mad = (i: number, by: number) => {
    if (i >= 0 && i !== p) mem.grudge[i] = Math.max(0, mem.grudge[i] + by)
  }
  for (const e of s.events) {
    if (e.n <= mem.seen) continue
    mem.seen = e.n
    switch (e.k) {
      case 'turn':
        for (let i = 0; i < n; i++) mem.grudge[i] *= pe.decay
        break
      case 'gain':
        for (const g of e.gains) add(g.p, g.got)
        break
      case 'trade':
        add(e.from, e.give, -1)
        add(e.from, e.get)
        add(e.to, e.give)
        add(e.to, e.get, -1)
        if (e.from === p) mad(e.to, -0.3)
        if (e.to === p) mad(e.from, -0.3)
        break
      case 'bank':
        lose(e.p, e.give, e.count)
        mem.est[e.p][e.get]++
        break
      case 'build':
        if (!e.free) add(e.p, COST[e.what], -1)
        break
      case 'buy':
        add(e.p, COST.card, -1)
        break
      case 'discard':
        loseAny(e.p, e.count)
        break
      case 'steal':
      case 'snatch':
        if (e.k === 'steal' && e.victim === p) mad(e.thief, 1.5)
        if (e.thief >= 0) {
          if (e.r) mem.est[e.thief][e.r]++
          else mem.unk[e.thief]++
        }
        lose(e.victim, e.r)
        break
      case 'caught':
        if (e.victim === p) mad(e.thief, 2)
        break
      case 'robber':
        if (TOPO.hexes[e.hex].vertices.some((v) => s.buildings[v]?.owner === p)) mad(e.p, 1 + pipsOf(s, e.hex) / 5)
        break
      case 'monopoly':
        for (let i = 0; i < n; i++) if (i !== e.p) mem.est[i][e.r] = 0
        mem.est[e.p][e.r] += e.count
        mad(e.p, 1 + e.count * 0.15)
        break
      case 'plenty':
        for (const r of e.take) mem.est[e.p][r]++
        break
      case 'knight':
        if (e.what === 'build' || e.what === 'promote') add(e.p, KNIGHT_COST.knight, -1)
        if (e.what === 'activate') add(e.p, KNIGHT_COST.activate, -1)
        if (e.what === 'displace' && e.victim === p) mad(e.p, 2)
        break
      case 'wall':
        add(e.p, KNIGHT_COST.wall, -1)
        break
      case 'improve':
        add(e.p, { [TRACK_GOOD[e.track]]: e.level }, -1)
        break
      case 'aqueduct':
        mem.est[e.p][e.r]++
        break
      case 'take':
        if (e.from === p) mad(e.p, 1.2)
        if (e.what && e.what !== 'progress') {
          lose(e.from, e.what, e.count)
          mem.est[e.p][e.what] += e.count
        } else if (!e.what) {
          loseAny(e.from, e.count)
          mem.unk[e.p] += e.count
        }
        break
    }
  }
  // square the count with what we can see: each hand's size
  for (let i = 0; i < n; i++) {
    if (i === p) {
      mem.est[i] = { ...s.players[p].hand! }
      mem.unk[i] = 0
      continue
    }
    const hc = countOf(s, i)
    let known = handSize(mem.est[i])
    while (known > hc) {
      mem.est[i][best(GOODS.filter((x) => mem.est[i][x] > 0), (x) => mem.est[i][x])]--
      known--
    }
    mem.unk[i] = hc - known
  }
  return mem
}

/** how many of g we think player i holds (an expert from its count; others from what that player makes) */
function holds(c: Ctx, i: number, g: Good): number {
  const prod = production(c.s, i, false)
  const tot = c.kinds.reduce((n, k) => n + prod[k] + 0.5, 0)
  const share = (prod[g] + 0.5) / tot
  if (!c.lv.count) return countOf(c.s, i) * share
  return c.mem.est[i][g] + c.mem.unk[i] * share
}

/** how much we'd like to hold back player i: the leader, and anyone we bear a grudge against */
function threat(c: Ctx, i: number): number {
  const pts = ptsOf(c.s, i)
  return 1 + c.lv.leader * 4 * (pts / c.win) ** 2 + c.pe.grudge * (c.mem.grudge[i] ?? 0)
}

// ---------------------------------------------------------------- the bot

/** the next thing player p would do, or null when nothing is theirs to do */
export function botAction(s: S, p: number, rnd: () => number, b: Brain = brain()): Action | null {
  const ph = s.phase
  const hand = s.players[p].hand
  if (!hand) return null
  if (ph.kind === 'over') return null
  const easy = b.level === 'easy'
  const c = ctxOf(s, p, rnd, b)

  if (ph.kind === 'discard') {
    const owed = ph.owed[p]
    if (!owed) return null
    let left = { ...hand }
    const cards = emptyHand()
    const plans = easy ? [] : rank(c).slice(0, 2)
    for (let i = 0; i < owed; i++) {
      const r = easy
        ? best(GOODS.filter((x) => left[x] > 0), (x) => left[x] + rnd())
        : best(GOODS.filter((x) => left[x] > 0), (x) => utility(c, sub(left, { [x]: 1 }), plans) + rnd() * 0.01)
      left = sub(left, { [r]: 1 })
      cards[r]++
    }
    return { type: 'discard', cards }
  }

  // someone is sneaking one of our cards: we notice about a third of the time (an expert, half)
  if (s.snatch?.victim === p && (s.snatch.id * 7919) % 100 < (b.level === 'expert' ? 50 : easy ? 20 : 35)) return { type: 'catch' }
  // our own sneaking: wait for it to work out
  if (s.snatch?.thief === p) return null
  // caught sneaking: give back what we need least
  if (ph.kind === 'payback') return ph.thief === p ? { type: 'payback', card: best(GOODS.filter((r) => hand[r] > 0), (r) => hand[r] / c.w[r]) } : null

  // the waterworks: what our plan needs most (easy: what we have least of)
  if (ph.kind === 'aqueduct') {
    if (!ph.owed[p]) return null
    const can = RESOURCES.filter((r) => s.bank[r] > 0)
    if (easy) return { type: 'aqueduct', r: best(can, (r) => -hand[r]) }
    const plans = rank(c).slice(0, 2)
    return { type: 'aqueduct', r: best(can, (r) => utility(c, sub(hand, { [r]: 1 }, 1), plans)) }
  }
  // the barbarians won and we pick which city to lose: a walled one (only its wall goes), else the poorest
  if (ph.kind === 'pillage') {
    const mine = ph.owed[p]
    if (!mine) return null
    const walled = mine.find((v) => s.x?.walls[v] !== undefined)
    return { type: 'pillage', vertex: walled ?? best(mine, (v) => -pips(s, v)) }
  }

  if (ph.kind === 'progressDiscard') {
    if (!ph.owed[p]) return null
    const mine = s.players[p].progress ?? []
    if (!mine.length) return null
    return { type: 'discardProgress', card: pick(mine, rnd).card }
  }

  const o = ph.kind === 'main' ? s.offers.find((x) => x.from !== p && (x.to === undefined || x.to === p) && !x.declined.includes(p) && !x.accepted.includes(p)) : undefined
  if (o) return answer(c, o)

  // a magpie, now and then, sneaks a card from someone holding plenty (on anyone's turn)
  if (c.pe.snatch && ph.kind === 'main' && !s.snatch && s.snatched?.[p] !== s.turn && !s.offers.length) {
    const roll = ((s.turn * 2654435761 + p * 97) >>> 0) % 1000
    if (roll < c.pe.snatch * 1000) {
      const marks = s.players.map((_, i) => i).filter((i) => i !== p && countOf(s, i) >= 4)
      if (marks.length) return { type: 'snatch', victim: best(marks, (i) => countOf(s, i) + threat(c, i)) }
    }
  }

  if (p !== s.current) return null

  switch (ph.kind) {
    case 'setup':
      return setupMove(c)
    case 'roll':
      if (s.mode !== 'knights' && canPlay(s, p, 'knight')) {
        const blocked = TOPO.hexes[s.robber].vertices.reduce((n, v) => n + (s.buildings[v]?.owner === p ? (s.buildings[v].kind === 'city' ? 2 : 1) * pipsOf(s, s.robber) : 0), 0)
        if (blocked >= (easy ? 1 : 4)) return { type: 'playKnight' }
      }
      return { type: 'roll' }
    case 'robber':
      return { type: 'moveRobber', hex: robberHex(c) }
    case 'steal':
      if (easy) return { type: 'steal', victim: pick(ph.victims, rnd) }
      {
        // (an expert also counts: whoever likely holds what our plan lacks)
        const goal = c.lv.count ? (rank(c)[0]?.cost ?? {}) : {}
        const want = (i: number) => c.kinds.reduce((n, g) => n + (hand[g] < (goal[g] ?? 0) ? Math.min(1, holds(c, i, g) / Math.max(1, countOf(s, i))) : 0), 0)
        return { type: 'steal', victim: best(ph.victims, (i) => threat(c, i) + countOf(s, i) * 0.12 + want(i) * 1.5 + rnd() * c.lv.noise) }
      }
    case 'roadBuilding':
      return { type: 'buildRoad', edge: easy ? pick(roadSpots(s, p), rnd) : bestRoad(c) }
    case 'pick':
      return pickMove(c)
    case 'main':
      if (easy) return s.mode === 'knights' ? easyKnights(s, p, hand, rnd) : easyMain(s, p, hand, rnd)
      return mainMove(c)
  }
  return null
}

// ---------------------------------------------------------------- setup

function siteValue(c: Ctx, v: number): number {
  const y = yieldAt(c.s, v, false)
  let val = 0
  for (const g of GOODS) val += y[g] * c.w[g]
  for (const h of c.s.harbors) {
    const e = TOPO.edges[h.edge]
    if (e.a !== v && e.b !== v) continue
    val += h.kind === 'any' ? 2.2 : 1 + 0.45 * (c.rate[h.kind] + y[h.kind])
  }
  return val
}

/** where a settlement could still go, roads aside */
const openSite = (s: S, v: number) => s.buildings[v] === undefined && s.x?.knights[v] === undefined && TOPO.vertices[v].neighbors.every((u) => s.buildings[u] === undefined)

function setupMove(c: Ctx): Action {
  const { s, p, rnd } = c
  const ph = s.phase
  if (ph.kind !== 'setup') return { type: 'endTurn' }
  if (ph.step === 'settlement') {
    const spots = settlementSpots(s, p)
    if (c.b.level === 'easy') return { type: 'buildSettlement', vertex: best(spots, (v) => pips(s, v) + rnd() * 6) }
    // the board's scarce goods are worth more; a first corner wants variety, a second one fills what the first lacks
    const boardPips = emptyHand()
    for (let h = 0; h < TOPO.hexes.length; h++) {
      const r = resourceOf(s.tiles[h])
      if (r) boardPips[r] += pipsOf(s, h)
    }
    const avg = RESOURCES.reduce((n, r) => n + boardPips[r], 0) / 5
    const score = (v: number, rate: Hand, round: number) => {
      const city = s.mode === 'knights' && round === 2
      const y = yieldAt(s, v, city)
      let val = 0
      const seen = new Set<string>()
      for (const h of TOPO.vertices[v].hexes) {
        const r = resourceOf(s.tiles[h])
        if (!r) continue
        const scarce = Math.min(1.5, Math.max(0.75, avg / Math.max(1, boardPips[r])))
        // the early game runs on brick and lumber; the late game on ore and grain
        const tilt = r === 'ore' || r === 'grain' ? 1.12 : (r === 'brick' || r === 'lumber') && round === 1 ? 1.08 : 1
        const pp = pipsOf(s, h)
        val += pp * scarce * tilt * (rate[r] > 0 ? 0.8 : 1) * (city ? 1.5 : 1)
        if (!seen.has(r) && rate[r] === 0) val += 1.3
        seen.add(r)
        // the same number twice is all or nothing
        if (TOPO.vertices[v].hexes.some((k) => k !== h && s.tiles[k].number === s.tiles[h].number)) val -= 0.6
      }
      if (city) for (const g of COMMODITIES) val += y[g] * 0.5
      for (const hb of s.harbors) {
        const e = TOPO.edges[hb.edge]
        if (e.a !== v && e.b !== v) continue
        val += hb.kind === 'any' ? 1.2 : 0.3 * (rate[hb.kind] + y[hb.kind])
      }
      // and room to grow: a good open corner two steps away
      let room = 0
      for (const u of TOPO.vertices[v].neighbors) for (const w of TOPO.vertices[u].neighbors) if (w !== v && openSite(s, w)) room = Math.max(room, pips(s, w))
      return val + room * 0.12
    }
    const jitter = () => 1 + c.lv.noise * 0.5 * (rnd() - 0.5)
    // an expert's first corner looks ahead: the others pick in between (each the richest corner left), and then
    // the best second corner beside this one has to be worth having too
    if (c.b.level === 'expert' && ph.round === 1 && TUNE.look) {
      const between = 2 * c.n - 2 - 2 * p
      const top = [...spots].sort((a, b) => score(b, c.rate, 1) - score(a, c.rate, 1)).slice(0, 10)
      const all = TOPO.vertices.map((_, i) => i)
      return {
        type: 'buildSettlement',
        vertex: best(top, (v1) => {
          const taken = new Set<number>([v1])
          const free = (w: number) => !taken.has(w) && openSite(s, w) && TOPO.vertices[w].neighbors.every((u) => !taken.has(u))
          for (let k = 0; k < between; k++) {
            const left = all.filter(free)
            if (!left.length) break
            taken.add(best(left, (w) => pips(s, w)))
          }
          const rate = sub(c.rate, yieldAt(s, v1, false), 1)
          const left = all.filter(free)
          const second = left.length ? Math.max(...left.map((w) => score(w, rate, 2))) : 0
          return score(v1, c.rate, 1) + 0.9 * second
        }),
      }
    }
    return { type: 'buildSettlement', vertex: best(spots, (v) => score(v, c.rate, ph.round) * jitter()) }
  }
  // the road: toward the best open corner beyond
  const roads = roadSpots(s, p)
  if (c.b.level === 'easy') return { type: 'buildRoad', edge: pick(roads, rnd) }
  const from = ph.settlement!
  return {
    type: 'buildRoad',
    edge: best(roads, (e) => {
      const ed = TOPO.edges[e]
      const w = ed.a === from ? ed.b : ed.a
      let top = 0
      for (const u of TOPO.vertices[w].neighbors) if (u !== from && openSite(s, u)) top = Math.max(top, siteValue(c, u))
      return top + rnd() * 0.3
    }),
  }
}

// ---------------------------------------------------------------- goals

type Plan = { kind: string; id: string; cost: Partial<Hand>; value: number; eta: number; score: number; act: () => Action | null }

/** open corners we could reach with up to three more roads, and the roads to them (in order) */
function reach(c: Ctx): { v: number; path: number[] }[] {
  const { s, p } = c
  const blocked = (v: number) => (s.buildings[v] !== undefined && s.buildings[v].owner !== p) || (s.x?.knights[v] !== undefined && s.x.knights[v].owner !== p)
  const seen = new Map<number, number[]>()
  let frontier: { v: number; path: number[] }[] = []
  for (let v = 0; v < TOPO.vertices.length; v++) {
    if (s.buildings[v]?.owner === p || (!blocked(v) && TOPO.vertices[v].edges.some((e) => s.roads[e] === p))) {
      seen.set(v, [])
      frontier.push({ v, path: [] })
    }
  }
  for (let d = 0; d < 3; d++) {
    const next: typeof frontier = []
    for (const f of frontier) {
      if (blocked(f.v)) continue
      for (const e of TOPO.vertices[f.v].edges) {
        if (s.roads[e] !== undefined) continue
        const ed = TOPO.edges[e]
        const w = ed.a === f.v ? ed.b : ed.a
        if (seen.has(w)) continue
        const path = [...f.path, e]
        seen.set(w, path)
        next.push({ v: w, path })
      }
    }
    frontier = next
  }
  const now = new Set(settlementSpots(s, p))
  const out: { v: number; path: number[] }[] = []
  for (const [v, path] of seen) {
    if (!openSite(s, v)) continue
    if (path.length === 0 && !now.has(v)) continue
    out.push({ v, path })
  }
  return out
}

function knightStrength(s: S, p?: number) {
  return Object.values(s.x?.knights ?? {}).filter((k) => (p === undefined || k.owner === p) && k.active).reduce((n, k) => n + k.level, 0)
}

/** every goal worth chasing now, best first */
function rank(c: Ctx): Plan[] {
  const { s, p, hand, rnd } = c
  const me = s.players[p]
  const x = s.x
  const knights = s.mode === 'knights'
  const plans: Plan[] = []
  // a pip of production, in points, over the rest of the game (a card is worth about a fifth of a point)
  const card = tune(c, 'prod') * (c.n / 36) * c.H * tune(c, 'H')
  const prodVal = (y: Hand) => GOODS.reduce((n, g) => n + y[g] * c.w[g], 0) * card
  const add = (kind: string, cost: Partial<Hand>, value: number, act: () => Action | null, at: number | string = '') => {
    if (value <= 0) return
    const e = eta(c, hand, cost)
    const id = `${kind === 'path' ? 'settlement' : kind}:${at}`
    // (an expert sticks with the goal it chose, so its trades add up)
    const noisy = value * (1 + c.lv.noise * (rnd() - 0.5)) * (c.mem.goal === id ? 1 + tune(c, 'commit') : 1)
    const disc = tune(c, 'disc')
    plans.push({ kind, id, cost, value, eta: e, score: disc ? noisy * disc ** e : noisy / (e + 1), act })
  }

  // cities
  if (me.pieces.city > 0) {
    for (const v of citySpots(s, p)) {
      const gain = sub(yieldAt(s, v, true), yieldAt(s, v, false))
      add('city', COST.city, (1 + prodVal(gain) + (knights ? 0.6 : 0)) * tune(c, 'city'), () => ({ type: 'buildCity', vertex: v }), v)
    }
  }
  // settlements, with the roads to them
  if (me.pieces.settlement > 0) {
    for (const { v, path } of reach(c)) {
      if (path.length > me.pieces.road) continue
      const cost = { ...COST.settlement }
      cost.lumber += path.length
      cost.brick += path.length
      // a far corner might be taken first
      const risk = 0.82 ** path.length
      add(path.length ? 'path' : 'settlement', cost, (1 + prodVal(yieldAt(s, v, false)) + portVal(c, v)) * risk * c.pe.settle * tune(c, 'settle'), () =>
        path.length ? { type: 'buildRoad', edge: path[0] } : { type: 'buildSettlement', vertex: v },
        v,
      )
    }
  }
  // the longest road
  if (me.pieces.road > 0 && roadSpots(s, p).length) {
    const mine = longestRun(s, p)
    const others = Math.max(0, ...s.players.map((_, i) => (i === p ? 0 : longestRun(s, i))))
    if (s.longestRoad !== p) {
      const need = Math.max(LONGEST_ROAD_MIN, others + 1) - mine
      if (need >= 1 && need <= 4 && need <= me.pieces.road) add('longest', { lumber: need, brick: need }, (2 * c.pe.road * tune(c, 'road')) / (1 + 0.25 * need), () => ({ type: 'buildRoad', edge: bestRoad(c) }))
    } else if (others >= mine - 1) add('longest', COST.road, 0.9 * c.pe.road * tune(c, 'road'), () => ({ type: 'buildRoad', edge: bestRoad(c) }))
  }
  // a development card (the base game)
  if (!knights && pileOf(s) > 0) {
    const army = me.knights + (me.cards ?? []).filter((k) => k.card === 'knight').length
    const top = Math.max(0, ...s.players.map((pl, i) => (i === p ? 0 : pl.knights)))
    const race = s.largestArmy !== p && army + 2 >= Math.max(LARGEST_ARMY_MIN, top + 1) ? 0.45 * c.pe.army : 0
    add('card', COST.card, (0.55 + race + 0.04 * c.H) * c.pe.cards * tune(c, 'card'), () => ({ type: 'buyCard' }))
  }
  // the expansion: city improvements, knights, walls
  if (x) {
    const cities = Object.entries(s.buildings).filter(([, bd]) => bd.owner === p && bd.kind === 'city').map(([v]) => Number(v))
    const metro = new Set(Object.values(x.metropolis).filter((v): v is number => v !== null))
    const free = cities.filter((v) => !metro.has(v)).length
    for (const t of TRACKS) {
      const cost = improveCost(s, p, t)
      if (!cost) continue
      const L = x.levels[p][t] + 1
      let v = 0.35 + 0.12 * L
      if (L === 3) v += t === 'science' ? 1 : t === 'trade' ? 0.8 : 0.6
      const at = x.metropolis[t]
      const holder = at === null ? null : (s.buildings[at]?.owner ?? null)
      const othersTop = Math.max(0, ...s.players.map((_, i) => (i === p ? 0 : x.levels[i][t])))
      if (L >= 4 && free > 0) {
        if (holder === null && othersTop < L) v += 2.4
        else if (holder !== null && holder !== p && L === MAX_LEVEL && x.levels[holder][t] < MAX_LEVEL) v += 2.4
      }
      // the steps toward a metropolis count too, while it's still to be won
      if (L <= 3 && free > 0 && (holder === null || holder === p) && othersTop <= L + 1) v += 0.35 * L
      if (t === 'science') v *= c.pe.science
      add('improve', cost, v, () => ({ type: 'improve', track: t }), t)
    }
    // the barbarians: how near, and whether we'd be among the weakest when they land
    const rounds = ((BARBARIAN_STEPS - x.barbarian) * 2) / c.n
    const urgency = Math.min(2, Math.max(0.2, 2 / (rounds + 0.5)))
    const cityCount = Object.values(s.buildings).filter((bd) => bd.kind === 'city').length
    const mine = knightStrength(s, p)
    const holders = s.players.map((_, i) => i).filter((i) => Object.values(s.buildings).some((bd) => bd.owner === i && bd.kind === 'city'))
    const weakest = Math.min(99, ...holders.map((i) => knightStrength(s, i)))
    const atRisk = free > 0 && knightStrength(s) < cityCount && mine <= weakest
    const topOther = Math.max(0, ...s.players.map((_, i) => (i === p ? 0 : knightStrength(s, i))))
    // (losing a city costs a point and its goods: worth a lot of knights)
    const perStrength = (atRisk ? (tune(c, 'kn') ? 2.4 : 1.4) : 0) + (mine + 1 > topOther ? 0.5 : 0.1)
    const rest = activateSpots(s, p)
    if (rest.length) {
      const v = best(rest, (k) => x.knights[k].level)
      add('activate', KNIGHT_COST.activate, (0.15 + urgency * perStrength * x.knights[v].level) * c.pe.knights, () => ({ type: 'activateKnight', vertex: v }))
    }
    const spots = knightSpots(s, p)
    if (spots.length && me.pieces.knight[1] > 0) {
      const v = best(spots, (k) => pips(s, k) + (TOPO.vertices[k].neighbors.some((u) => s.buildings[u] && s.buildings[u].owner !== p) ? 2 : 0))
      add('knight', KNIGHT_COST.knight, (0.35 + urgency * perStrength * 0.6) * c.pe.knights, () => ({ type: 'buildKnight', vertex: v }))
    }
    const up = promoteSpots(s, p)
    if (up.length) {
      const v = best(up, (k) => (x.knights[k].active ? 1 : 0) + x.knights[k].level)
      add('promote', KNIGHT_COST.promote, (0.25 + urgency * perStrength * (x.knights[v].active ? 0.8 : 0.4)) * c.pe.knights, () => ({ type: 'promoteKnight', vertex: v }))
    }
    const walls = wallSpots(s, p)
    if (walls.length && me.pieces.wall > 0) {
      const v = best(walls, (k) => pips(s, k))
      // (a wall holds two more cards through a 7, for good)
      const keep = tune(c, 'kn') ? 0.5 + 0.35 * risk(c, hand) : handSize(hand) > 7 ? 0.3 : 0
      add('wall', KNIGHT_COST.wall, 0.3 + (atRisk ? 0.6 : 0) + keep, () => ({ type: 'buildWall', vertex: v }))
    }
  }
  return plans.sort((a, b) => b.score - a.score)
}

function portVal(c: Ctx, v: number) {
  let val = 0
  for (const h of c.s.harbors) {
    const e = TOPO.edges[h.edge]
    if (e.a !== v && e.b !== v) continue
    if (h.kind === 'any') val += c.ratios.lumber > 3 || c.ratios.ore > 3 ? 0.5 : 0
    else if (c.ratios[h.kind] > 2) val += 0.08 * c.rate[h.kind]
  }
  return val
}

/** the road that does the most: lengthens our longest run, or heads for a good open corner */
function bestRoad(c: Ctx): number {
  const { s, p, rnd } = c
  const spots = roadSpots(s, p)
  const run = longestRun(s, p)
  const sites = reach(c)
  return best(spots, (e) => {
    const longer = longestRun({ ...s, roads: { ...s.roads, [e]: p } } as S, p) - run
    let toward = 0
    for (const { v, path } of sites) if (path[0] === e) toward = Math.max(toward, siteValue(c, v) / (path.length + 1))
    return longer * 2 * c.pe.road + toward * 0.4 + rnd() * 0.05
  })
}

/** how good a hand is for our goals: nearer goals, and not too many cards when a 7 comes */
function utility(c: Ctx, h: Hand, plans: Plan[]): number {
  let u = 0
  plans.forEach((pl, i) => (u -= eta(c, h, pl.cost) * (i === 0 ? 1 : 0.4)))
  for (const g of c.kinds) u += Math.max(0, h[g]) * c.w[g] * 0.03
  return u - risk(c, h) * 0.3
}

/** cards we'd expect to lose to a 7 before our next turn, holding h (counting what comes in meanwhile) */
function risk(c: Ctx, h: Hand): number {
  const coming = c.kinds.reduce((n, g) => n + c.rate[g], 0) * ((c.n - 1) / 36) * 0.5
  const size = handSize(h) + coming
  if (size <= handLimit(c.s, c.p)) return 0
  return (1 - (5 / 6) ** c.n) * Math.floor(size / 2)
}

// ---------------------------------------------------------------- the turn

/** what a step toward a plan costs right now: its whole price, or one road when roads come first */
const stepCost = (q: Plan) => (q.kind === 'path' || q.kind === 'longest' ? COST.road : q.cost)

function mainMove(c: Ctx): Action | null {
  const { s, p, hand, rnd } = c
  const knights = s.mode === 'knights'

  const waiting = ownOffer(c)
  if (waiting !== undefined) return waiting

  // cards first: whatever is worth playing now
  const played = knights ? progressMove(c) : devMove(c)
  if (played) return played

  if (knights) {
    // the robber on one of our tiles, and a ready knight beside it: chase it off
    const chase = chaseSpots(s, p)
    if (chase.length && TOPO.hexes[s.robber].vertices.some((v) => s.buildings[v]?.owner === p)) return { type: 'chaseRobber', from: chase[0] }
    // push away a weaker knight of someone we'd hold back
    for (const [v, k] of Object.entries(s.x!.knights)) {
      if (k.owner !== p || !canAct(s, Number(v))) continue
      const hits = knightMoves(s, Number(v)).filter((w) => s.x!.knights[w] !== undefined && s.x!.knights[w].owner !== p)
      if (!hits.length) continue
      const w = best(hits, (u) => threat(c, s.x!.knights[u].owner))
      if (threat(c, s.x!.knights[w].owner) > 1.6 || rnd() < 0.1) return { type: 'moveKnight', from: Number(v), to: w }
    }
  }

  const plans = rank(c)
  const top = plans[0]
  if (top) {
    c.mem.goal = top.id
    if (hasAll(hand, stepCost(top))) {
      const a = top.act()
      if (a) return a
    }
    // anything else we can afford that doesn't set the main goal back
    // (with a hand a 7 would cut, spending it on something is better than losing it)
    const now = eta(c, hand, top.cost)
    const slack = c.lv.hold && risk(c, hand) > 0 ? 1.5 : 0.01
    for (const q of plans.slice(1)) {
      const cost = stepCost(q)
      if (!hasAll(hand, cost)) continue
      if (eta(c, sub(hand, cost), top.cost) <= now + slack || q.score >= top.score * 0.85) {
        const a = q.act()
        if (a) return a
      }
    }
    const t = tradeMove(c, plans)
    if (t) return t
  }

  // too many cards for a 7: spend, or trade down
  const lose = risk(c, hand)
  if (c.lv.hold && lose > 0) {
    for (const q of plans) {
      if (!hasAll(hand, stepCost(q))) continue
      const a = q.act()
      if (a) return a
    }
    if (!knights && pileOf(s) > 0 && affordable(s, p, 'card')) return { type: 'buyCard' }
    // a bank trade only when it costs less than the 7 would
    const gives = c.kinds.filter((g) => hand[g] >= c.ratios[g] && c.ratios[g] - 1 < lose)
    if (gives.length && bankTradesThisTurn(s, p) < 4) {
      const give = best(gives, (g) => hand[g] - c.ratios[g])
      const gets = RESOURCES.filter((g) => g !== give && s.bank[g] > 0)
      if (gets.length) return { type: 'bankTrade', give, get: best(gets, (g) => -hand[g] * c.w[g]) }
    }
  }
  return { type: 'endTurn' }
}

function bankTradesThisTurn(s: S, p: number) {
  let n = 0
  for (let i = s.events.length - 1; i >= 0; i--) {
    const e = s.events[i]
    if (e.k === 'turn') break
    if (e.k === 'bank' && e.p === p) n++
  }
  return n
}

/** this turn's offers by p (so as not to ask the same twice) */
function offersThisTurn(s: S, p: number, reaching?: number[]) {
  const out: string[] = []
  for (let i = s.events.length - 1; i >= 0; i--) {
    const e = s.events[i]
    if (e.k === 'turn') break
    if (e.k !== 'offer' || e.p !== p) continue
    if (reaching && !(e.to === undefined ? reaching.length > 0 : reaching.includes(e.to))) continue
    out.push(key(e.give, e.get, e.to))
  }
  return out
}
const key = (give: Partial<Hand>, get: Partial<Hand>, to?: number) => JSON.stringify([GOODS.map((g) => give[g] ?? 0), GOODS.map((g) => get[g] ?? 0), to ?? null])

function tradeMove(c: Ctx, plans: Plan[]): Action | null {
  const { s, p, hand } = c
  const goal = plans[0].cost
  const two = plans.slice(0, 2)
  const short = c.kinds.filter((g) => hand[g] < (goal[g] ?? 0))
  if (!short.length) return null
  const now = utility(c, hand, two)

  // the best bank trade toward the goal
  let bank: { give: Good; get: Good; u: number; done: boolean } | null = null
  if (bankTradesThisTurn(s, p) < 4) {
    for (const give of c.kinds) {
      if (hand[give] - (goal[give] ?? 0) < c.ratios[give]) continue
      for (const get of short) {
        if (s.bank[get] <= 0) continue
        const after = sub(sub(hand, { [give]: c.ratios[give] }), { [get]: 1 }, 1)
        const u = utility(c, after, two)
        if (u > now + 0.15 && (!bank || u > bank.u)) bank = { give, get, u, done: hasAll(after, goal) }
      }
    }
  }
  // the table first, unless a cheap bank trade finishes it
  const asked = offersThisTurn(s, p)
  // (people get a few asks a turn, not a stream of them)
  const people = c.b.people ?? []
  const toPeople = offersThisTurn(s, p, people).length
  const canOffer = asked.length < c.lv.offers + c.pe.offers + tune(c, 'greedy') && s.offers.length < 4
  const peopleOk = toPeople < (c.pe.generous ? 3 : 2)
  if (bank && bank.done && c.ratios[bank.give] <= 2) return { type: 'bankTrade', give: bank.give, get: bank.get }
  if (canOffer) {
    const off = makeOffer(c, two, asked, peopleOk ? [] : people)
    if (off) return off
  }
  return bank ? { type: 'bankTrade', give: bank.give, get: bank.get } : null
}

/** an offer to the table (or to one player): a card or two we can spare for one we need */
function makeOffer(c: Ctx, plans: Plan[], asked: string[], skip: number[]): Action | null {
  const { s, p, hand } = c
  const goal = plans[0].cost
  const short = c.kinds.filter((g) => hand[g] < (goal[g] ?? 0))
  const spare = c.kinds.filter((g) => hand[g] - (goal[g] ?? 0) >= 1)
  if (!short.length || !spare.length) return null
  const now = utility(c, hand, plans)
  const options: { give: Hand; get: Hand; to?: number; u: number }[] = []
  const others = s.players.map((_, i) => i).filter((i) => i !== p && countOf(s, i) > 0 && !skip.includes(i))
  if (!others.length) return null
  const nearWin = (i: number) => ptsOf(s, i) >= c.win - 2
  for (const get of short) {
    for (const give of spare) {
      // (a merchant pays two for one; an expert first asks two for one)
      for (const [k, m] of c.pe.generous ? [[1, 1], [2, 1]] : tune(c, 'greedy') ? [[1, 2], [1, 1]] : [[1, 1]]) {
        if (hand[give] - (goal[give] ?? 0) < k) continue
        const g = { ...emptyHand(), [give]: k }
        const want = { ...emptyHand(), [get]: m }
        const u = utility(c, sub(sub(hand, g), want, 1), plans) - now - (k - 1) * 0.25 + (m - 1) * 0.6
        if (u <= 0.05) continue
        // who might have it (an expert counts; others guess from what they make), and who we'd rather not help
        let to: number | undefined
        if (c.lv.leader >= 1) {
          const fair = others.filter((i) => !nearWin(i) && c.mem.grudge[i] * c.pe.grudge < 2)
          const likely = fair.filter((i) => holds(c, i, get) >= (c.lv.count ? 0.8 : 0.4))
          if (!likely.length) continue
          // one player clearly has it, or the leader is close: ask just them
          if (likely.length === 1 || others.some(nearWin)) to = best(likely, (i) => holds(c, i, get) - threat(c, i) * 0.3)
        }
        if (to === undefined && skip.length) to = best(others, (i) => holds(c, i, get))
        if (asked.includes(key(g, want, to))) continue
        options.push({ give: g, get: want, to, u })
      }
    }
  }
  if (!options.length) return null
  const o = best(options, (x) => x.u)
  return { type: 'offerTrade', give: o.give, get: o.get, ...(o.to !== undefined ? { to: o.to } : {}) }
}

/** our own open offer: trade with the best who said yes; once all asked have said no, take it back; else wait */
function ownOffer(c: Ctx): Action | null | undefined {
  const { s, p } = c
  const o = s.offers.find((x) => x.from === p)
  if (!o) return undefined
  if (o.accepted.length) return { type: 'confirmTrade', id: o.id, with: best(o.accepted, (i) => -threat(c, i)) }
  const asked = s.players.map((_, i) => i).filter((i) => i !== p && (o.to === undefined || i === o.to))
  if (asked.every((i) => o.declined.includes(i))) return { type: 'cancelOffer', id: o.id }
  return null
}

/** someone's offer to us: yes when it brings our goals nearer (and we don't mind helping them) */
function answer(c: Ctx, o: S['offers'][number]): Action {
  const { s, hand, rnd, b } = c
  const no: Action = { type: 'declineOffer', id: o.id }
  if (!hasAll(hand, o.get)) return no
  // a wildcard: give what we need least (not a kind they give)
  let left = sub(hand, o.get)
  const pickH = emptyHand()
  const plans = b.level === 'easy' ? [] : rank(c).slice(0, 2)
  for (let k = 0; k < o.any; k++) {
    const opts = GOODS.filter((g) => left[g] > 0 && !(o.give[g] > 0))
    if (!opts.length) break
    const r = plans.length ? best(opts, (g) => utility(c, sub(left, { [g]: 1 }), plans)) : best(opts, (g) => left[g])
    left = sub(left, { [r]: 1 })
    pickH[r]++
  }
  if (handSize(pickH) !== o.any) return no
  const yes: Action = { type: 'acceptOffer', id: o.id, ...(o.any ? { pick: pickH } : {}) }
  if (b.level === 'easy') return handSize(o.give) >= handSize(o.get) + o.any && rnd() < 0.5 ? yes : no
  // no deals with whoever wronged us (one who holds a grudge: not even a good one)
  if (c.mem.grudge[o.from] * c.pe.grudge >= 2.5) return no
  const gain = utility(c, sub(left, o.give, 1), plans) - utility(c, hand, plans)
  // helping someone ahead costs us; near the win, nobody sensible helps them
  const lead = ptsOf(s, o.from) - c.vp
  const bar = c.lv.accept + c.pe.accept + tune(c, 'accept') + c.lv.leader * Math.max(0, lead) * 0.12 + (ptsOf(s, o.from) >= c.win - 2 ? c.lv.leader * 2 : 0)
  return gain > bar + (b.level === 'normal' ? (rnd() - 0.5) * 0.3 : 0) ? yes : no
}

// ---------------------------------------------------------------- the robber

function robberHex(c: Ctx): number {
  const { s, p, rnd, b } = c
  const spots = robberSpots(s)
  if (b.level === 'easy') {
    const hexes = spots.filter((h) => !TOPO.hexes[h].vertices.some((v) => s.buildings[v]?.owner === p))
    const score = (h: number) => TOPO.hexes[h].vertices.filter((v) => s.buildings[v] !== undefined).length * pipsOf(s, h) + rnd() * 4
    return best(hexes.length ? hexes : spots, score)
  }
  return best(spots, (h) => {
    let block = 0
    let mine = 0
    let steal = 0
    const pp = pipsOf(s, h)
    for (const v of TOPO.hexes[h].vertices) {
      const bd = s.buildings[v]
      if (!bd) continue
      const amt = bd.kind === 'city' ? 2 : 1
      if (bd.owner === p) mine += amt * pp
      else {
        block += amt * pp * threat(c, bd.owner)
        if (countOf(s, bd.owner) > 0) steal = Math.max(steal, threat(c, bd.owner) * (1.5 + countOf(s, bd.owner) * 0.15))
      }
    }
    return block + steal * 1.5 - mine * 3 + rnd() * c.lv.noise * 2
  })
}

// ---------------------------------------------------------------- cards

function devMove(c: Ctx): Action | null {
  const { s, p, hand } = c
  if (s.cardPlayed) return null
  const me = s.players[p]
  const plans = rank(c).slice(0, 2)
  // a monopoly: the resource the others hold most of (counted, or guessed)
  if (canPlay(s, p, 'monopoly')) {
    const total = (r: Resource) => s.players.reduce((n, _, i) => n + (i === p ? 0 : holds(c, i, r)), 0)
    const r = best([...RESOURCES], (r) => total(r) * c.w[r] + (plans[0] && (plans[0].cost[r] ?? 0) > hand[r] ? 1.5 : 0))
    if (total(r) >= (c.lv.count ? 3.5 : 2.5)) return { type: 'playMonopoly', resource: r }
  }
  if (canPlay(s, p, 'yearOfPlenty') && plans[0] && eta(c, hand, plans[0].cost) > 0) {
    const want = RESOURCES.filter((r) => s.bank[r] > 0)
    let pair: [Resource, Resource] | null = null
    let bu = -Infinity
    for (const a of want)
      for (const b of want) {
        if (b < a || (a === b && s.bank[a] < 2)) continue
        const u = utility(c, sub(hand, a === b ? { [a]: 2 } : { [a]: 1, [b]: 1 }, 1), plans)
        if (u > bu) {
          bu = u
          pair = [a, b]
        }
      }
    if (pair) return { type: 'playYearOfPlenty', take: pair }
  }
  if (canPlay(s, p, 'roadBuilding') && me.pieces.road > 1 && roadSpots(s, p).length) {
    if (plans.some((pl) => pl.kind === 'path' || pl.kind === 'longest') || me.pieces.road > 9) return { type: 'playRoadBuilding' }
  }
  if (canPlay(s, p, 'knight')) {
    const top = Math.max(0, ...s.players.map((pl, i) => (i === p ? 0 : pl.knights)))
    const race = s.largestArmy !== p && me.knights + 1 >= Math.max(LARGEST_ARMY_MIN, top + 1)
    const onMe = TOPO.hexes[s.robber].vertices.some((v) => s.buildings[v]?.owner === p)
    const target = robberHex(c)
    const worth = TOPO.hexes[target].vertices.some((v) => s.buildings[v] && s.buildings[v].owner !== p && threat(c, s.buildings[v].owner) > 1.8)
    if (race || onMe || worth || c.pe.army > 1.3) return { type: 'playKnight' }
  }
  return null
}

/** progress cards worth playing as soon as they can be (Augury is only for before a roll, and is skipped) */
const PLAY_NOW: Progress[] = ['trader', 'charter', 'corner', 'guild', 'bargain', 'caravan', 'sheriff', 'turncoat', 'envoy', 'ruse', 'unrest', 'spy', 'rally', 'feast', 'scaffold', 'mason', 'surveyor', 'irrigation', 'mining', 'physician', 'roadCrew', 'smith']

const besideTerrain = (s: S, p: number, terrain: string) =>
  Object.entries(s.buildings).some(([v, bd]) => bd.owner === p && TOPO.vertices[Number(v)].hexes.some((h) => s.tiles[h].terrain === terrain))

function progressMove(c: Ctx): Action | null {
  const { s, p, hand } = c
  for (const card of s.players[p].progress ?? []) {
    if (!PLAY_NOW.includes(card.card)) continue
    // a few are better kept for the right moment
    if (card.card === 'scaffold' && !TRACKS.some((t) => (improveCost(s, p, t)?.[TRACK_GOOD[t]] ?? 99) - 1 <= hand[TRACK_GOOD[t]])) continue
    if (card.card === 'irrigation' && !besideTerrain(s, p, 'fields')) continue
    if (card.card === 'mining' && !besideTerrain(s, p, 'mountains')) continue
    if (playable(s, p, card.card)) return { type: 'playProgress', card: card.card }
  }
  return null
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

function pickMove(c: Ctx): Action {
  const { s, p, rnd } = c
  const ph = s.phase
  if (ph.kind !== 'pick') return { type: 'cancelPick' }
  const targets = pickTargets(s as never, p)
  if (!targets.length) return { type: 'cancelPick' }
  const x = s.x!
  const hand = s.players[p].hand!
  let t: number | Good = pick(targets, rnd)
  const plans = c.b.level === 'easy' ? [] : rank(c).slice(0, 2)
  switch (ph.need) {
    case 'resource':
    case 'good':
    case 'commodity':
      if (ph.card === 'charter') t = best(targets as Good[], (g) => hand[g] + rnd())
      else if (ph.card === 'corner' || ph.card === 'guild') {
        // taken from everyone: what they hold most of, weighted by what we want
        const total = (g: Good) => s.players.reduce((n, _, i) => n + (i === p ? 0 : holds(c, i, g)), 0)
        t = best(targets as Good[], (g) => total(g) * c.w[g] + rnd() * 0.1)
      } else t = plans.length ? best(targets as Good[], (g) => utility(c, sub(hand, { [g]: 1 }, 1), plans) + rnd() * 0.01) : best(targets as Good[], (g) => -hand[g] + rnd())
      break
    case 'player':
      t = best(targets as number[], (i) => threat(c, i) * 2 + countOf(s, i) / 5 + rnd() * c.lv.noise)
      break
    case 'enemyKnight':
      t = best(targets as number[], (v) => x.knights[v].level + threat(c, x.knights[v].owner) + rnd() * 0.2)
      break
    case 'knightSpot':
    case 'mySettlement':
      t = best(targets as number[], (v) => pips(s, v) + rnd())
      break
    case 'hex':
      t = best(targets as number[], (h) => pipsOf(s, h) + rnd())
      break
  }
  return { type: 'pick', target: t }
}

// ---------------------------------------------------------------- easy: the plain bot, careless on purpose

function easyMain(s: S, p: number, hand: Hand, rnd: () => number): Action | null {
  const me = s.players[p]
  const mine = s.offers.find((x) => x.from === p)
  if (mine) return mine.accepted.length ? { type: 'confirmTrade', id: mine.id, with: mine.accepted[0] } : { type: 'cancelOffer', id: mine.id }
  if (!s.cardPlayed) {
    if (canPlay(s, p, 'monopoly')) return { type: 'playMonopoly', resource: pick([...RESOURCES], rnd) }
    if (canPlay(s, p, 'yearOfPlenty')) {
      const want = RESOURCES.filter((r) => s.bank[r] > 0)
      if (want.length) return { type: 'playYearOfPlenty', take: [pick(want, rnd), pick(want, rnd)].sort() as [Resource, Resource] }
    }
    if (canPlay(s, p, 'roadBuilding') && me.pieces.road > 0 && roadSpots(s, p).length) return { type: 'playRoadBuilding' }
    if (canPlay(s, p, 'knight') && rnd() < 0.5) return { type: 'playKnight' }
  }
  // (now and then it simply forgets to build)
  if (rnd() < 0.15) return { type: 'endTurn' }
  const cities = citySpots(s, p)
  if (cities.length && me.pieces.city > 0 && affordable(s, p, 'city')) return { type: 'buildCity', vertex: best(cities, (v) => pips(s, v)) }
  const spots = settlementSpots(s, p)
  if (spots.length && me.pieces.settlement > 0 && affordable(s, p, 'settlement')) return { type: 'buildSettlement', vertex: best(spots, (v) => pips(s, v) + rnd() * 5) }
  const roads = roadSpots(s, p)
  if (roads.length && me.pieces.road > 0 && affordable(s, p, 'road') && (spots.length === 0 || rnd() < 0.4)) return { type: 'buildRoad', edge: pick(roads, rnd) }
  if (pileOf(s) > 0 && affordable(s, p, 'card') && rnd() < 0.6) return { type: 'buyCard' }
  return easyTrade(s, p, hand, cities.length && me.pieces.city > 0 ? COST.city : spots.length ? COST.settlement : COST.road, rnd)
}

function easyTrade(s: S, p: number, hand: Hand, goal: Partial<Hand>, rnd: () => number): Action {
  const ratios = tradeRatios(s, p)
  const kinds: readonly Good[] = s.mode === 'knights' ? GOODS : RESOURCES
  const need = kinds.filter((r) => hand[r] < (goal[r] ?? 0) && s.bank[r] > 0)
  const spare = kinds.filter((r) => hand[r] - (goal[r] ?? 0) >= ratios[r])
  if (need.length && spare.length && rnd() < 0.5) return { type: 'bankTrade', give: pick(spare, rnd), get: pick(need, rnd) }
  return { type: 'endTurn' }
}

function easyKnights(s: S, p: number, hand: Hand, rnd: () => number): Action | null {
  const me = s.players[p]
  const x = s.x!
  const mine = s.offers.find((o) => o.from === p)
  if (mine) return mine.accepted.length ? { type: 'confirmTrade', id: mine.id, with: mine.accepted[0] } : { type: 'cancelOffer', id: mine.id }
  if (x.barbarian >= BARBARIAN_STEPS - 2 && knightStrength(s, p) < 1) {
    const rest = activateSpots(s, p)
    if (rest.length && hasAll(hand, KNIGHT_COST.activate)) return { type: 'activateKnight', vertex: rest[0] }
    const spots = knightSpots(s, p)
    if (spots.length && me.pieces.knight[1] > 0 && hasAll(hand, KNIGHT_COST.knight)) return { type: 'buildKnight', vertex: pick(spots, rnd) }
  }
  for (const c of me.progress ?? []) if (PLAY_NOW.includes(c.card) && playable(s, p, c.card) && rnd() < 0.7) return { type: 'playProgress', card: c.card }
  if (rnd() < 0.15) return { type: 'endTurn' }
  const cities = citySpots(s, p)
  if (cities.length && me.pieces.city > 0 && affordable(s, p, 'city')) return { type: 'buildCity', vertex: best(cities, (v) => pips(s, v)) }
  const tracks = TRACKS.filter((t) => {
    const cost = improveCost(s, p, t)
    return cost && hasAll(hand, cost)
  })
  if (tracks.length) return { type: 'improve', track: pick(tracks, rnd) }
  const spots = settlementSpots(s, p)
  if (spots.length && me.pieces.settlement > 0 && affordable(s, p, 'settlement')) return { type: 'buildSettlement', vertex: best(spots, (v) => pips(s, v) + rnd() * 5) }
  const kspots = knightSpots(s, p)
  if (kspots.length && me.pieces.knight[1] > 0 && hasAll(hand, KNIGHT_COST.knight) && rnd() < 0.3) return { type: 'buildKnight', vertex: pick(kspots, rnd) }
  const roads = roadSpots(s, p)
  if (roads.length && me.pieces.road > 0 && affordable(s, p, 'road') && (spots.length === 0 || rnd() < 0.3)) return { type: 'buildRoad', edge: pick(roads, rnd) }
  return easyTrade(s, p, hand, cities.length && me.pieces.city > 0 ? COST.city : spots.length ? COST.settlement : COST.road, rnd)
}
