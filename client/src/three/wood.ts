/**
 * Painted wood: the pieces' one material. A faint grain (painted once into a small tiling texture, a few percent
 * darker and lighter) under the player's colour, so the pieces read as wooden toys rather than plastic.
 * Shared by every piece of a colour; instanced pieces take their colour per instance instead.
 */
import { CanvasTexture, MeshLambertMaterial, RepeatWrapping, SRGBColorSpace } from 'three'
import './../lib/toy.ts'

let grain: CanvasTexture | null = null
export function grainTexture() {
  if (grain) return grain
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const g = c.getContext('2d')!
  g.fillStyle = '#ffffff'
  g.fillRect(0, 0, 128, 128)
  let t = 7
  const rnd = () => ((t = (t * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
  for (let i = 0; i < 46; i++) {
    const y = rnd() * 128
    const a = 0.03 + rnd() * 0.05
    g.strokeStyle = `rgba(60, 35, 15, ${a})`
    g.lineWidth = 0.6 + rnd() * 1.6
    g.beginPath()
    for (let x = -4; x <= 132; x += 8) {
      const yy = y + Math.sin(x * 0.05 + i) * 1.5
      // wrap so the tile repeats without a seam
      if (x === -4) g.moveTo(x, yy)
      else g.lineTo(x, yy)
    }
    g.stroke()
  }
  grain = new CanvasTexture(c)
  grain.colorSpace = SRGBColorSpace
  grain.wrapS = grain.wrapT = RepeatWrapping
  grain.repeat.set(1 / 40, 1 / 40) // the geometry's UVs are in millimetres
  grain.anisotropy = 4
  return grain
}

const cache = new Map<string, MeshLambertMaterial>()
/** painted wood in a colour ('#fff' for instanced pieces, which carry their own colour) */
export function wood(color = '#ffffff', opacity = 1) {
  const key = `${color}|${opacity}`
  let m = cache.get(key)
  if (!m) {
    m = new MeshLambertMaterial({ color, map: grainTexture() })
    if (opacity < 1) {
      m.transparent = true
      m.opacity = opacity
      m.depthWrite = false
    }
    cache.set(key, m)
  }
  return m
}
