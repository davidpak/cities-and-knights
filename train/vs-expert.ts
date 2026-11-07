/**
 * The match that matters: the champion network against today's Expert bot (shared/bot.ts, brain('expert')).
 * Four-player games, the network in one seat and Expert in the other three, the network's seat rotated over the
 * same board/dice seeds so every seat is played once. Games run across several Node processes.
 *
 *   npx tsx train/vs-expert.ts <net> [games=400] [seed=424242] [workers]
 *
 * Prints a JSON line to stdout: {"w":wins,"n":games,"share":s,"lo":lo90,"hi":hi90,"unfinished":u}. train.rs reads it.
 */
import { fork } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { availableParallelism } from 'node:os'
import { apply, newGame, viewFor, type GameState, type Action } from '../shared/engine.ts'
import { botAction, brain } from '../shared/bot.ts'
import { loadNet, type Net } from './net.ts'
import { decide } from './agent.ts'

const PLAYERS = 4

/** mulberry32, to give Expert a deterministic tie-breaker per game */
function mulberry(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), a | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const expert = brain('expert')

/** is an open trade offer waiting for player p to answer? (engine's own rule, so we decline exactly when we may) */
const offerFor = (s: GameState, p: number) =>
  s.phase.kind === 'main' && s.offers.some((o) => o.from !== p && (o.to === undefined || o.to === p) && !o.accepted.includes(p) && !o.declined.includes(p))

/** is it the network seat's move now (the current player, or the one owing a discard)? */
function netToMove(s: GameState, p: number): boolean {
  if (s.phase.kind === 'over') return false
  if (s.phase.kind === 'discard') return (s.phase.owed[p] ?? 0) > 0
  return s.current === p
}

/** the network seat's action, or null when it has nothing to do (so the poll moves on to another seat) */
function netMove(net: Net, s: GameState, p: number, trades: { turn: number; count: number }): Action | null {
  // the network doesn't trade with other players (not in the simulator); it turns offers down
  if (offerFor(s, p)) return { type: 'declineOffer' }
  if (!netToMove(s, p)) return null
  return decide(s, p, net, trades)
}

/**
 * one game: the network plays turn-position `champPos`, Expert plays the rest. Every seat is polled each step and
 * the first with something to do acts (so trade offers get answered), exactly as shared/tourney.ts drives bots.
 * Returns the winner, or -1 if it ran too long.
 */
function playGame(net: Net, seed: number, champPos: number): number {
  const seats = Array.from({ length: PLAYERS }, (_, i) => ({ id: `s${i}`, name: `s${i}` }))
  let s: GameState = newGame(seats, seed)
  const rnd = mulberry(seed * 131 + champPos * 2654435761)
  const trades = { turn: -1, count: 0 }
  for (let step = 0; step < 60000 && s.phase.kind !== 'over'; step++) {
    let moved = false
    for (let p = 0; p < PLAYERS && !moved; p++) {
      const a = p === champPos ? netMove(net, s, p, trades) : botAction(viewFor(s, p), p, rnd, expert)
      if (!a) continue
      if (a.type === 'bankTrade') {
        if (trades.turn === s.turn) trades.count++
        else {
          trades.turn = s.turn
          trades.count = 1
        }
      }
      const r = apply(s, p, a)
      if (!r.ok && a.type === 'snatch') continue
      if (!r.ok) return -1 // a refused move: give up on this game rather than skew the measurement
      s = r.state
      moved = true
    }
    if (!moved && s.snatch) {
      const r = apply(s, s.snatch.thief, { type: 'snatchEnd' })
      if (r.ok) {
        s = r.state
        moved = true
      }
    }
    if (!moved) return -1
  }
  return s.phase.kind === 'over' ? s.phase.winner : -1
}

/** play groups [start, end): each seed played PLAYERS times, the champion's seat rotated */
function playGroups(net: Net, baseSeed: number, start: number, end: number): { w: number; n: number; unfinished: number } {
  let w = 0
  let n = 0
  let unfinished = 0
  for (let k = start; k < end; k++) {
    const seed = (baseSeed + k * 7919) | 0
    for (let rot = 0; rot < PLAYERS; rot++) {
      const winner = playGame(net, seed, rot)
      n++
      if (winner === rot) w++
      else if (winner < 0) unfinished++
    }
  }
  return { w, n, unfinished }
}

/** Wilson 90% interval for a share of n games (as train.rs does) */
function interval(share: number, n: number): [number, number] {
  const z = 1.645
  const d = 1 + (z * z) / n
  const c = (share + (z * z) / (2 * n)) / d
  const h = (z * Math.sqrt((share * (1 - share)) / n + (z * z) / (4 * n * n))) / d
  return [Math.max(0, c - h), Math.min(1, c + h)]
}

const self = fileURLToPath(import.meta.url)
const workerFlag = process.argv[2] === '--worker'

if (workerFlag) {
  // worker: --worker <net> <base> <start> <end>
  const [, , , netPath, base, start, end] = process.argv
  const net = loadNet(netPath)
  const r = playGroups(net, Number(base), Number(start), Number(end))
  process.send!(r)
  process.exit(0)
} else {
  const netPath = process.argv[2]
  const games = Number(process.argv[3] ?? 400)
  const baseSeed = Number(process.argv[4] ?? 424242)
  const groups = Math.max(1, Math.floor(games / PLAYERS))
  const workers = Math.max(1, Math.min(Number(process.argv[5] ?? Math.min(availableParallelism(), 8)), groups))

  const run = async () => {
    const per = Math.ceil(groups / workers)
    const jobs: Promise<{ w: number; n: number; unfinished: number }>[] = []
    for (let i = 0; i < workers; i++) {
      const start = i * per
      const end = Math.min(groups, start + per)
      if (start >= end) break
      jobs.push(
        new Promise((resolve, reject) => {
          const child = fork(self, ['--worker', netPath, String(baseSeed), String(start), String(end)], { execArgv: ['--import', 'tsx'], stdio: ['ignore', 'inherit', 'inherit', 'ipc'] })
          child.on('message', (m) => resolve(m as { w: number; n: number; unfinished: number }))
          child.on('error', reject)
          child.on('exit', (code) => { if (code !== 0) reject(new Error(`worker exited ${code}`)) })
        }),
      )
    }
    const parts = await Promise.all(jobs)
    const w = parts.reduce((a, b) => a + b.w, 0)
    const n = parts.reduce((a, b) => a + b.n, 0)
    const unfinished = parts.reduce((a, b) => a + b.unfinished, 0)
    const share = w / n
    const [lo, hi] = interval(share, n)
    process.stderr.write(`champion vs Expert: ${w}/${n} = ${(share * 100).toFixed(1)}% (90%: ${(lo * 100).toFixed(1)}–${(hi * 100).toFixed(1)}), ${unfinished} unfinished\n`)
    process.stdout.write(JSON.stringify({ w, n, share, lo, hi, unfinished }) + '\n')
  }
  run().catch((e) => {
    process.stderr.write(`vs-expert failed: ${e}\n`)
    process.exit(1)
  })
}
