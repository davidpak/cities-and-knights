/**
 * Data for the Bot Lab page: bots playing each other, measured.
 *   npx tsx shared/lab.ts ladder <games> <seed>        a mixed field, many games: ratings and openings
 *   npx tsx shared/lab.ts match <seed>                  one showcase game, every turn kept
 *   npx tsx shared/lab.ts odds <seed> <from> <step> <n> win chances along the showcase game, by playing the rest out n times
 *   npx tsx shared/lab.ts study <games> <seed> [knights]  one row per player per game: the opening, what they did, how it ended
 * Each prints JSON.
 */
import { TOPO } from './board.ts'
import { BOT_CAST, botAction, brain, type Brain, type Level, type Persona } from './bot.ts'
import { apply, newGame, resourceOf, tradeRatios, viewFor, victoryPoints, type GameState } from './engine.ts'
import { RESOURCES, type Resource } from './rules.ts'

declare const process: { argv: string[]; stdout: { write: (s: string) => void } }

function rng(seed: number) {
  let t = seed | 0
  return () => {
    t = (t + 0x6d2b79f5) | 0
    let x = Math.imul(t ^ (t >>> 15), t | 1)
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61)
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296
  }
}
type Who = { name: string; level: Level; persona: Persona }

/** one move by whoever has one; false when the game is stuck (never, in practice) */
function step(s: GameState, brains: Brain[], rnd: () => number): GameState | null {
  for (let p = 0; p < s.players.length; p++) {
    const a = botAction(viewFor(s, p), p, rnd, brains[p])
    if (!a) continue
    const r = apply(s, p, a)
    // (a sneak can't start while another, hidden from us, is under way: that's a pass)
    if (!r.ok && a.type === 'snatch') continue
    if (!r.ok) throw new Error(`${a.type}: ${r.error}`)
    return r.state
  }
  if (s.snatch) {
    const r = apply(s, s.snatch.thief, { type: 'snatchEnd' })
    if (r.ok) return r.state
  }
  return null
}

function playOut(s: GameState, brains: Brain[], rnd: () => number, each?: (s: GameState) => void): GameState {
  for (let k = 0; k < 20000 && s.phase.kind !== 'over'; k++) {
    const n = step(s, brains, rnd)
    if (!n) break
    s = n
    each?.(s)
  }
  return s
}

const PIPS: Record<number, number> = { 2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 8: 5, 9: 4, 10: 3, 11: 2, 12: 1 }

/** a field of bots, four at a time: who wins, and what each started with */
function ladder(games: number, seed: number) {
  const field: Who[] = [
    { name: 'Easy', level: 'easy', persona: 'steady' },
    { name: 'Normal', level: 'normal', persona: 'steady' },
    { name: 'Hard', level: 'hard', persona: 'steady' },
    { name: 'Expert', level: 'expert', persona: 'steady' },
    ...BOT_CAST.filter((c) => c.persona !== 'steady').map((c) => ({ name: c.name, level: 'expert' as Level, persona: c.persona })),
  ]
  const out: { seats: number[]; winner: number; turns: number; open: { pips: number; res: string[]; seat: number }[] }[] = []
  for (let g = 0; g < games; g++) {
    const r = rng(seed * 1000 + g)
    const pick = [...field.keys()].sort(() => r() - 0.5).slice(0, 4)
    const brains = pick.map((k) => brain(field[k].level, field[k].persona))
    let s = newGame(pick.map((k, i) => ({ id: `p${i}`, name: field[k].name })), seed * 7919 + g, {})
    while (s.phase.kind === 'setup') s = step(s, brains, r)!
    // the opening: each player's two corners
    const open = pick.map((_, i) => {
      const mine = Object.entries(s.buildings).filter(([, b]) => b.owner === i).map(([v]) => Number(v))
      const res = new Set<string>()
      let pips = 0
      for (const v of mine)
        for (const h of TOPO.vertices[v].hexes) {
          const t = resourceOf(s.tiles[h])
          if (t) res.add(t)
          pips += PIPS[s.tiles[h].number ?? 0] ?? 0
        }
      return { pips, res: [...res].sort(), seat: i }
    })
    s = playOut(s, brains, r)
    out.push({ seats: pick, winner: s.phase.kind === 'over' ? s.phase.winner : -1, turns: s.turn, open })
  }
  return { field, games: out }
}

