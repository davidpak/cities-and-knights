import { test } from 'node:test'
import assert from 'node:assert/strict'
import { TOPO, edgeBetween } from './board.ts'
import { apply, longestRun, newGame, viewFor, victoryPoints, type Action, type GameState } from './engine.ts'
import { botAction } from './bot.ts'
import { BANK_EACH, PIECES, RESOURCES, emptyHand, handSize } from './rules.ts'

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
  if (!r.ok) throw new Error(`${JSON.stringify(a)} by ${p}: ${r.error}`)
  return r.state
}

test('the layout: 19 hexes, 54 corners, 72 sides, 30 coast sides, 9 harbours', () => {
  assert.equal(TOPO.hexes.length, 19)
  assert.equal(TOPO.vertices.length, 54)
  assert.equal(TOPO.edges.length, 72)
  assert.equal(TOPO.coast.length, 30)
  assert.equal(TOPO.harbors.length, 9)
  for (const v of TOPO.vertices) {
    assert.ok(v.neighbors.length === 2 || v.neighbors.length === 3)
    for (const n of v.neighbors) assert.ok(TOPO.vertices[n].neighbors.length && edgeBetween(v === TOPO.vertices[0] ? 0 : TOPO.vertices.indexOf(v), n) !== undefined)
  }
  for (const h of TOPO.hexes) {
    assert.equal(new Set(h.vertices).size, 6)
    assert.equal(new Set(h.edges).size, 6)
  }
  const rows = [3, 4, 5, 4, 3]
  rows.forEach((n, r) => assert.equal(TOPO.hexes.filter((h) => h.r === r - 2).length, n))
  // harbours never share a corner, so one settlement never sits on two
  const corners = TOPO.harbors.flatMap((e) => [TOPO.edges[e].a, TOPO.edges[e].b])
  assert.equal(new Set(corners).size, 18)
})

test('a new board deals the right tiles and keeps 6 and 8 apart', () => {
  for (let seed = 1; seed < 60; seed++) {
    const s = newGame(seats(3), seed)
    assert.equal(s.tiles.filter((t) => t.terrain === 'desert').length, 1)
    assert.equal(s.tiles[s.robber].terrain, 'desert')
    const red = (i: number) => s.tiles[i].number === 6 || s.tiles[i].number === 8
    TOPO.hexes.forEach((h, i) => {
      if (red(i)) for (const n of h.neighbors) assert.ok(!red(n), `seed ${seed}`)
    })
    assert.equal(s.pile.length, 25)
  }
})

function invariants(s: GameState) {
  for (const r of RESOURCES) {
    const total = s.bank[r] + s.players.reduce((n, p) => n + p.hand[r], 0)
    assert.equal(total, BANK_EACH, `${r} conserved`)
    assert.ok(s.bank[r] >= 0)
    for (const p of s.players) assert.ok(p.hand[r] >= 0)
  }
  s.players.forEach((p, i) => {
    const roads = Object.values(s.roads).filter((o) => o === i).length
    const sets = Object.values(s.buildings).filter((b) => b.owner === i && b.kind === 'settlement').length
    const cities = Object.values(s.buildings).filter((b) => b.owner === i && b.kind === 'city').length
    assert.equal(roads + p.pieces.road, PIECES.road)
    assert.equal(sets + p.pieces.settlement, PIECES.settlement)
    assert.equal(cities + p.pieces.city, PIECES.city)
  })
  for (const v of Object.keys(s.buildings).map(Number)) {
    for (const n of TOPO.vertices[v].neighbors) assert.equal(s.buildings[n], undefined, 'distance rule')
  }
  // every road joins its owner's network
  for (const [e, o] of Object.entries(s.roads)) {
    const ed = TOPO.edges[Number(e)]
    const ok = [ed.a, ed.b].some(
      (v) => s.buildings[v]?.owner === o || TOPO.vertices[v].edges.some((x) => x !== Number(e) && s.roads[x] === o),
    )
    assert.ok(ok, 'road connected')
  }
}

