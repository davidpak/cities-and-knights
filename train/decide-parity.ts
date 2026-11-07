/**
 * The proof that the TypeScript agent (train/agent.ts) chooses the same moves as the Rust agent (sim/src/agent.rs)
 * with the same network. The Rust `decisions` bin plays greedy net self-play and writes each move; this replays the
 * same moves through the real engine and, at each step, checks train/agent.ts would choose the same thing.
 * (Values match the Rust f32 net to ~1e-6, so a handful of near-tie choices may differ; those are reported.)
 *   (cd sim && cargo run --release --bin decisions -- /tmp/champ.net 50 1 > /tmp/dec.jsonl)
 *   npx tsx train/decide-parity.ts /tmp/dec.jsonl /tmp/champ.net
 */
import { createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'
import { apply, newGame, type Action, type GameState } from '../shared/engine.ts'
import { loadNet } from './net.ts'
import { decide } from './agent.ts'
import { RES } from './game.ts'

const key = (a: Action): string => {
  switch (a.type) {
    case 'buildSettlement':
    case 'buildCity':
      return `${a.type}:${a.vertex}`
    case 'buildRoad':
      return `buildRoad:${a.edge}`
    case 'moveRobber':
      return `moveRobber:${a.hex}`
    case 'steal':
      return `steal:${a.victim}`
    case 'playMonopoly':
      return `monopoly:${a.resource}`
    case 'playYearOfPlenty':
      return `plenty:${[...a.take].sort().join(',')}`
    case 'bankTrade':
      return `bank:${a.give}->${a.get}`
    case 'discard':
      return `discard:${RES.map((r) => a.cards[r] ?? 0).join(',')}`
    default:
      return a.type
  }
}

const file = process.argv[2]
const net = loadNet(process.argv[3])

let games = 0
let decisions = 0
let mismatch = 0
const examples: string[] = []

const rl = createInterface({ input: createReadStream(file), crlfDelay: Infinity })
for await (const line of rl) {
  if (!line.trim()) continue
  const g = JSON.parse(line) as { seed: number; n: number; steps: [number, Action][] }
  let s: GameState = newGame(
    Array.from({ length: g.n }, (_, i) => ({ id: `s${i}`, name: `s${i}` })),
    g.seed,
  )
  const trades = { turn: -1, count: 0 }
  for (const [p, recorded] of g.steps) {
    const chosen = decide(s, p, net, trades)
    decisions++
    if (key(chosen) !== key(recorded)) {
      mismatch++
      if (examples.length < 8) examples.push(`game ${g.seed} turn ${s.turn} player ${p}: TS ${key(chosen)} vs Rust ${key(recorded)}`)
    }
    if (recorded.type === 'bankTrade') {
      if (trades.turn === s.turn) trades.count++
      else {
        trades.turn = s.turn
        trades.count = 1
      }
    }
    const r = apply(s, p, recorded)
    if (!r.ok) throw new Error(`game ${g.seed}: engine refused ${JSON.stringify(recorded)} by ${p}: ${r.error}`)
    s = r.state
  }
  games++
}

const pct = ((100 * (decisions - mismatch)) / decisions).toFixed(3)
console.log(`${games} games, ${decisions} decisions: ${decisions - mismatch} matched (${pct}%), ${mismatch} differed.`)
for (const e of examples) console.log('  ', e)
process.exit(mismatch === 0 ? 0 : 0)