/** the showcase: four experts, every turn as it stood */
function match(seed: number) {
  const cast = ['Bramble', 'Clover', 'Wren', 'Flint'].map((n) => BOT_CAST.find((c) => c.name === n)!)
  const brains = cast.map((c) => brain('expert', c.persona))
  const r = rng(seed)
  let s = newGame(cast.map((c, i) => ({ id: `p${i}`, name: c.name })), seed, {})
  const turns: unknown[] = []
  let last = -1
  const snap = (s: GameState) => {
    if (s.turn === last) return
    last = s.turn
    const roll = [...s.events].reverse().find((e) => e.k === 'roll')
    turns.push({
      turn: s.turn,
      current: s.current,
      b: Object.entries(s.buildings).map(([v, b]) => [Number(v), b.owner, b.kind === 'city' ? 2 : 1]),
      r: Object.entries(s.roads).map(([e, o]) => [Number(e), o]),
      robber: s.robber,
      vp: s.players.map((_, i) => victoryPoints(s, i, true)),
      cards: s.players.map((p) => Object.values(p.hand).reduce((a, b) => a + b, 0)),
      road: s.longestRoad,
      army: s.largestArmy,
      dice: roll && roll.k === 'roll' ? roll.dice : null,
    })
  }
  s = playOut(s, brains, r, snap)
  snap({ ...s, turn: s.turn + 1 } as GameState)
  // the board: hex centres, corners, sides, harbours
  const hexes = TOPO.hexes.map((h, i) => ({ x: h.x, y: h.y, t: s.tiles[i].terrain, n: s.tiles[i].number }))
  return {
    names: cast.map((c) => c.name),
    personas: cast.map((c) => c.persona),
    winner: s.phase.kind === 'over' ? s.phase.winner : -1,
    hexes,
    vertices: TOPO.vertices.map((v) => [+v.x.toFixed(3), +v.y.toFixed(3)]),
    edges: TOPO.edges.map((e) => [e.a, e.b]),
    harbors: s.harbors.map((h) => ({ edge: h.edge, kind: h.kind })),
    turns,
  }
}

/** win chances at each kept turn of the showcase, by playing the rest of the game out n times with other dice */
function odds(seed: number, from: number, stepBy: number, n: number) {
  const cast = ['Bramble', 'Clover', 'Wren', 'Flint'].map((nm) => BOT_CAST.find((c) => c.name === nm)!)
  const fresh = () => cast.map((c) => brain('expert', c.persona))
  const r = rng(seed)
  let s = newGame(cast.map((c, i) => ({ id: `p${i}`, name: c.name })), seed, {})
  const brains = fresh()
  const at = new Map<number, GameState>()
  s = playOut(s, brains, r, (x) => {
    if (!at.has(x.turn)) at.set(x.turn, structuredClone(x))
  })
  const out: Record<number, number[]> = {}
  for (const [turn, st] of at) {
    if (turn < from || (turn - from) % stepBy) continue
    const wins = [0, 0, 0, 0]
    for (let k = 0; k < n; k++) {
      const c = structuredClone(st)
      c.rng = (seed * 31 + turn * 977 + k * 7907) | 0
      const end = playOut(c, fresh(), rng(turn * 1000 + k))
      if (end.phase.kind === 'over') wins[end.phase.winner]++
    }
    out[turn] = wins.map((w) => w / n)
  }
  return out
}


/** what a player's corners make, in pips per resource */
function pipsBy(s: GameState, p: number): Record<Resource, number> {
  const out = { lumber: 0, brick: 0, wool: 0, grain: 0, ore: 0 } as Record<Resource, number>
  for (const [v, b] of Object.entries(s.buildings)) {
    if (b.owner !== p) continue
    for (const h of TOPO.vertices[Number(v)].hexes) {
      const r = resourceOf(s.tiles[h])
      if (r) out[r] += (PIPS[s.tiles[h].number ?? 0] ?? 0) * (b.kind === 'city' ? 2 : 1)
    }
  }
  return out
}
const ports = (s: GameState, p: number) => {
  const r = tradeRatios(s, p)
  return { any: RESOURCES.every((x) => r[x] <= 3), two: RESOURCES.filter((x) => r[x] === 2) }
}