test('bots play whole games to a winner, keeping every rule', () => {
  let finished = 0
  for (let g = 0; g < 120; g++) {
    const n = 2 + (g % 3)
    let s = newGame(seats(n), 1000 + g)
    const rnd = rng(g)
    let steps = 0
    while (s.phase.kind !== 'over' && steps < 6000) {
      // whoever has something to do (discards first) moves; bots only see their own view
      let moved = false
      for (let p = 0; p < n && !moved; p++) {
        const a = botAction(viewFor(s, p), p, rnd)
        if (!a) continue
        s = must(s, p, a)
        moved = true
      }
      assert.ok(moved, `stuck in ${s.phase.kind}`)
      invariants(s)
      steps++
    }
    assert.equal(s.phase.kind, 'over', `game ${g} ended in ${steps}`)
    if (s.phase.kind === 'over') {
      assert.ok(victoryPoints(s, s.phase.winner) >= 10)
      finished++
    }
  }
  assert.equal(finished, 120)
})

test('views hide other hands, cards and the seed', () => {
  const s = newGame(seats(3), 7)
  s.players[1].hand.ore = 3
  s.players[1].cards.push({ card: 'victoryPoint', turn: 0 })
  const v = viewFor(s, 0) as unknown as Record<string, unknown> & ReturnType<typeof viewFor>
  assert.equal(v.rng, undefined)
  assert.equal(v.pile, 25)
  assert.equal(v.players[1].hand, null)
  assert.equal(v.players[1].handCount, 3)
  assert.equal(v.players[1].cards, null)
  assert.equal(v.players[1].points, 0, 'a hidden point stays hidden')
  assert.deepEqual(viewFor(s, 1).players[1].hand, s.players[1].hand)
})

/** a game past setup with two settlements each, for the rule tests below */
function afterSetup(seed = 3, n = 3): GameState {
  let s = newGame(seats(n), seed)
  const rnd = rng(seed)
  while (s.phase.kind === 'setup') s = must(s, s.current, botAction(s, s.current, rnd)!)
  return s
}

test('setup snakes forward then back, and the second settlement pays', () => {
  let s = newGame(seats(3), 11)
  const order: number[] = []
  const rnd = rng(1)
  while (s.phase.kind === 'setup') {
    if (s.phase.step === 'settlement') order.push(s.current)
    s = must(s, s.current, botAction(s, s.current, rnd)!)
  }
  assert.deepEqual(order, [0, 1, 2, 2, 1, 0])
  assert.equal(s.phase.kind, 'roll')
  assert.equal(s.current, 0)
  assert.ok(s.players.every((p) => handSize(p.hand) >= 1))
})

test('turn order is enforced, and you must roll before building or ending', () => {
  const s = afterSetup()
  assert.equal(apply(s, 1, { type: 'roll' }).ok, false)
  assert.equal(apply(s, 0, { type: 'endTurn' }).ok, false)
  const r = apply(s, 0, { type: 'roll' })
  assert.ok(r.ok)
  if (r.ok && r.state.phase.kind === 'main') assert.equal(apply(r.state, 0, { type: 'roll' }).ok, false)
})

test('a 7 makes big hands discard half, then the robber moves and steals', () => {
  let s = afterSetup()
  // force a 7: find an rng that rolls 7
  for (let seed = 0; ; seed++) {
    const t = structuredClone(s)
    t.rng = seed
    const r = apply(t, 0, { type: 'roll' })
    if (r.ok && r.state.dice![0] + r.state.dice![1] === 7) {
      s = t
      break
    }
  }
  s.players[1].hand = { lumber: 3, brick: 3, wool: 3, grain: 0, ore: 0 }
  s.bank = { ...s.bank }
  // keep the totals honest for the invariants
  const fix = () => {
    for (const r of RESOURCES) s.bank[r] = BANK_EACH - s.players.reduce((n, p) => n + p.hand[r], 0)
  }
  fix()
  s = must(s, 0, { type: 'roll' })
  assert.equal(s.phase.kind, 'discard')
  if (s.phase.kind !== 'discard') return
  assert.equal(s.phase.owed[1], 4)
  assert.equal(apply(s, 1, { type: 'discard', cards: { ...emptyHand(), lumber: 3 } }).ok, false, 'must be exactly 4')
  assert.equal(apply(s, 0, { type: 'moveRobber', hex: 0 }).ok, false, 'robber waits for discards')
  s = must(s, 1, { type: 'discard', cards: { ...emptyHand(), lumber: 2, brick: 2 } })
  assert.equal(handSize(s.players[1].hand), 5)
  assert.equal(s.phase.kind, 'robber')
  assert.equal(apply(s, 0, { type: 'moveRobber', hex: s.robber }).ok, false, 'must move it')
  const target = TOPO.hexes.findIndex((h, i) => i !== s.robber && h.vertices.some((v) => s.buildings[v]?.owner === 1))
  const before = handSize(s.players[0].hand)
  s = must(s, 0, { type: 'moveRobber', hex: target })
  if (s.phase.kind === 'steal') s = must(s, 0, { type: 'steal', victim: 1 })
  assert.equal(s.phase.kind, 'main')
  assert.equal(handSize(s.players[0].hand), before + 1)
  invariants(s)
})

