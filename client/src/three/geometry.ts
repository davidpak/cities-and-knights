/**
 * Every shape in the game, built once from the spec. Hard surfaces are laid out flat in 2D, extruded with a bevel
 * and turned once (the playbook's rule); turned things are lathed. Nothing is a plane laid over another surface.
 */
import {
  BoxGeometry, CircleGeometry, ExtrudeGeometry, LatheGeometry, Path, Shape, Vector2, Vector3,
} from 'three'
import { roundedPolygon, roundedRect } from '../lib/shapes.ts'
import { CITY, DICE, HARBOR, ROAD, ROBBER, SEA, SETTLEMENT, TILE, TOKEN } from './spec.ts'

const memo = <T>(f: () => T) => {
  let v: T | undefined
  return () => (v ??= f())
}

/** an outline drawn in the board plane (x right, z toward you), extruded upward by h with a soft bevel */
function slab(outline: (s: Shape) => Shape, h: number, bevel: number, curve = 6) {
  const g = new ExtrudeGeometry(outline(new Shape()), {
    depth: Math.max(0.01, h - 2 * bevel),
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 3,
    curveSegments: curve,
  })
  g.rotateX(-Math.PI / 2) // shape y becomes -z, extrusion becomes +y
  g.translate(0, bevel, 0)
  return g
}

/** board (x, z) to the 2D outline frame used before the turn */
const P = (x: number, z: number): [number, number] => [x, -z]

/** a pointy-topped hexagon in the board plane */
const hexPoints = (r: number) => Array.from({ length: 6 }, (_, i) => P(r * Math.sin((Math.PI / 3) * i), -r * Math.cos((Math.PI / 3) * i)))
/** a flat-topped hexagon (the shape the whole island makes) */
const flatHexPoints = (r: number) => Array.from({ length: 6 }, (_, i) => P(r * Math.cos((Math.PI / 3) * i), r * Math.sin((Math.PI / 3) * i)))

export const tileGeo = memo(() => slab((s) => roundedPolygon(hexPoints(TILE.r - TILE.bevel), 4, s), TILE.h, TILE.bevel))

/** a puck with a rounded top edge; the top face is its own disc, so a picture can be painted on it */
function puck(r: number, h: number, b: number) {
  const pts: Vector2[] = [new Vector2(0, 0), new Vector2(r - 0.6, 0), new Vector2(r, 0.6), new Vector2(r, h - b)]
  for (let i = 1; i <= 6; i++) {
    const a = (i / 6) * (Math.PI / 2)
    pts.push(new Vector2(r - b + b * Math.cos(a), h - b + b * Math.sin(a)))
  }
  const side = new LatheGeometry(pts, 48)
  const top = new CircleGeometry(r - b, 48)
  top.rotateX(-Math.PI / 2)
  top.translate(0, h, 0)
  return { side, top }
}
export const tokenGeo = memo(() => puck(TOKEN.r, TOKEN.h, TOKEN.bevel))
export const signGeo = memo(() => puck(HARBOR.signR, HARBOR.signH, 1.2))

/** an outline seen from the front (x across, y up), extruded front to back and centred */
function upright(points: [number, number][], depth: number, round: number) {
  const g = new ExtrudeGeometry(roundedPolygon(points, round, new Shape()), {
    depth: depth - 2 * round,
    bevelEnabled: true,
    bevelThickness: round,
    bevelSize: round,
    bevelSegments: 2,
    curveSegments: 4,
  })
  g.translate(0, round, -(depth - 2 * round) / 2)
  return g
}

export const settlementGeo = memo(() => {
  const { w, d, wall, peak, round } = SETTLEMENT
  const x = w / 2 - round
  return upright([[-x, 0], [x, 0], [x, wall - round], [0, peak - round], [-x, wall - round]], d, round)
})