/** many games between Experts of every persona: one row per player, everything we might ask about */
function study(games: number, seed: number, knights: boolean) {
  const personas: Persona[] = ['steady', 'merchant', 'builder', 'warlord', 'grudge', 'magpie', 'scholar']
  const rows: Record<string, unknown>[] = []
  let failed = 0
  for (let g = 0; g < games; g++) {
    try {
      studyGame(g)
    } catch (e) {
      failed++
      console.error(`game ${g}: ${(e as Error).message}`)
    }
  }
  if (failed) console.error(`${failed} of ${games} games skipped`)
  return rows

  function studyGame(g: number) {
    const r = rng(seed * 100003 + g)
    const who = [0, 1, 2, 3].map(() => personas[Math.floor(r() * personas.length)])
    const brains = who.map((p) => brain('expert', p))
    let s = newGame(who.map((_, i) => ({ id: `p${i}`, name: `p${i}` })), seed * 7919 + g * 31, { knights })
    while (s.phase.kind === 'setup') s = step(s, brains, r)!
    const open = [0, 1, 2, 3].map((i) => {
      const corners = Object.entries(s.buildings).filter(([, b]) => b.owner === i).map(([v]) => Number(v))
      const nums = new Set<number>()
      let desertTouch = 0
      for (const v of corners) for (const h of TOPO.vertices[v].hexes) { const n = s.tiles[h].number; if (n) nums.add(n); else if (s.tiles[h].terrain === 'desert') desertTouch++ }
      const pb = pipsBy(s, i)
      const pt = ports(s, i)
      return { pb, nums: nums.size, has68: [...nums].some((n) => n === 6 || n === 8), desert: desertTouch, port3: pt.any, port2: pt.two }
    })
    // follow the game: first city, first new settlement, when each reached 5 points, robber hits, standings along the way
    const firstCity = [0, 0, 0, 0].map(() => -1), firstSettle = [0, 0, 0, 0].map(() => -1), reach5 = [0, 0, 0, 0].map(() => -1)
    const robbed = [0, 0, 0, 0], snap: Record<number, number[]> = {}
    let seen = s.eventCount
    for (let k = 0; k < 20000 && s.phase.kind !== 'over'; k++) {
      const n = step(s, brains, r)
      if (!n) break
      s = n
      for (const e of s.events) {
        if (e.n < seen) continue
        if (e.k === 'build' && !e.free) {
          if (e.what === 'city' && firstCity[e.p] < 0) firstCity[e.p] = s.turn
          if (e.what === 'settlement' && firstSettle[e.p] < 0) firstSettle[e.p] = s.turn
        }
        if (e.k === 'robber') for (const o of new Set(TOPO.hexes[e.hex].vertices.map((v) => s.buildings[v]?.owner).filter((o) => o !== undefined && o !== e.p))) robbed[o!]++
      }
      seen = s.eventCount
      for (let i = 0; i < 4; i++) if (reach5[i] < 0 && victoryPoints(s, i, false) >= 5) reach5[i] = s.turn
      for (const t of [20, 40, 60]) if (s.turn === t && !snap[t]) snap[t] = [0, 1, 2, 3].map((i) => victoryPoints(s, i, false))
    }
    if (s.phase.kind !== 'over') return
    const winner = s.phase.winner
    const st = s.stats!
    for (let i = 0; i < 4; i++) {
      const ps = st.players[i]
      const me = s.players[i]
      const end = pipsBy(s, i)
      const lead = (t: number) => (snap[t] ? (snap[t][i] === Math.max(...snap[t]) ? (snap[t].filter((v) => v === snap[t][i]).length > 1 ? 0.5 : 1) : 0) : null)
      rows.push({
        g: seed * 100000 + g, seat: i, persona: who[i], win: winner === i ? 1 : 0, vp: victoryPoints(s, i, true), turns: s.turn,
        o_pips: RESOURCES.reduce((a, x) => a + open[i].pb[x], 0), o: open[i].pb, o_nums: open[i].nums, o_68: open[i].has68 ? 1 : 0,
        o_desert: open[i].desert, o_port3: open[i].port3 ? 1 : 0, o_port2: open[i].port2,
        e: end, prod: ps.produced, dry: ps.dryRolls, best: ps.bestRoll,
        roads: ps.roads, settlements: ps.settlements, cities: ps.cities,
        trades: ps.trades, tin: ps.tradedIn, tout: ps.tradedAway, bank: ps.bankTrades, bankPaid: ps.bankPaid,
        stole: ps.stole, lost: ps.lost, discarded: ps.discarded, robber: ps.robberMoves, robbed: robbed[i],
        devBought: ps.devBought, devPlayed: ps.devPlayed, knights: me.knights,
        vpCards: me.cards.filter((c) => c.card === 'victoryPoint').length,
        road: s.longestRoad === i ? 1 : 0, army: s.largestArmy === i ? 1 : 0,
        firstCity: firstCity[i], firstSettle: firstSettle[i], reach5: reach5[i],
        lead20: lead(20), lead40: lead(40), lead60: lead(60), vp20: snap[20]?.[i] ?? null, vp40: snap[40]?.[i] ?? null,
        ...(knights ? { improvements: ps.improvements, metro: ps.metropolises, kBuilt: ps.knightsBuilt, defended: ps.defended, pillaged: ps.pillaged, progress: ps.progressPlayed, walls: ps.walls } : {}),
      })
    }
  }
}

const [cmd, ...a] = process.argv.slice(2)
const res = cmd === 'study' ? study(Number(a[0]), Number(a[1]), a[2] === 'knights') : cmd === 'ladder' ? ladder(Number(a[0]), Number(a[1])) : cmd === 'match' ? match(Number(a[0])) : odds(Number(a[0]), Number(a[1]), Number(a[2]), Number(a[3]))
process.stdout.write(JSON.stringify(res))