test('building costs, needs a road, and keeps the distance rule', () => {
  let s = afterSetup()
  s = must(s, 0, { type: 'roll' })
  while (s.phase.kind !== 'main') s = must(s, s.phase.kind === 'discard' ? Number(Object.keys(s.phase.owed)[0]) : 0, botAction(s, s.phase.kind === 'discard' ? Number(Object.keys(s.phase.owed)[0]) : 0, rng(2))!)
  const give = (h: Partial<Record<(typeof RESOURCES)[number], number>>) => {
    for (const r of RESOURCES) {
      const want = h[r] ?? 0
      s.bank[r] += s.players[0].hand[r] - want
      s.players[0].hand[r] = want
    }
  }
  give({})
  const mine = Object.entries(s.roads).find(([, o]) => o === 0)!
  const ed = TOPO.edges[Number(mine[0])]
  const end = s.buildings[ed.a]?.owner === 0 ? ed.b : ed.a
  const next = TOPO.vertices[end].edges.find((e) => s.roads[e] === undefined)!
  assert.equal(apply(s, 0, { type: 'buildRoad', edge: next }).ok, false, 'no cards, no road')
  give({ lumber: 1, brick: 1 })
  s = must(s, 0, { type: 'buildRoad', edge: next })
  assert.equal(s.players[0].hand.lumber, 0)
  const far = TOPO.edges.findIndex((e, i) => s.roads[i] === undefined && ![e.a, e.b].some((v) => TOPO.vertices[v].edges.some((x) => s.roads[x] === 0) || s.buildings[v]?.owner === 0))
  give({ lumber: 1, brick: 1 })
  assert.equal(apply(s, 0, { type: 'buildRoad', edge: far }).ok, false, 'roads must connect')
  give({ lumber: 1, brick: 1, wool: 1, grain: 1 })
  assert.equal(apply(s, 0, { type: 'buildSettlement', vertex: end }).ok, false, 'too close to the first settlement')
  invariants(s)
})

test('cities upgrade your own settlements only', () => {
  let s = afterSetup()
  s = must(s, 0, { type: 'roll' })
  while (s.phase.kind !== 'main') {
    const p = s.phase.kind === 'discard' ? Number(Object.keys(s.phase.owed)[0]) : 0
    s = must(s, p, botAction(s, p, rng(3))!)
  }
  for (const r of RESOURCES) {
    s.bank[r] += s.players[0].hand[r]
    s.players[0].hand[r] = 0
  }
  s.players[0].hand.grain = 2
  s.players[0].hand.ore = 3
  s.bank.grain -= 2
  s.bank.ore -= 3
  const theirs = Number(Object.entries(s.buildings).find(([, b]) => b.owner === 1)![0])
  const mine = Number(Object.entries(s.buildings).find(([, b]) => b.owner === 0)![0])
  assert.equal(apply(s, 0, { type: 'buildCity', vertex: theirs }).ok, false)
  const before = victoryPoints(s, 0)
  s = must(s, 0, { type: 'buildCity', vertex: mine })
  assert.equal(victoryPoints(s, 0), before + 1)
  invariants(s)
})

test('longest road needs five, and an opponent settlement cuts it', () => {
  const s = newGame(seats(2), 5)
  // a straight-ish run of six roads along the top coast for player 0
  const path: number[] = []
  let v = TOPO.edges[TOPO.coast[0]].a
  const seen = new Set<number>([v])
  for (let i = 0; i < 6; i++) {
    const e = TOPO.vertices[v].edges.find((x) => TOPO.edges[x].hexes.length === 1 && !path.includes(x))!
    path.push(e)
    const ed = TOPO.edges[e]
    v = ed.a === v ? ed.b : ed.a
    seen.add(v)
  }
  for (const e of path) s.roads[e] = 0
  assert.equal(longestRun(s, 0), 6)
  // an opponent settlement on the third corner of the run splits it into 2 and 4
  const corners = [...seen]
  s.buildings[corners[2]] = { owner: 1, kind: 'settlement' }
  assert.equal(longestRun(s, 0), 4)
})

