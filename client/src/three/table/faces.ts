/**
 * The printed faces of every card, painted once into one atlas (so every card on the table is one draw), and the
 * trade tray's surface.
 *
 * Cards are printed plainly: a cream paper face with a coloured picture panel, or a solid back with one small mark.
 * No hatching, no ink borders: those shimmered and read as noise at a distance.
 */
import { CanvasTexture, SRGBColorSpace } from 'three'
import { CARDS, CARD_NAME, RESOURCES, type Card, type Resource } from '../../../../shared/rules.ts'
import { CARD_ICON, ICON } from '../../lib/icons.ts'
import { RESOURCE_COLOR, RESOURCE_NAME } from '../../lib/palette.ts'
import { FONT } from '../atlas.ts'

const INK = '#2a1d13'
const PAPER = '#f4e9d0'
export const EDGE = '#e6d8b8'
const RES_BACK = '#b4824f'
const DEV_BACK = '#4a3b72'

const W = 200
const H = 280
const COLS = 4
const ROWS = 4

/** the atlas cells, by what a card shows */
export const TILE: Record<string, number> = {}
RESOURCES.forEach((r, i) => (TILE[`res:${r}`] = i))
TILE['res:?'] = 5
CARDS.forEach((c, i) => (TILE[`dev:${c}`] = 6 + i))
TILE['dev:?'] = 11
TILE['award:road'] = 12
TILE['award:army'] = 13
export const EDGE_TILE = 14
export const ATLAS = { cols: COLS, rows: ROWS }
/** a card's back, by its family */
export const BACK_TILE: Record<string, number> = { res: 5, dev: 11, 'award:road': 12, 'award:army': 13 }

function round(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  c.beginPath()
  c.moveTo(x + r, y)
  c.arcTo(x + w, y, x + w, y + h, r)
  c.arcTo(x + w, y + h, x, y + h, r)
  c.arcTo(x, y + h, x, y, r)
  c.arcTo(x, y, x + w, y, r)
  c.closePath()
}

function icon(c: CanvasRenderingContext2D, d: string, x: number, y: number, size: number, fill: string) {
  c.save()
  c.translate(x - size / 2, y - size / 2)
  c.scale(size / 24, size / 24)
  c.fillStyle = fill
  c.fill(new Path2D(d))
  c.restore()
}

function text(c: CanvasRenderingContext2D, s: string, x: number, y: number, size: number, color: string) {
  c.fillStyle = color
  c.font = `700 ${size}px ${FONT}`
  c.textAlign = 'center'
  c.textBaseline = 'middle'
  c.fillText(s, x, y)
}

function resource(c: CanvasRenderingContext2D, r: Resource) {
  c.fillStyle = PAPER
  c.fillRect(0, 0, W, H)
  c.fillStyle = RESOURCE_COLOR[r]
  round(c, 14, 14, W - 28, H - 78, 10)
  c.fill()
  icon(c, ICON[r], W / 2, 14 + (H - 78) / 2, 112, '#fffaf0')
  text(c, RESOURCE_NAME[r], W / 2, H - 33, 32, INK)
}

function back(c: CanvasRenderingContext2D, color: string, mark: string, markColor: string) {
  c.fillStyle = color
  c.fillRect(0, 0, W, H)
  c.fillStyle = 'rgba(255, 245, 225, 0.14)'
  round(c, 14, 14, W - 28, H - 28, 10)
  c.fill()
  icon(c, mark, W / 2, H / 2, 70, markColor)
}

function dev(c: CanvasRenderingContext2D, card: Card) {
  const vp = card === 'victoryPoint'
  c.fillStyle = vp ? '#6a4718' : '#3a2d58'
  c.fillRect(0, 0, W, H)
  icon(c, CARD_ICON[card], W / 2, 112, 104, vp ? '#f6c85a' : '#fffaf0')
  const words = CARD_NAME[card].split(' ')
  const size = CARD_NAME[card].length > 12 ? 26 : 30
  if (words.length > 2) {
    text(c, words.slice(0, 2).join(' '), W / 2, H - 66, size, '#fffaf0')
    text(c, words.slice(2).join(' '), W / 2, H - 36, size, '#fffaf0')
  } else text(c, CARD_NAME[card], W / 2, H - 46, size, '#fffaf0')
}

