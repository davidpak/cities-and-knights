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
function slab(outline: (s: Shape) => Shape, h: number, bevel: number, curve = 4) {
  const g = new ExtrudeGeometry(outline(new Shape()), {
    depth: Math.max(0.01, h - 2 * bevel),
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 2,
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
  for (let i = 1; i <= 3; i++) {
    const a = (i / 3) * (Math.PI / 2)
    pts.push(new Vector2(r - b + b * Math.cos(a), h - b + b * Math.sin(a)))
  }
  const side = new LatheGeometry(pts, 32)
  const top = new CircleGeometry(r - b, 32)
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

// ---------------------------------------------------------------- the pieces: wooden toys, each one solid piece
// A silhouette seen from the front (x across, y up, the base on y = 0) is sawn out and pushed back to its depth, and
// every edge sanded round: the way real wooden game pieces are made. The outline is pulled in by the rounding first,
// so the finished piece measures exactly what the spec says.

type Pt = [number, number]

/** the outline moved inward by d (counter-clockwise outline), corners mitred */
function inset(points: Pt[], d: number): Pt[] {
  const n = points.length
  return points.map((p, i) => {
    const a = points[(i - 1 + n) % n]
    const b = points[(i + 1) % n]
    const e1 = norm([p[0] - a[0], p[1] - a[1]])
    const e2 = norm([b[0] - p[0], b[1] - p[1]])
    // inward normals of the two edges (left of travel for a counter-clockwise outline)
    const n1: Pt = [-e1[1], e1[0]]
    const n2: Pt = [-e2[1], e2[0]]
    const m = norm([n1[0] + n2[0], n1[1] + n2[1]])
    const k = d / Math.max(0.2, m[0] * n1[0] + m[1] * n1[1])
    return [p[0] + m[0] * k, p[1] + m[1] * k]
  })
}
const norm = ([x, y]: Pt): Pt => {
  const l = Math.hypot(x, y) || 1
  return [x / l, y / l]
}

/** a silhouette sawn out and sanded: `points` counter-clockwise from the front, `depth` front to back, centred */
export function sawn(points: Pt[], depth: number, round: number) {
  const g = new ExtrudeGeometry(roundedPolygon(inset(points, round), round * 0.6, new Shape()), {
    depth: depth - 2 * round,
    bevelEnabled: true,
    bevelThickness: round,
    bevelSize: round,
    bevelSegments: 3,
    curveSegments: 3,
  })
  g.translate(0, 0, -(depth - 2 * round) / 2)
  g.clearGroups()
  g.computeVertexNormals()
  return g
}

/** a house: square walls under a steep gable (spec SETTLEMENT) */
export const SETTLEMENT_OUTLINE = (): Pt[] => {
  const { w, wall, peak } = SETTLEMENT
  return [[-w / 2, 0], [w / 2, 0], [w / 2, wall], [0, peak], [-w / 2, wall]]
}
/** a tall gabled hall on the left, a lower flat-topped wing on the right (spec CITY) */
export const CITY_OUTLINE = (): Pt[] => {
  const { w, hall, wall, peak, wing } = CITY
  const x0 = -w / 2
  const x1 = x0 + hall
  return [[x0, 0], [w / 2, 0], [w / 2, wing], [x1, wing], [x1, wall], [x0 + hall / 2, peak], [x0, wall]]
}

export const settlementGeo = memo(() => sawn(SETTLEMENT_OUTLINE(), SETTLEMENT.d, SETTLEMENT.round))
export const cityGeo = memo(() => sawn(CITY_OUTLINE(), CITY.d, CITY.round))
/** a road: a square bar along +x */
export const roadGeo = memo(() => {
  const g = slab((s) => roundedRect(ROAD.len - 2 * ROAD.round, ROAD.w - 2 * ROAD.round, ROAD.round * 0.6, s), ROAD.h, ROAD.round, 4)
  g.clearGroups()
  return g
})

/** the robber: a turned pawn, a broad foot, a waist, a round head */
export const ROBBER_PROFILE = (): Pt[] => {
  const k = ROBBER.r / 9
  return [
    [0, 0], [9, 0], [9.3, 1.4], [8.6, 3.6], [6.4, 6], [5.6, 10], [6.6, 15.5], [6, 19], [3.8, 20.6], [5.2, 22], [5.9, 24.6],
    [5.4, 27.4], [3.6, 29.3], [0, 30],
  ].map(([x, y]) => [x * k, (y * ROBBER.h) / 30] as Pt)
}
export const robberGeo = memo(() => new LatheGeometry(ROBBER_PROFILE().map(([x, y]) => new Vector2(x, y)), 20))

/** a die: a box with six faces (each its own material group), its edges pushed out to round corners */
export const dieGeo = memo(() => {
  const s = DICE.size
  const h = s / 2
  const r = DICE.round
  const g = new BoxGeometry(s, s, s, 4, 4, 4)
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

/** a rounded rectangular wooden rim, w by d outside, rim wide, h tall (one solid piece) */
export function rim(w: number, d: number, width: number, h: number, round = 3) {
  return slab((s) => {
    roundedRect(w, d, round + width / 2, s)
    s.holes.push(roundedRect(w - 2 * width, d - 2 * width, round, new Path()))
    return s
  }, h, 1)
}

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