test('player trades: offer, decline, accept', () => {
  let s = afterSetup()
  s = must(s, 0, { type: 'roll' })
  while (s.phase.kind !== 'main') {
    const p = s.phase.kind === 'discard' ? Number(Object.keys(s.phase.owed)[0]) : 0
    s = must(s, p, botAction(s, p, rng(4))!)
  }
  const set = (p: number, h: Partial<Record<(typeof RESOURCES)[number], number>>) => {
    for (const r of RESOURCES) {
      s.bank[r] += s.players[p].hand[r] - (h[r] ?? 0)
      s.players[p].hand[r] = h[r] ?? 0
    }
  }
  set(0, { wool: 2 })
  set(1, { ore: 1 })
  set(2, {})
  const give = { ...emptyHand(), wool: 2 }
  const get = { ...emptyHand(), ore: 1 }
  assert.equal(apply(s, 0, { type: 'offerTrade', give: { ...emptyHand(), wool: 3 }, get }).ok, false, 'cannot offer what you lack')
  s = must(s, 0, { type: 'offerTrade', give, get })
  assert.equal(apply(s, 2, { type: 'acceptOffer' }).ok, false, 'player 2 has no ore')
  s = must(s, 2, { type: 'declineOffer' })
  s = must(s, 1, { type: 'acceptOffer' })
  assert.equal(s.players[0].hand.ore, 0, 'nothing moves until the offerer picks a partner')
  assert.deepEqual(s.offer?.accepted, [1])
  assert.equal(apply(s, 0, { type: 'confirmTrade', with: 2 }).ok, false, 'player 2 said no')
  assert.equal(apply(s, 1, { type: 'confirmTrade', with: 1 }).ok, false, 'only the offerer confirms')
  s = must(s, 0, { type: 'confirmTrade', with: 1 })
  assert.equal(s.players[0].hand.ore, 1)
  assert.equal(s.players[1].hand.wool, 2)
  assert.equal(s.offer, null)
  const last = s.events[s.events.length - 1]
  assert.deepEqual(last.k === 'trade' && [last.from, last.to, last.give.wool, last.get.ore], [0, 1, 2, 1], 'the trade is told: who, with whom, what for what')
  invariants(s)
})

test('a trade offered to one player: only they answer, and yes trades at once', () => {
  let s = afterSetup()
  s = must(s, 0, { type: 'roll' })
  while (s.phase.kind !== 'main') {
    const p = s.phase.kind === 'discard' ? Number(Object.keys(s.phase.owed)[0]) : 0
    s = must(s, p, botAction(s, p, rng(8))!)
  }
  const set = (p: number, h: Partial<Record<(typeof RESOURCES)[number], number>>) => {
    for (const r of RESOURCES) {
      s.bank[r] += s.players[p].hand[r] - (h[r] ?? 0)
      s.players[p].hand[r] = h[r] ?? 0
    }
  }
  set(0, { grain: 2 })
  set(1, { ore: 1 })
  set(2, { ore: 3 })
  const give = { ...emptyHand(), grain: 2 }
  const get = { ...emptyHand(), ore: 1 }
  assert.equal(apply(s, 0, { type: 'offerTrade', give, get, to: 0 }).ok, false, 'not to yourself')
  s = must(s, 0, { type: 'offerTrade', give, get, to: 1 })
  assert.equal(apply(s, 2, { type: 'acceptOffer' }).ok, false, 'player 2 was not asked')
  const no = must(s, 1, { type: 'declineOffer' })
  assert.equal(no.offer, null, 'a no closes it')
  s = must(s, 1, { type: 'acceptOffer' })
  assert.equal(s.offer, null)
  assert.equal(s.players[0].hand.ore, 1)
  assert.equal(s.players[1].hand.grain, 2)
  const last = s.events[s.events.length - 1]
  assert.ok(last.k === 'trade' && last.from === 0 && last.to === 1)
  invariants(s)
})

