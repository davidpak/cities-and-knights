/**
 * The proof that the TypeScript encoder (train/encode.ts) and network (train/net.ts) match the Rust side number for
 * number. The Rust `enctrace` bin writes, per position, a fingerprint of what the network sees; this replays the
 * same moves through the real engine (shared/engine.ts), encodes each position with train/encode.ts, and checks the
 * fingerprints agree. The first game carries the full quantised vector, so a mismatch points at the first feature.
 *   (cd sim && cargo run --release --bin enctrace -- 300 1 [runs/base/champion.net] > /tmp/enc.jsonl)
 *   npx tsx train/enc-parity.ts /tmp/enc.jsonl
 */
import { createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'
import { apply, newGame, type Action, type GameState } from '../shared/engine.ts'
import { gameFromState } from './game.ts'
import { encode, FEATURES, quantise } from './encode.ts'
import { loadNet, value } from './net.ts'

function fnvBytes(b: Uint8Array): number {
  let h = 0x811c9dc5
  for (let i = 0; i < b.length; i++) {
    h ^= b[i]
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h >>> 0
}

const bitsToF32 = (() => {
  const dv = new DataView(new ArrayBuffer(4))
  return (bits: number) => {
    dv.setUint32(0, bits >>> 0, true)
    return dv.getFloat32(0, true)
  }
})()

const file = process.argv[2]
const netPath = process.argv[3]
const net = netPath ? loadNet(netPath) : null

const x = new Float32Array(FEATURES)
let games = 0
let positions = 0
let qbad = 0
let rbad = 0
let valMax = 0
let firstFail = ''

const rl = createInterface({ input: createReadStream(file), crlfDelay: Infinity })
for await (const line of rl) {
  if (!line.trim()) continue
  const g = JSON.parse(line) as {
    seed: number
    n: number
    steps: [number, Action, number, number, number][]
    full?: number[][]
  }
  let s: GameState = newGame(
    Array.from({ length: g.n }, (_, i) => ({ id: `s${i}`, name: `s${i}` })),
    g.seed,
  )
  g.steps.forEach(([p, a, qhash, rhash, valBits], i) => {
    const mirror = gameFromState(s)
    encode(mirror, p, 0, x)
    const q = quantise(x)
    const qh = fnvBytes(q)
    const rh = fnvBytes(new Uint8Array(x.buffer, x.byteOffset, x.byteLength))
    if (qh !== qhash) {
      qbad++
      if (!firstFail && g.full && games === 0) {
        const want = g.full[i]
        for (let f = 0; f < FEATURES; f++) if (q[f] !== want[f]) {
          firstFail = `game ${g.seed} step ${i} (player ${p}): feature ${f} is ${q[f]} here, ${want[f]} in Rust`
          break
        }
      } else if (!firstFail) {
        firstFail = `game ${g.seed} step ${i} (player ${p}): quantised encoding hash differs`
      }
    } else if (games === 0 && g.full) {
      // belt and braces: compare the whole vector even when the hash matches
      const want = g.full[i]
      for (let f = 0; f < FEATURES; f++) if (q[f] !== want[f]) {
        qbad++
        if (!firstFail) firstFail = `game ${g.seed} step ${i}: feature ${f} is ${q[f]} here, ${want[f]} in Rust (hash collided!)`
        break
      }
    }
    if (rh !== rhash) rbad++
    if (net) {
      const tsv = value(net, x, g.n)
      const rv = bitsToF32(valBits)
      valMax = Math.max(valMax, Math.abs(tsv - rv))
    }
    positions++
    const r = apply(s, p, a)
    if (!r.ok) throw new Error(`game ${g.seed} step ${i}: the engine refused ${JSON.stringify(a)} by ${p}: ${r.error}`)
    s = r.state
  })
  games++
}

const rawNote = rbad === 0 ? 'raw f32 identical too' : `${rbad} positions differ in raw f32 only (sub-quantum; the network sees the same bytes)`
console.log(`${games} games, ${positions} positions: ${qbad === 0 ? 'every encoding identical' : `${qbad} DIFFER`}. ${rawNote}.${net ? ` network value max |Δ| ${valMax.toExponential(2)}.` : ''}`)
if (firstFail) console.log('first difference:', firstFail)
process.exit(qbad === 0 ? 0 : 1)
