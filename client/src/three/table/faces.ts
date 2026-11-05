/**
 * The printed faces of every card, painted once into one atlas (so every card on the table is one draw), and the
 * trade tray's surface.
 *
 * Cards are printed plainly: a cream paper face with a coloured picture panel, or a solid back with one small mark.
 * No hatching, no ink borders: those shimmered and read as noise at a distance.
 */
import { CanvasTexture, SRGBColorSpace } from 'three'
import { CARDS, CARD_NAME, COMMODITIES, PROGRESS, PROGRESS_CARDS, RESOURCES, TRACKS, TRACK_NAME, type Card, type Good, type Progress, type Track } from '../../../../shared/rules.ts'
import { CARD_ICON, ICON, PROGRESS_ICON, SHIELD } from '../../lib/icons.ts'
import { RESOURCE_COLOR, RESOURCE_NAME, TRACK_COLOR } from '../../lib/palette.ts'
import { FONT } from '../atlas.ts'
import { QUALITY } from '../quality.ts'

const INK = '#2a1d13'
const PAPER = '#f4e9d0'
export const EDGE = '#e6d8b8'
const RES_BACK = '#b4824f'
const DEV_BACK = '#4a3b72'

const W = 200
const H = 280
const COLS = 8
const ROWS = 6

/** the atlas cells, by what a card shows */
export const TILE: Record<string, number> = {}
RESOURCES.forEach((r, i) => (TILE[`res:${r}`] = i))
TILE['res:?'] = 5
CARDS.forEach((c, i) => (TILE[`dev:${c}`] = 6 + i))
TILE['dev:?'] = 11
TILE['award:road'] = 12
TILE['award:army'] = 13
export const EDGE_TILE = 14
// the expansion: commodities, progress cards (a back for each track and a plain one for cards nobody may see), the
// defender of the island
COMMODITIES.forEach((c, i) => (TILE[`res:${c}`] = 15 + i))
TRACKS.forEach((t, i) => (TILE[`prog:?${t}`] = 18 + i))
TILE['prog:?'] = 21
TILE['defender'] = 22
PROGRESS_CARDS.forEach((c, i) => (TILE[`prog:${c}`] = 23 + i))
export const ATLAS = { cols: COLS, rows: ROWS }
/** a card's back, by its family */
export const BACK_TILE: Record<string, number> = { res: 5, want: 5, dev: 11, 'award:road': 12, 'award:army': 13, defender: 22 }
/** a progress card's back is its track's (a card nobody may see: the plain back) */
export function backOf(family: string, look: string) {
  if (family !== 'prog') return BACK_TILE[family] ?? 5
  if (look.startsWith('prog:?')) return TILE[look] ?? 21
  const card = look.slice(5) as Progress
  return PROGRESS[card] ? TILE[`prog:?${PROGRESS[card].track}`] : 21
}

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

function resource(c: CanvasRenderingContext2D, r: Good) {
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

/** a progress card: its track's colour across the top, the picture, the name, a line of what it does */
function progress(c: CanvasRenderingContext2D, card: Progress) {
  const t = PROGRESS[card].track
  c.fillStyle = PAPER
  c.fillRect(0, 0, W, H)
  c.fillStyle = TRACK_COLOR[t]
  round(c, 14, 14, W - 28, 150, 10)
  c.fill()
  icon(c, PROGRESS_ICON[card], W / 2, 89, 96, '#fffaf0')
  const name = PROGRESS[card].name
  text(c, name, W / 2, 190, name.length > 13 ? 21 : 25, INK)
  // the rule, small, wrapped (readable close up; the name is what you read at a glance)
  c.fillStyle = 'rgba(42, 29, 19, 0.78)'
  c.font = `600 12px ${FONT}`
  const words = PROGRESS[card].text.split(' ')
  let line = ''
  let y = 214
  for (const w of words) {
    const next = line ? `${line} ${w}` : w
    if (c.measureText(next).width > W - 34 && line) {
      c.fillText(line, W / 2, y)
      line = w
      y += 14
    } else line = next
  }
  if (line) c.fillText(line, W / 2, y)
}

function progressBack(c: CanvasRenderingContext2D, t: Track | null) {
  c.fillStyle = t ? TRACK_COLOR[t] : '#6b5a48'
  c.fillRect(0, 0, W, H)
  c.fillStyle = 'rgba(255, 245, 225, 0.16)'
  round(c, 14, 14, W - 28, H - 28, 10)
  c.fill()
  icon(c, 'M12 2l2.9 6.6 7.1.6-5.4 4.7 1.6 7.1L12 17.3 5.8 21l1.6-7.1L2 9.2l7.1-.6z', W / 2, H / 2 - 14, 64, '#fff6e2')
  if (t) text(c, TRACK_NAME[t], W / 2, H / 2 + 52, 24, '#fff6e2')
}

function defender(c: CanvasRenderingContext2D) {
  c.fillStyle = '#d9d2c2'
  c.fillRect(0, 0, W, H)
  icon(c, SHIELD, W / 2, 106, 104, '#5a6b86')
  text(c, 'Defender', W / 2, 196, 30, INK)
  text(c, '+1', W / 2, 238, 36, INK)
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
  // painted at one and a half times its layout size: the cards are big on screen, and their faces stay sharp
  const R = 1.5
  const cv = document.createElement('canvas')
  cv.width = W * COLS * R
  cv.height = H * ROWS * R
  const ctx = cv.getContext('2d')!
  const cell = (i: number, draw: (c: CanvasRenderingContext2D) => void) => {
    ctx.save()
    ctx.translate((i % COLS) * W * R, Math.floor(i / COLS) * H * R)
    ctx.scale(R, R)
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
  COMMODITIES.forEach((r) => cell(TILE[`res:${r}`], (c) => resource(c, r)))
  TRACKS.forEach((t) => cell(TILE[`prog:?${t}`], (c) => progressBack(c, t)))
  cell(TILE['prog:?'], (c) => progressBack(c, null))
  cell(TILE['defender'], defender)
  PROGRESS_CARDS.forEach((k) => cell(TILE[`prog:${k}`], (c) => progress(c, k)))
  cell(EDGE_TILE, (c) => {
    c.fillStyle = EDGE
    c.fillRect(0, 0, W, H)
  })
  atlas = new CanvasTexture(cv)
  atlas.colorSpace = SRGBColorSpace
  atlas.anisotropy = QUALITY.aniso
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
  t.anisotropy = QUALITY.aniso
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
