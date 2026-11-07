/**
 * The proof that the Rust simulator plays our game: replays its games move by move through the real engine
 * (shared/engine.ts), comparing a fingerprint of the whole state after every move, and checks that every random
 * move the simulator allowed or refused, the engine allows or refuses too.
 *   (cd sim && cargo run --release --bin parity -- 2000 1 > /tmp/trace.jsonl) && npx tsx sim/parity.ts /tmp/trace.jsonl
 */
import { createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'
import { apply, newGame, type Action, type GameState } from '../shared/engine.ts'
import { COMMODITIES, RESOURCES } from '../shared/rules.ts'

const TERRAINS = ['forest', 'pasture', 'fields', 'hills', 'mountains', 'desert']
const CARDS = ['knight', 'victoryPoint', 'roadBuilding', 'yearOfPlenty', 'monopoly']
const kindIdx = (k: string) => (k === 'any' ? 5 : RESOURCES.indexOf(k as never))
const list = (xs: number[]) => `[${xs.join(', ')}]`

/** the whole state, written exactly as Game::canonical writes it */
export function canonical(s: GameState): string {
  for (const c of COMMODITIES) if (s.bank[c] || s.players.some((p) => p.hand[c])) throw new Error('commodities in a base game')
  const ph = s.phase
  const then = (t: string) => (t === 'roll' ? 'r' : 'm')
  let phase: string
  switch (ph.kind) {
    case 'setup': phase = `S${ph.round}${ph.step === 'road' ? 'r' : 's'}${ph.settlement ?? -1}`; break
    case 'roll': phase = 'R'; break
    case 'main': phase = 'M'; break
    case 'discard': phase = 'D' + s.players.map((_, i) => (ph.owed[i] ? `${i}=${ph.owed[i]},` : '')).join(''); break
    case 'robber': phase = `B${then(ph.then)}`; break
    case 'steal': phase = `T${ph.hex}${then(ph.then)}` + ph.victims.map((v) => `${v}:${list((ph.fans[v] ?? []).map((g) => RESOURCES.indexOf(g as never)))},`).join(''); break
    case 'roadBuilding': phase = `L${ph.left}`; break
    case 'over': phase = `O${ph.winner}`; break
    default: throw new Error(`phase ${ph.kind} is not in the base game`)
  }
  const parts = [
    `${s.rng}`,
    s.tiles.map((t) => `${TERRAINS.indexOf(t.terrain)}:${t.number ?? 0},`).join(''),
    s.harbors.map((h) => `${h.edge}:${kindIdx(h.kind)},`).join(''),
    list(RESOURCES.map((r) => s.bank[r])),
    `${s.robber}`, `${s.current}`, `${s.turn}`, phase,
    `${s.cardPlayed ? 1 : 0}`, `${s.longestRoad ?? -1}`, `${s.largestArmy ?? -1}`,
    s.dice ? `${s.dice[0]},${s.dice[1]}` : '-',
    list(s.pile.map((c) => CARDS.indexOf(c))),
  ]
  let out = parts.join(';') + ';'
  for (const p of s.players) out += `${list(RESOURCES.map((r) => p.hand[r]))}|${p.cards.map((c) => `${CARDS.indexOf(c.card)}@${c.turn},`).join('')}|${p.knights}|${p.pieces.road},${p.pieces.settlement},${p.pieces.city};`
  for (let v = 0; v < 54; v++) if (s.buildings[v]) out += `${v}:${s.buildings[v].owner}:${s.buildings[v].kind === 'city' ? 2 : 1},`
  out += ';'
  for (let e = 0; e < 72; e++) if (s.roads[e] !== undefined) out += `${e}:${s.roads[e]},`
  return out
}

export function fnv(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h >>> 0
}

const file = process.argv[2]
let games = 0, moves = 0, probes = 0, refused = 0, finished = 0
const t0 = Date.now()
const rl = createInterface({ input: createReadStream(file), crlfDelay: Infinity })
for await (const line of rl) {
  if (!line.trim()) continue
  const g = JSON.parse(line) as { seed: number; n: number; start: number; steps: [number, Action, number, [number, Action, boolean]][] }
  let s = newGame(Array.from({ length: g.n }, (_, i) => ({ id: `s${i}`, name: `s${i}` })), g.seed)
  if (fnv(canonical(s)) !== g.start) throw new Error(`game ${g.seed}: the starting state differs\n${canonical(s)}`)
  g.steps.forEach(([p, a, hash, [pp, probe, ok]], i) => {
    const pr = apply(s, pp, probe)
    if (pr.ok !== ok) throw new Error(`game ${g.seed} move ${i}: ${JSON.stringify(probe)} by ${pp}: simulator says ${ok ? 'allowed' : 'refused'}, engine says ${pr.ok ? 'allowed' : (pr as { error: string }).error}\n${canonical(s)}`)
    probes++
    if (!ok) refused++
    const r = apply(s, p, a)
    if (!r.ok) throw new Error(`game ${g.seed} move ${i}: the engine refused ${JSON.stringify(a)} by ${p}: ${r.error}\n${canonical(s)}`)
    s = r.state
    if (fnv(canonical(s)) !== hash) throw new Error(`game ${g.seed} move ${i}: after ${JSON.stringify(a)} by ${p} the states differ\nengine: ${canonical(s)}`)
    moves++
  })
  if (s.phase.kind === 'over') finished++
  games++
}
console.log(`${games} games, ${moves} moves: every state identical. ${probes} probes (${refused} refused, ${probes - refused} allowed): every one agreed. ${finished} games reached a winner. (${((Date.now() - t0) / 1000).toFixed(0)}s)`)
