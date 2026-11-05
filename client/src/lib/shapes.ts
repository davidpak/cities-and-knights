import { Shape, Path } from 'three'

type P = [number, number]
type Radius = number | number[]

/** Closed polygon with each corner rounded by a quadratic curve. */
export function roundedPolygon<T extends Path = Shape>(points: P[], radius: Radius, target?: T): T {
  const out = (target ?? new Shape()) as T
  const n = points.length
  const r = (i: number) => (Array.isArray(radius) ? radius[i] : radius)
  const corner = (i: number) => {
    const [px, py] = points[i]
    const [ax, ay] = points[(i - 1 + n) % n]
    const [bx, by] = points[(i + 1) % n]
    const la = Math.hypot(ax - px, ay - py)
    const lb = Math.hypot(bx - px, by - py)
    const k = Math.min(r(i), la / 2, lb / 2)
    return {
      a: [px + ((ax - px) / la) * k, py + ((ay - py) / la) * k] as P,
      p: [px, py] as P,
      b: [px + ((bx - px) / lb) * k, py + ((by - py) / lb) * k] as P,
    }
  }
  const c0 = corner(0)
  out.moveTo(...c0.a)
  out.quadraticCurveTo(...c0.p, ...c0.b)
  for (let i = 1; i < n; i++) {
    const c = corner(i)
    out.lineTo(...c.a)
    out.quadraticCurveTo(...c.p, ...c.b)
  }
  out.closePath()
  return out
}

export function roundedRect<T extends Path = Shape>(w: number, h: number, r: number, target?: T): T {
  return roundedPolygon(
    [
      [-w / 2, -h / 2],
      [w / 2, -h / 2],
      [w / 2, h / 2],
      [-w / 2, h / 2],
    ],
    r,
    target,
  )
}

/** Equilateral triangle centred on its centroid, apex up (+y) or down. */
export function roundedTriangle(circumradius: number, r: number, up: boolean) {
  const R = circumradius
  const s = up ? 1 : -1
  const pts: P[] = [
    [0, s * R],
    [-R * Math.sin(Math.PI / 3), -s * R * 0.5],
    [R * Math.sin(Math.PI / 3), -s * R * 0.5],
  ]
  return roundedPolygon(up ? pts : [pts[0], pts[2], pts[1]], r)
}

/** A thick V (or ^) as one closed outline, so it extrudes as a single raised glyph. */
export function chevron(width: number, height: number, stroke: number, up: boolean) {
  const w = width / 2
  const h = height / 2
  const s = up ? 1 : -1
  // outer apex, right tip, inner notch, left tip
  const pts: P[] = [
    [0, s * h],
    [w, -s * h],
    [w - stroke * 1.1, -s * h],
    [0, s * (h - stroke * 1.5)],
    [-w + stroke * 1.1, -s * h],
    [-w, -s * h],
  ]
  return roundedPolygon(up ? pts : [...pts].reverse(), stroke * 0.35)
}