function award(c: CanvasRenderingContext2D, what: 'road' | 'army') {
  c.fillStyle = '#f2cf6e'
  c.fillRect(0, 0, W, H)
  text(c, what === 'road' ? 'Longest' : 'Largest', W / 2, 66, 34, INK)
  text(c, what === 'road' ? 'Road' : 'Army', W / 2, 104, 34, INK)
  icon(c, what === 'road' ? 'M2 15.5l17-8 3 3.2-17 8z' : CARD_ICON.knight, W / 2, 168, 70, INK)
  text(c, '+2', W / 2, 236, 40, INK)
}

/** a little house, the mark on the resource cards' backs */
const HOUSE = 'M12 3l8 7v11H4V10z'

let atlas: CanvasTexture | null = null
export function cardAtlas() {
  if (atlas) return atlas
  const cv = document.createElement('canvas')
  cv.width = W * COLS
  cv.height = H * ROWS
  const ctx = cv.getContext('2d')!
  const cell = (i: number, draw: (c: CanvasRenderingContext2D) => void) => {
    ctx.save()
    ctx.translate((i % COLS) * W, Math.floor(i / COLS) * H)
    ctx.beginPath()
    ctx.rect(0, 0, W, H)
    ctx.clip()
    draw(ctx)
    ctx.restore()
  }
  RESOURCES.forEach((r) => cell(TILE[`res:${r}`], (c) => resource(c, r)))
  cell(TILE['res:?'], (c) => back(c, RES_BACK, HOUSE, '#f4e3c2'))
  CARDS.forEach((k) => cell(TILE[`dev:${k}`], (c) => dev(c, k)))
  cell(TILE['dev:?'], (c) => back(c, DEV_BACK, 'M12 3l5 9-5 9-5-9z', '#f6c85a'))
  cell(TILE['award:road'], (c) => award(c, 'road'))
  cell(TILE['award:army'], (c) => award(c, 'army'))
  cell(EDGE_TILE, (c) => {
    c.fillStyle = EDGE
    c.fillRect(0, 0, W, H)
  })
  atlas = new CanvasTexture(cv)
  atlas.colorSpace = SRGBColorSpace
  atlas.anisotropy = 8
  return atlas
}

const cache = new Map<string, CanvasTexture>()
function paint(key: string, w: number, h: number, draw: (c: CanvasRenderingContext2D) => void) {
  const hit = cache.get(key)
  if (hit) return hit
  const cv = document.createElement('canvas')
  cv.width = w
  cv.height = h
  draw(cv.getContext('2d')!)
  const t = new CanvasTexture(cv)
  t.colorSpace = SRGBColorSpace
  t.anisotropy = 8
  cache.set(key, t)
  return t
}

/** the tray's floor: plain wood, a line down the middle */
export function trayFace(mode: 'trade' | 'discard') {
  return paint(`tray-${mode}`, 400, 300, (c) => {
    c.fillStyle = '#cfae7f'
    c.fillRect(0, 0, 400, 300)
    c.fillStyle = 'rgba(42, 29, 19, 0.5)'
    c.font = `700 20px ${FONT}`
    c.textAlign = 'left'
    c.textBaseline = 'middle'
    if (mode === 'trade') {
      c.fillStyle = 'rgba(42, 29, 19, 0.28)'
      c.fillRect(14, 148, 372, 4)
      c.fillStyle = 'rgba(42, 29, 19, 0.5)'
      c.fillText('YOU GET', 16, 22)
      c.fillText('YOU GIVE', 16, 280)
    } else c.fillText('DISCARD', 16, 280)
  })
}
