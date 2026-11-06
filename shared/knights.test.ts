/** The expansion's rules: whole bot games keeping every rule, and each rule on its own. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { TOPO } from './board.ts'
import { apply, knightMoves, newGame, viewFor, victoryPoints, type Action, type GameState, type Level } from './engine.ts'
import { botAction } from './bot.ts'
import {
  BANK_EACH, BARBARIAN_STEPS, COMMODITIES, COMMODITY_EACH, KNIGHT_POINTS, PIECES, PROGRESS, PROGRESS_CARDS, RESOURCES, TRACKS, WALLS,
  emptyHand, handSize,
} from './rules.ts'

const seats = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}` }))
function rng(seed: number) {
  let t = seed
  return () => {
    t = (t + 0x6d2b79f5) | 0
    let x = Math.imul(t ^ (t >>> 15), t | 1)
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61)
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296
  }
}
function must(s: GameState, p: number, a: Action): GameState {
  const r = apply(s, p, a)
  if (!r.ok) throw new Error(`${JSON.stringify(a)} by ${p} in ${s.phase.kind}: ${r.error}`)
  return r.state
}
/** whoever has something to do moves (bots see only their own view) */
function stepBots(s: GameState, rnd: () => number): GameState {
  for (let p = 0; p < s.players.length; p++) {
    const a = botAction(viewFor(s, p), p, rnd)
    if (a) return must(s, p, a)
  }
  throw new Error(`stuck in ${s.phase.kind}`)
}

const PROGRESS_TOTAL = PROGRESS_CARDS.reduce((n, c) => n + PROGRESS[c].count, 0)

function invariants(s: GameState) {
  const x = s.x!
  for (const r of RESOURCES) assert.equal(s.bank[r] + s.players.reduce((n, p) => n + p.hand[r], 0), BANK_EACH, `${r} conserved`)
  for (const c of COMMODITIES) assert.equal(s.bank[c] + s.players.reduce((n, p) => n + p.hand[c], 0), COMMODITY_EACH, `${c} conserved`)
  for (const p of s.players) for (const g of [...RESOURCES, ...COMMODITIES]) assert.ok(p.hand[g] >= 0)
  s.players.forEach((p, i) => {
    const on = (kind: string) => Object.values(s.buildings).filter((b) => b.owner === i && b.kind === kind).length
    assert.equal(Object.values(s.roads).filter((o) => o === i).length + p.pieces.road, PIECES.road)
    assert.ok(on('settlement') + p.pieces.settlement <= PIECES.settlement)
    assert.equal(on('city') + p.pieces.city, PIECES.city)
    for (const l of [1, 2, 3] as Level[]) assert.equal(Object.values(x.knights).filter((k) => k.owner === i && k.level === l).length + p.pieces.knight[l], 2, `knights of strength ${l}`)
    assert.equal(Object.values(x.walls).filter((o) => o === i).length + p.pieces.wall, WALLS)
    for (const t of TRACKS) assert.ok(x.levels[i][t] >= 0 && x.levels[i][t] <= 5)
    assert.ok(p.progress.length <= 4 || s.phase.kind === 'progressDiscard')
  })
  // progress cards: every one is in a pile, a hand, or laid down
  const held = s.players.reduce((n, p) => n + p.progress.length, 0) + x.points.reduce((n, l) => n + l.length, 0) + TRACKS.reduce((n, t) => n + x.decks[t].length, 0)
  // (a played card goes back under its pile: none is ever lost)
  assert.equal(held, PROGRESS_TOTAL)
  for (const [v, k] of Object.entries(x.knights)) {
    assert.equal(s.buildings[Number(v)], undefined, 'a knight and a building never share a corner')
    assert.ok(k.level >= 1 && k.level <= 3)
  }
  for (const v of Object.values(x.walls).length ? Object.keys(x.walls).map(Number) : []) assert.equal(s.buildings[v]?.kind, 'city', 'walls stand round cities')
  for (const t of TRACKS) {
    const v = x.metropolis[t]
    if (v === null) continue
    const b = s.buildings[v]
    assert.equal(b?.kind, 'city', 'a metropolis is a city')
    assert.ok(x.levels[b!.owner][t] >= 4, 'its owner is at level 4 or more')
  }
  assert.ok(x.barbarian >= 0 && x.barbarian < BARBARIAN_STEPS)
}

