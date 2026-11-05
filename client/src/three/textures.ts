/**
 * Pictures painted into faces (never planes laid over them): number tokens, harbour signs, dice faces.
 * Cached, so every token showing 8 shares one texture.
 */
import { CanvasTexture, SRGBColorSpace } from 'three'
import type { HarborKind } from '../../../shared/rules.ts'
import { paintIcon } from '../lib/icons.ts'
import { PAL, RESOURCE_COLOR } from '../lib/palette.ts'

const cache = new Map<string, CanvasTexture>()

function make(key: string, size: number, paint: (ctx: CanvasRenderingContext2D, s: number) => void) {
  const hit = cache.get(key)
  if (hit) return hit
  const c = document.createElement('canvas')
  c.width = c.height = size
  const ctx = c.getContext('2d')!
  paint(ctx, size)
  const t = new CanvasTexture(c)
  t.colorSpace = SRGBColorSpace
  t.anisotropy = 8
  cache.set(key, t)
  return t
}

export const PIP_COUNT: Record<number, number> = { 2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 8: 5, 9: 4, 10: 3, 11: 2, 12: 1 }

/** a token's top: the number, and dots for how often it comes up */
export function tokenTexture(n: number) {
  return make(`token${n}`, 256, (ctx, s) => {
    ctx.fillStyle = PAL.cream
    ctx.fillRect(0, 0, s, s)
    const red = n === 6 || n === 8
    ctx.fillStyle = red ? PAL.red : PAL.plum
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.font = `800 ${n >= 10 ? 124 : 140}px Nunito, sans-serif`
    ctx.fillText(String(n), s / 2, s * 0.45)
    const dots = PIP_COUNT[n] ?? 0
    const gap = 21
    for (let i = 0; i < dots; i++) {
      ctx.beginPath()
      ctx.arc(s / 2 + (i - (dots - 1) / 2) * gap, s * 0.77, 7.5, 0, Math.PI * 2)
      ctx.fill()
    }
  })
}

/** a harbour's sign: what it trades and at what rate */
export function harborTexture(kind: HarborKind) {
  return make(`harbor-${kind}`, 256, (ctx, s) => {
    ctx.fillStyle = PAL.cream
    ctx.fillRect(0, 0, s, s)
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = PAL.plum
    if (kind === 'any') {
      ctx.font = `800 112px Nunito, sans-serif`
      ctx.fillText('3:1', s / 2, s * 0.52)
    } else {
      paintIcon(ctx, kind, s / 2, s * 0.32, 116, RESOURCE_COLOR[kind])
      ctx.font = `800 84px Nunito, sans-serif`
      ctx.fillText('2:1', s / 2, s * 0.76)
    }
  })
}

/** one die face, 1 to 6 */
export function dieTexture(v: number) {
  return make(`die${v}`, 128, (ctx, s) => {
    ctx.fillStyle = PAL.cream
    ctx.fillRect(0, 0, s, s)
    ctx.fillStyle = v === 1 ? PAL.red : PAL.plum
    const at: Record<number, [number, number][]> = {
      1: [[0.5, 0.5]],
      2: [[0.27, 0.27], [0.73, 0.73]],
      3: [[0.27, 0.27], [0.5, 0.5], [0.73, 0.73]],
      4: [[0.27, 0.27], [0.73, 0.27], [0.27, 0.73], [0.73, 0.73]],
      5: [[0.27, 0.27], [0.73, 0.27], [0.5, 0.5], [0.27, 0.73], [0.73, 0.73]],
      6: [[0.27, 0.25], [0.73, 0.25], [0.27, 0.5], [0.73, 0.5], [0.27, 0.75], [0.73, 0.75]],
    }
    for (const [x, y] of at[v]) {
      ctx.beginPath()
      ctx.arc(x * s, y * s, v === 1 ? s * 0.12 : s * 0.085, 0, Math.PI * 2)
      ctx.fill()
    }
  })
}