export const cityGeo = memo(() => {
  const { w, d, wall, peak, towerW, tower, towerPeak, round } = CITY
  const L = -w / 2 + round
  const R = w / 2 - round
  const t = L + towerW // where the tower meets the house
  const mid = (t + R) / 2
  return upright(
    [
      [L, 0], [R, 0], [R, wall - round], [mid, peak - round], [t, wall - round], [t, tower - round],
      [(L + t) / 2, towerPeak - round], [L, tower - round],
    ],
    d,
    round,
  )
})

export const roadGeo = memo(() => slab((s) => roundedRect(ROAD.len - 2 * ROAD.round, ROAD.w - 2 * ROAD.round, 1.5, s), ROAD.h, ROAD.round))

export const robberGeo = memo(() => {
  const k = ROBBER.r / 9
  const pts = [
    [0, 0], [9, 0], [9.3, 1.4], [8.6, 3.6], [6.4, 6], [5.6, 10], [6.6, 15.5], [6, 19], [3.8, 20.6], [5.2, 22], [5.9, 24.6],
    [5.4, 27.4], [3.6, 29.3], [0, 30],
  ].map(([x, y]) => new Vector2(x * k, (y * ROBBER.h) / 30))
  return new LatheGeometry(pts, 32)
})

/** a die: a box with six faces (each its own material group), its edges pushed out to round corners */
export const dieGeo = memo(() => {
  const s = DICE.size
  const h = s / 2
  const r = DICE.round
  const g = new BoxGeometry(s, s, s, 6, 6, 6)
  const p = g.attributes.position
  const n = g.attributes.normal
  const v = new Vector3()
  const inner = new Vector3()
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i)
    inner.set(Math.max(-h + r, Math.min(h - r, v.x)), Math.max(-h + r, Math.min(h - r, v.y)), Math.max(-h + r, Math.min(h - r, v.z)))
    const dir = v.clone().sub(inner).normalize()
    v.copy(inner).addScaledVector(dir, r)
    p.setXYZ(i, v.x, v.y, v.z)
    n.setXYZ(i, dir.x, dir.y, dir.z)
  }
  return g
})

/** which value faces each box side (+x, -x, +y, -y, +z, -z); opposite faces add to 7 */
export const DIE_FACES = [2, 5, 1, 6, 3, 4]

/** the dice tray: a rounded wooden ring round a felt floor */
export const trayGeo = memo(() => {
  const { w, d, rim, h } = DICE.tray
  return slab((s) => {
    roundedRect(w, d, 8, s)
    s.holes.push(roundedRect(w - 2 * rim, d - 2 * rim, 5, new Path()))
    return s
  }, h, 1.2)
})
export const feltGeo = memo(() => {
  const { w, d, rim, felt } = DICE.tray
  return slab((s) => roundedRect(w - 2 * rim + 1, d - 2 * rim + 1, 5, s), felt, 0.3)
})

/** the maple frame round the sea (a flat-topped hexagonal ring) */
export const frameGeo = memo(() => {
  const outer = SEA.inner + SEA.rim
  return slab((s) => {
    roundedPolygon(flatHexPoints(outer - 2), 14, s)
    s.holes.push(roundedPolygon(flatHexPoints(SEA.inner), 10, new Path()))
    return s
  }, SEA.rimH, 2)
})

export const seaGeo = memo(() => {
  const g = slab((s) => roundedPolygon(flatHexPoints(SEA.inner + 4), 10, s), SEA.level, 0.5)
  return g
})

/** a little boat's hull, pointing along +x, its inside (the top) a separate group from its sides */
export const hullGeo = memo(() => {
  const { len: L, beam: B, h } = HARBOR.boat
  return slab((s) => roundedPolygon([P(-L / 2, -B / 2), P(L * 0.18, -B / 2), P(L / 2, 0), P(L * 0.18, B / 2), P(-L / 2, B / 2)], [1.5, 2.5, 1.2, 2.5, 1.5], s), h, 0.8)
})

/** a triangular sail, standing up, its face across the boat's length */
export const sailGeo = memo(() => upright([[0, 0], [10, 0], [0, 15]], 1, 0.35))