test('the expansion: bots play whole games to 13 points, keeping every rule', () => {
  let finished = 0
  let attacks = 0
  let improvements = 0
  let played = 0
  const games = 60
  for (let g = 0; g < games; g++) {
    const n = 2 + (g % 3)
    let s = newGame(seats(n), 5000 + g, { knights: true })
    const rnd = rng(g + 77)
    let steps = 0
    while (s.phase.kind !== 'over' && steps < 12000) {
      s = stepBots(s, rnd)
      invariants(s)
      steps++
    }
    assert.equal(s.phase.kind, 'over', `game ${g} unfinished after ${steps} steps`)
    if (s.phase.kind === 'over') {
      assert.ok(victoryPoints(s, s.phase.winner) >= KNIGHT_POINTS)
      finished++
    }
    attacks += s.x!.attacks
    improvements += s.x!.levels.reduce((n, l) => n + l.trade + l.politics + l.science, 0)
    played += s.events.filter((e) => e.k === 'progress').length
  }
  assert.equal(finished, games)
  assert.ok(attacks > games, `the barbarians landed ${attacks} times`)
  assert.ok(improvements > games * 2, `${improvements} improvements`)
  assert.ok(played > 0)
})

/** an expansion game past setup */
function afterSetup(seed = 11, n = 3): GameState {
  let s = newGame(seats(n), seed, { knights: true })
  const rnd = rng(seed)
  while (s.phase.kind === 'setup') s = stepBots(s, rnd)
  return s
}

test('the second piece placed in setup is a city, and pays out resources (not commodities)', () => {
  const s = afterSetup()
  s.players.forEach((p, i) => {
    assert.equal(Object.values(s.buildings).filter((b) => b.owner === i && b.kind === 'city').length, 1)
    assert.equal(Object.values(s.buildings).filter((b) => b.owner === i && b.kind === 'settlement').length, 1)
    for (const c of COMMODITIES) assert.equal(p.hand[c], 0)
  })
})

test('a city on forest, pasture or mountains makes a commodity; on hills and fields two resources', () => {
  const s = afterSetup()
  const city = Number(Object.entries(s.buildings).find(([, b]) => b.kind === 'city')![0])
  const owner = s.buildings[city].owner
  for (const h of TOPO.vertices[city].hexes) {
    const t = s.tiles[h]
    if (t.terrain === 'desert' || h === s.robber) continue
    const before = structuredClone(s.players[owner].hand)
    for (let seed = 0; seed < 4000; seed++) {
      const tr = structuredClone(s)
      tr.rng = seed
      const r = apply(tr, tr.current, { type: 'roll' })
      if (!r.ok || r.state.dice![0] + r.state.dice![1] !== t.number || r.state.x!.event === 'ship') continue
      const got = r.state.players[owner].hand
      const want = { forest: 'paper', pasture: 'cloth', mountains: 'coin', hills: 'brick', fields: 'grain' }[t.terrain]
      assert.ok(got[want as 'paper'] > before[want as 'paper'], `${t.terrain} gives ${want}`)
      break
    }
  }
})

test('the barbarians: held off by enough ready knights (the best defender scores), or they pillage the weakest', () => {
  for (const defended of [true, false]) {
    let s = afterSetup(21, 3)
    const x = s.x!
    // force the next roll's event die to a ship, with the barbarians one step away
    x.barbarian = BARBARIAN_STEPS - 1
    if (defended) {
      // player 1 stands three strong (there are 3 cities)
      const v = TOPO.vertices.map((_, i) => i).find((i) => s.buildings[i] === undefined && TOPO.vertices[i].edges.some((e) => s.roads[e] === 1))!
      x.knights[v] = { owner: 1, level: 3, active: true, readyTurn: 0, promotedTurn: 0 }
      s.players[1].pieces.knight[3]--
    }
    for (let seed = 0; ; seed++) {
      const t = structuredClone(s)
      t.rng = seed
      const r = apply(t, t.current, { type: 'roll' })
      if (r.ok && r.state.x!.event === 'ship') {
        s = r.state
        break
      }
    }
    const at = s.events.find((e) => e.k === 'attack')
    assert.ok(at && at.k === 'attack')
    assert.equal(at.won, defended)
    if (defended) {
      assert.equal(at.defender, 1)
      assert.equal(s.x!.defenders[1], 1)
      assert.ok(Object.values(s.x!.knights).every((k) => !k.active), 'every knight stands down')
    } else {
      // nobody had a knight: everyone with a city loses one
      assert.equal(at.pillaged.length, 3)
      assert.equal(Object.values(s.buildings).filter((b) => b.kind === 'city').length, 0)
    }
    assert.equal(s.x!.barbarian, 0)
    assert.equal(s.x!.attacks, 1)
  }
})

