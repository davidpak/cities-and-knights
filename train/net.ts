/**
 * The network's forward pass in TypeScript, reading the .net file format written by sim/src/nn.rs (Net::save):
 * the magic "TPNET1", three u32 (inputs, h1, h2), then w1, b1, w2, b2, w3, b3 as little-endian f32.
 * Weights are kept as Float32Array so the loaded values are the exact f32 the trainer wrote; the matmuls run in
 * double and are close enough that move choices match the Rust agent (train/enc-parity.ts checks the values agree).
 */
import { readFileSync } from 'node:fs'

const OUT = 4

export type Net = {
  inputs: number
  h1: number
  h2: number
  w1: Float32Array
  b1: Float32Array
  w2: Float32Array
  b2: Float32Array
  w3: Float32Array
  b3: Float32Array
}

export function loadNet(path: string): Net {
  const buf = readFileSync(path)
  if (buf.toString('latin1', 0, 6) !== 'TPNET1') throw new Error(`${path}: not a network file`)
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  const inputs = dv.getUint32(6, true)
  const h1 = dv.getUint32(10, true)
  const h2 = dv.getUint32(14, true)
  let at = 18
  const take = (len: number) => {
    const a = new Float32Array(len)
    for (let i = 0; i < len; i++) {
      a[i] = dv.getFloat32(at, true)
      at += 4
    }
    return a
  }
  const w1 = take(inputs * h1)
  const b1 = take(h1)
  const w2 = take(h2 * h1)
  const b2 = take(h2)
  const w3 = take(OUT * h2)
  const b3 = take(OUT)
  return { inputs, h1, h2, w1, b1, w2, b2, w3, b3 }
}

/** the four logits (who wins: me, the next player, ...). x is dense but mostly zero; only non-zero inputs do work. */
export function forward(net: Net, x: Float32Array): Float32Array {
  const { h1, h2, w1, b1, w2, b2, w3, b3 } = net
  const a1 = new Float32Array(h1)
  a1.set(b1)
  for (let i = 0; i < x.length; i++) {
    const v = x[i]
    if (v === 0) continue
    const base = i * h1
    for (let j = 0; j < h1; j++) a1[j] += v * w1[base + j]
  }
  for (let j = 0; j < h1; j++) if (a1[j] < 0) a1[j] = 0
  const a2 = new Float32Array(h2)
  for (let j = 0; j < h2; j++) {
    const base = j * h1
    let z = b2[j]
    for (let i = 0; i < h1; i++) z += a1[i] * w2[base + i]
    a2[j] = z < 0 ? 0 : z
  }
  const out = new Float32Array(OUT)
  for (let k = 0; k < OUT; k++) {
    const base = k * h2
    let z = b3[k]
    for (let i = 0; i < h2; i++) z += a2[i] * w3[base + i]
    out[k] = z
  }
  return out
}

export function softmax(z: Float32Array, players: number): number[] {
  let m = -Infinity
  for (let k = 0; k < players; k++) m = Math.max(m, z[k])
  const p = new Array<number>(players)
  let s = 0
  for (let k = 0; k < players; k++) {
    p[k] = Math.exp(z[k] - m)
    s += p[k]
  }
  for (let k = 0; k < players; k++) p[k] /= s
  return p
}

/** the chance that the one who sees (slot 0) wins, among `players` players */
export function value(net: Net, x: Float32Array, players: number): number {
  return softmax(forward(net, x), players)[0]
}
