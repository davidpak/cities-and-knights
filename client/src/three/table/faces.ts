/**
 * The printed faces: resource cards, card backs, development cards, award cards, and the trade tray's surface.
 * Painted once into canvases (each shared by every card that shows it).
 */
import { CanvasTexture, SRGBColorSpace } from 'three'
import { CARD_NAME, type Card, type Resource } from '../../../../shared/rules.ts'
import { CARD_ICON, ICON } from '../../lib/icons.ts'
import { RESOURCE_COLOR, RESOURCE_NAME } from '../../lib/palette.ts'
import { FONT } from '../atlas.ts'

const INK = '#2a1d13'
const PAPER = '#f6ecd5'
const cache = new Map<string, CanvasTexture>()

function paint(key: string, w: number, h: number, draw: (c: CanvasRenderingContext2D) => void) {
  const hit = cache.get(key)
  if (hit) return hit
  const cv = document.createElement('canvas')
  cv.width = w
  cv.height = h
  const ctx = cv.getContext('2d')!
  draw(ctx)
  const t = new CanvasTexture(cv)
  t.colorSpace = SRGBColorSpace
  t.anisotropy = 8
  cache.set(key, t)
  return t
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

const W = 200
const H = 280

/** the card's paper and ink edge */
function blank(c: CanvasRenderingContext2D, paper = PAPER) {
  c.fillStyle = INK
  c.fillRect(0, 0, W, H)
  c.fillStyle = paper
  round(c, 6, 6, W - 12, H - 12, 14)
  c.fill()
}

export function resourceFace(r: Resource) {
  return paint(`res-${r}`, W, H, (c) => {
    blank(c)
    c.fillStyle = RESOURCE_COLOR[r]
    round(c, 20, 20, W - 40, H - 86, 8)
    c.fill()
    c.lineWidth = 4
    c.strokeStyle = INK
    c.stroke()
    icon(c, ICON[r], W / 2, 20 + (H - 86) / 2, 110, '#fffaf0')
    c.fillStyle = INK
    c.font = `700 34px ${FONT}`
    c.textAlign = 'center'
    c.textBaseline = 'middle'
    c.fillText(RESOURCE_NAME[r], W / 2, H - 38)
  })
}

export function resourceBack() {
  return paint('res-back', W, H, (c) => {
    blank(c, '#b8875a')
    c.save()
    round(c, 6, 6, W - 12, H - 12, 14)
    c.clip()
    c.strokeStyle = 'rgba(90, 55, 25, 0.45)'
    c.lineWidth = 6
    for (let i = -H; i < W + H; i += 18) {
      c.beginPath()
      c.moveTo(i, 0)
      c.lineTo(i + H, H)
      c.stroke()
    }
    c.restore()
    c.fillStyle = PAPER
    c.beginPath()
    c.arc(W / 2, H / 2, 36, 0, Math.PI * 2)
    c.fill()
    c.lineWidth = 5
    c.strokeStyle = INK
    c.stroke()
  })
}

export function devFace(card: Card) {
  const vp = card === 'victoryPoint'
  return paint(`dev-${card}`, W, H, (c) => {
    blank(c, vp ? '#6a4718' : '#3a2d58')
    icon(c, CARD_ICON[card], W / 2, 110, 100, vp ? '#f6c85a' : '#fffaf0')
    c.fillStyle = '#fffaf0'
    c.font = `700 ${CARD_NAME[card].length > 12 ? 26 : 30}px ${FONT}`
    c.textAlign = 'center'
    c.textBaseline = 'middle'
    const words = CARD_NAME[card].split(' ')
    if (words.length > 2) {
      c.fillText(words.slice(0, 2).join(' '), W / 2, H - 66)
      c.fillText(words.slice(2).join(' '), W / 2, H - 36)
    } else c.fillText(CARD_NAME[card], W / 2, H - 46)
  })
}

export function devBack() {
  return paint('dev-back', W, H, (c) => {
    blank(c, '#4b3a78')
    c.save()
    round(c, 6, 6, W - 12, H - 12, 14)
    c.clip()
    c.strokeStyle = 'rgba(20, 10, 40, 0.35)'
    c.lineWidth = 6
    for (let i = -H; i < W + H; i += 18) {
      c.beginPath()
      c.moveTo(i, H)
      c.lineTo(i + H, 0)
      c.stroke()
    }
    c.restore()
    icon(c, 'M12 3l5 9-5 9-5-9z', W / 2, H / 2, 90, '#f6c85a')
  })
}

export function awardFace(what: 'road' | 'army') {
  return paint(`award-${what}`, W, H, (c) => {
    blank(c, '#f2cf6e')
    c.fillStyle = INK
    c.textAlign = 'center'
    c.textBaseline = 'middle'
    c.font = `700 34px ${FONT}`
    c.fillText(what === 'road' ? 'Longest' : 'Largest', W / 2, 70)
    c.fillText(what === 'road' ? 'Road' : 'Army', W / 2, 108)
    icon(c, what === 'road' ? 'M2 15.5l17-8 3 3.2-17 8z' : CARD_ICON.knight, W / 2, 170, 70, INK)
    c.font = `700 40px ${FONT}`
    c.fillText('+2', W / 2, 236)
  })
}

/** the tray's floor: a line down the middle, and which half is which */
export function trayFace(mode: 'trade' | 'discard') {
  return paint(`tray-${mode}`, 400, 300, (c) => {
    c.fillStyle = '#d9b98a'
    c.fillRect(0, 0, 400, 300)
    c.strokeStyle = 'rgba(42, 29, 19, 0.16)'
    c.lineWidth = 2
    for (let y = 8; y < 300; y += 14) {
      c.beginPath()
      c.moveTo(0, y + Math.sin(y) * 2)
      c.lineTo(400, y + Math.cos(y) * 2)
      c.stroke()
    }
    c.fillStyle = 'rgba(42, 29, 19, 0.55)'
    c.font = `700 22px ${FONT}`
    c.textAlign = 'left'
    c.textBaseline = 'middle'
    if (mode === 'trade') {
      c.setLineDash([12, 10])
      c.strokeStyle = 'rgba(42, 29, 19, 0.55)'
      c.lineWidth = 4
      c.beginPath()
      c.moveTo(14, 150)
      c.lineTo(386, 150)
      c.stroke()
      c.fillText('YOU GET', 16, 22)
      c.fillText('YOU GIVE', 16, 280)
    } else c.fillText('DISCARD', 16, 280)
  })
}