test('events tell what happened, and a stolen card is private to the two players', () => {
  let s = afterSetup(21)
  const kinds = new Set(s.events.map((e) => e.k))
  assert.ok(kinds.has('build') && kinds.has('turn'))
  const rnd = rng(9)
  // play until someone steals
  for (let i = 0; i < 4000 && !s.events.some((e) => e.k === 'steal'); i++) {
    for (let p = 0; p < 3; p++) {
      const a = botAction(viewFor(s, p), p, rnd)
      if (a) {
        s = must(s, p, a)
        break
      }
    }
  }
  const st = s.events.find((e) => e.k === 'steal')
  assert.ok(st && st.k === 'steal' && st.r, 'the full state knows the card')
  if (!st || st.k !== 'steal') return
  const other = [0, 1, 2].find((i) => i !== st.thief && i !== st.victim)!
  const seen = (p: number) => viewFor(s, p).events.find((e) => e.n === st.n)
  assert.equal((seen(st.thief) as typeof st).r, st.r)
  assert.equal((seen(st.victim) as typeof st).r, st.r)
  assert.equal((seen(other) as typeof st).r, undefined)
  const rolls = s.events.filter((e) => e.k === 'roll')
  assert.ok(rolls.length > 0 && rolls.every((e) => e.k === 'roll' && e.dice[0] >= 1 && e.dice[1] <= 6))
})

test('bank trades use harbour ratios', () => {
  let s = afterSetup()
  s = must(s, 0, { type: 'roll' })
  while (s.phase.kind !== 'main') {
    const p = s.phase.kind === 'discard' ? Number(Object.keys(s.phase.owed)[0]) : 0
    s = must(s, p, botAction(s, p, rng(5))!)
  }
  for (const r of RESOURCES) {
    s.bank[r] += s.players[0].hand[r]
    s.players[0].hand[r] = 0
  }
  s.players[0].hand.brick = 4
  s.bank.brick -= 4
  // take away any harbour player 0 happens to have
  s.harbors = s.harbors.map((h) => ({ ...h, kind: 'any' as const })).filter((h) => ![TOPO.edges[h.edge].a, TOPO.edges[h.edge].b].some((v) => s.buildings[v]?.owner === 0))
  s = must(s, 0, { type: 'bankTrade', give: 'brick', get: 'ore' })
  assert.equal(s.players[0].hand.brick, 0)
  assert.equal(s.players[0].hand.ore, 1)
  invariants(s)
})

test('cards: not the turn you buy them, one per turn, knights build an army', () => {
  let s = afterSetup()
  s.players[0].cards = [
    { card: 'knight', turn: 0 },
    { card: 'knight', turn: 0 },
    { card: 'knight', turn: 0 },
    { card: 'monopoly', turn: s.turn },
  ]
  assert.equal(apply(s, 0, { type: 'playMonopoly', resource: 'ore' }).ok, false, 'not before rolling')
  s = must(s, 0, { type: 'playKnight' })
  assert.equal(s.phase.kind, 'robber')
  assert.equal(apply(s, 0, { type: 'playKnight' }).ok, false, 'one card a turn')
  for (let k = 0; k < 2; k++) {
    s = must(s, 0, { type: 'moveRobber', hex: (s.robber + 1) % 19 })
    if (s.phase.kind === 'steal') s = must(s, 0, { type: 'steal', victim: s.phase.victims[0] })
    if (s.phase.kind === 'roll') s = must(s, 0, { type: 'roll' })
    while (s.phase.kind !== 'main') {
      const p = s.phase.kind === 'discard' ? Number(Object.keys(s.phase.owed)[0]) : 0
      s = must(s, p, botAction(s, p, rng(6))!)
    }
    // pass the turn round back to player 0
    for (let i = 0; i < 3; i++) {
      s = must(s, s.current, { type: 'endTurn' })
      if (s.current === 0) break
      s = must(s, s.current, { type: 'roll' })
      while (s.phase.kind !== 'main') {
        const p = s.phase.kind === 'discard' ? Number(Object.keys(s.phase.owed)[0]) : s.current
        s = must(s, p, botAction(s, p, rng(7))!)
      }
    }
    s = must(s, 0, { type: 'playKnight' })
  }
  assert.equal(s.players[0].knights, 3)
  assert.equal(s.largestArmy, 0)
})