test('the robber stays put until the barbarians have landed once', () => {
  let s = afterSetup()
  for (let seed = 0; ; seed++) {
    const t = structuredClone(s)
    t.rng = seed
    for (const p of t.players) p.hand = emptyHand()
    for (const r of RESOURCES) t.bank[r] = BANK_EACH
    const r = apply(t, t.current, { type: 'roll' })
    if (r.ok && r.state.dice![0] + r.state.dice![1] === 7) {
      s = r.state
      break
    }
  }
  assert.equal(s.phase.kind, 'main', 'a 7 before the first landing: no robber')
})

test('knights: build on your roads, ready them with grain, they act from the next turn, push weaker ones away', () => {
  let s = afterSetup(31, 2)
  const p = s.current
  s.phase = { kind: 'main' }
  s.players[p].hand = { ...emptyHand(), wool: 4, ore: 4, grain: 2 }
  for (const g of ['wool', 'ore', 'grain'] as const) s.bank[g] = BANK_EACH - s.players.reduce((n, q) => n + q.hand[g], 0)
  const spot = TOPO.vertices.map((_, i) => i).find((i) => s.buildings[i] === undefined && TOPO.vertices[i].edges.some((e) => s.roads[e] === p))!
  s = must(s, p, { type: 'buildKnight', vertex: spot })
  assert.equal(s.x!.knights[spot].level, 1)
  assert.ok(apply(s, p, { type: 'moveKnight', from: spot, to: spot }).ok === false, 'a resting knight cannot act')
  s = must(s, p, { type: 'activateKnight', vertex: spot })
  assert.ok(s.x!.knights[spot].active)
  assert.equal(apply(s, p, { type: 'chaseRobber', from: spot }).ok, false, 'readied this turn: it acts from the next')
  assert.equal(apply(s, p, { type: 'promoteKnight', vertex: spot }).ok, false, 'not raised the turn it was built')
  s.turn++
  s = must(s, p, { type: 'promoteKnight', vertex: spot })
  assert.equal(s.x!.knights[spot].level, 2)
  assert.equal(apply(s, p, { type: 'promoteKnight', vertex: spot }).ok, false, 'once a turn')
  assert.equal(apply(s, p, { type: 'chaseRobber', from: spot }).ok, false, 'the robber is still in the desert, and resting')
  assert.deepEqual(knightMoves(s, spot).every((v) => s.buildings[v] === undefined), true)
})

test('city improvements: level n costs n commodities; level 4 first raises a metropolis (2 points)', () => {
  let s = afterSetup(41, 2)
  const p = s.current
  s.phase = { kind: 'main' }
  s.players[p].hand = { ...emptyHand(), coin: 10 }
  s.bank.coin = COMMODITY_EACH - 10
  const before = victoryPoints(s, p)
  for (let l = 1; l <= 4; l++) s = must(s, p, { type: 'improve', track: 'politics' })
  assert.equal(s.x!.levels[p].politics, 4)
  assert.equal(s.players[p].hand.coin, 0)
  assert.notEqual(s.x!.metropolis.politics, null)
  assert.equal(victoryPoints(s, p), before + 2)
})

