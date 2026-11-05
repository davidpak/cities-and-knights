/**
 * One texture holding every picture painted on the board: the ten number tokens and the six harbour signs, in a
 * 4 x 4 grid. One texture means every token and sign on the board draws in a single call.
 */
import { CanvasTexture, SRGBColorSpace } from 'three'
import { RESOURCES, type HarborKind } from '../../../shared/rules.ts'
import { paintIcon } from '../lib/icons.ts'
import { PAL, RESOURCE_COLOR } from '../lib/palette.ts'

export const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif'
const CELL = 256
const GRID = 4
const NUMBERS = [2, 3, 4, 5, 6, 8, 9, 10, 11, 12]
const KINDS: HarborKind[] = ['any', ...RESOURCES]
export const PIPS: Record<number, number> = { 2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 8: 5, 9: 4, 10: 3, 11: 2, 12: 1 }

/** the cell a picture lives in */
export const cellOf = (what: { number: number } | { harbor: HarborKind }) =>
  'number' in what ? NUMBERS.indexOf(what.number) : NUMBERS.length + KINDS.indexOf(what.harbor)

/** maps a 0..1 uv inside a picture to the atlas */
export function atlasUV(cell: number, u: number, v: number): [number, number] {
  const col = cell % GRID
  const row = Math.floor(cell / GRID)
  return [(col + u) / GRID, 1 - (row + 1) / GRID + v / GRID]
}

let atlas: CanvasTexture | null = null
export function getAtlas() {
  if (atlas) return atlas
  const c = document.createElement('canvas')
  c.width = c.height = CELL * GRID
  const ctx = c.getContext('2d')!
  ctx.fillStyle = PAL.cream
  ctx.fillRect(0, 0, c.width, c.height)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const at = (cell: number) => [(cell % GRID) * CELL + CELL / 2, Math.floor(cell / GRID) * CELL + CELL / 2]

  for (const n of NUMBERS) {
    const [x, y] = at(cellOf({ number: n }))
    const red = n === 6 || n === 8
    ctx.fillStyle = red ? PAL.red : PAL.plum
    ctx.font = `800 ${n >= 10 ? 116 : 132}px ${FONT}`
    ctx.fillText(String(n), x, y - 14)
    const dots = PIPS[n]
    for (let i = 0; i < dots; i++) {
      ctx.beginPath()
      ctx.arc(x + (i - (dots - 1) / 2) * 22, y + 66, 8, 0, Math.PI * 2)
      ctx.fill()
    }
  }
  for (const k of KINDS) {
    const [x, y] = at(cellOf({ harbor: k }))
    ctx.fillStyle = PAL.plum
    if (k === 'any') {
      ctx.font = `800 104px ${FONT}`
      ctx.fillText('3:1', x, y + 4)
    } else {
      paintIcon(ctx, k, x, y - 32, 112, RESOURCE_COLOR[k])
      ctx.font = `800 76px ${FONT}`
      ctx.fillText('2:1', x, y + 70)
    }
  }
  atlas = new CanvasTexture(c)
  atlas.colorSpace = SRGBColorSpace
  atlas.anisotropy = 4
  return atlas
}