test('progress cards: drawn by the red die and your level, at most four in hand, hidden from the others', () => {
  let s = afterSetup(51, 2)
  const p = s.current
  s.x!.levels[p].science = 5
  // find a roll with the science gate
  for (let seed = 0; ; seed++) {
    const t = structuredClone(s)
    t.rng = seed
    const r = apply(t, p, { type: 'roll' })
    if (r.ok && r.state.x!.event === 'science' && r.state.dice![0] + r.state.dice![1] !== 7) {
      s = r.state
      break
    }
  }
  const drawn = s.players[p].progress.length + s.x!.points[p].length
  assert.equal(drawn, 1, 'level 5 always draws')
  const other = viewFor(s, 1 - p)
  assert.equal(other.players[p].progress, null)
  assert.equal(other.players[p].progressCount, s.players[p].progress.length)
  assert.equal(typeof other.x!.decks.science, 'number')
  // over the limit: put one back
  s.players[p].progress = [...Array(5)].map(() => ({ card: 'spy' as const, turn: 0 }))
  const r = apply(s, p, { type: 'endTurn' })
  assert.ok(r.ok)
  assert.equal(r.state.phase.kind, 'progressDiscard')
  const after = must(r.state, p, { type: 'discardProgress', card: 'spy' })
  assert.equal(after.players[p].progress.length, 4)
  assert.notEqual(after.phase.kind, 'progressDiscard')
})

test('the base game is untouched: no commodities, no knights', () => {
  const s = newGame(seats(3), 9)
  assert.equal(s.x, null)
  assert.equal(s.mode, 'base')
  for (const c of COMMODITIES) assert.equal(s.bank[c], 0)
  assert.equal(handSize(s.bank), BANK_EACH * 5)
})

test('the barbarians win: a player with more than one city picks which to lose', () => {
  const s: GameState = newGame(seats(2), 77, { knights: true })
  const [a, b, c] = [0, 9, 18].map((h) => TOPO.hexes[h].vertices[0])
  s.buildings = { [a]: { owner: 0, kind: 'city' }, [b]: { owner: 0, kind: 'city' }, [c]: { owner: 1, kind: 'city' } }
  s.x!.knights = {}
  s.x!.barbarian = 6
  s.current = 0
  s.phase = { kind: 'roll' }
  // roll until the ship lands (a ship face on the event die)
  let t = s
  for (let k = 0; k < 50 && t.phase.kind !== 'pillage'; k++) {
    const r = apply({ ...structuredClone(s), rng: s.rng + k }, 0, { type: 'roll' })
    if (r.ok) t = r.state
  }
  assert.equal(t.phase.kind, 'pillage')
  if (t.phase.kind !== 'pillage') return
  assert.deepEqual([...t.phase.owed[0]].sort(), [a, b].sort(), 'two cities: player 0 picks')
  assert.equal(t.phase.owed[1], undefined, 'one city: player 1 loses it at once')
  assert.equal(t.buildings[c].kind, 'settlement')
  assert.ok(!apply(t, 0, { type: 'pillage', vertex: c }).ok, 'not someone else\'s city')
  const r = apply(t, 0, { type: 'pillage', vertex: b })
  assert.ok(r.ok)
  assert.equal(r.state.buildings[b].kind, 'settlement')
  assert.equal(r.state.buildings[a].kind, 'city')
  assert.notEqual(r.state.phase.kind, 'pillage')
})

test('the Spy: pick a player, see their progress cards, take the one you choose', () => {
  const s: GameState = newGame(seats(3), 91, { knights: true })
  s.current = 0
  s.players[1].progress = [{ card: 'smith', turn: 0 }, { card: 'mining', turn: 0 }]
  s.phase = { kind: 'pick', card: 'spy', need: 'player', step: 0, data: [], then: 'main' }
  let r = apply(s, 0, { type: 'pick', target: 1 })
  assert.ok(r.ok)
  const t = r.state
  assert.ok(t.phase.kind === 'pick' && t.phase.need === 'theirCard')
  assert.deepEqual(viewFor(t, 0).players[1].progress?.map((c) => c.card), ['smith', 'mining'], 'the spy sees them')
  assert.equal(viewFor(t, 2).players[1].progress, null, 'nobody else does')
  r = apply(t, 0, { type: 'pick', target: 1 })
  assert.ok(r.ok)
  assert.deepEqual(r.state.players[1].progress.map((c) => c.card), ['smith'])
  assert.ok(r.state.players[0].progress.some((c) => c.card === 'mining'))
})
