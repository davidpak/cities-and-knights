/**
 * The expansion's two table pieces, as shapes: the barbarians' longship (and a watchtower), and the city tracks' flip
 * charts. Built once, from parts, in millimetres.
 *
 *   longship    a long low hull, narrowing to both ends and rising at them, a curled prow and stern, a mast and a
 *               square sail braced at an angle (so it shows from above), a row of round shields down each side
 *   watchtower  a tapered tower with a pointed cap, in the town at the barbarians' landing
 *   flip chart  a wooden A-frame stand with spiral rings across its top; its pages hang down the front, one per
 *               level, and go over the top when you take the next step
 */
import {
  BoxGeometry, BufferGeometry, CatmullRomCurve3, CylinderGeometry, Matrix4, PlaneGeometry, TorusGeometry, TubeGeometry, Vector3,
} from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

const memo = <T>(f: () => T) => {
  let v: T | undefined
  return () => (v ??= f())
}
/** position and normal only, so different parts merge */
function plain(g: BufferGeometry) {
  const n = g.index ? g.toNonIndexed() : g
  const out = new BufferGeometry()
  out.setAttribute('position', n.attributes.position)
  out.setAttribute('normal', n.attributes.normal)
  out.setAttribute('uv', n.attributes.uv ?? n.attributes.position)
  return out
}

// ---------------------------------------------------------------- the longship (along +x, its keel on y 0)

export const SHIP = { len: 42, beam: 11, depth: 7 } // [D]

export const hullGeo = memo(() => {
  const { len, beam, depth } = SHIP
  const g = new BoxGeometry(len, depth, beam, 20, 2, 4)
  const p = g.attributes.position
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i)
    const y = p.getY(i)
    const z = p.getZ(i)
    const u = x / (len / 2)
    // narrow to a point at both ends, and narrower toward the keel; the ends sweep up
    const w = Math.max(0.06, 1 - u * u * 0.94) * (y < 0 ? 0.55 : 1)
    p.setXYZ(i, x, y + depth / 2 + 4.2 * u ** 4 + (y < 0 ? 0.6 * (1 - u * u) : 0), z * w)
  }
  g.computeVertexNormals()
  // the curled prow and stern
  const curl = (s: number, k: number) =>
    new TubeGeometry(
      new CatmullRomCurve3([
        new Vector3((s * len) / 2 - s * 1, depth + 3.5, 0),
        new Vector3((s * len) / 2 + s * 1.6, depth + 8 * k, 0),
        new Vector3((s * len) / 2 + s * 0.4, depth + 12 * k, 0),
        new Vector3((s * len) / 2 - s * 1.8, depth + 11 * k, 0),
      ]),
      14,
      1.3,
      6,
    )
  const mast = new CylinderGeometry(0.7, 0.8, 22, 8).translate(0, depth + 10, 0)
  const yard = new CylinderGeometry(0.45, 0.45, 20, 6).rotateX(Math.PI / 2).rotateY(0.7).translate(0, depth + 19.5, 0)
  return mergeGeometries([plain(g), plain(curl(1, 1)), plain(curl(-1, 0.8)), plain(mast), plain(yard)])!
})

/** the square sail, braced at an angle and filled by the wind (its stripes are painted) */
export const sailGeo = memo(() => {
  const g = new PlaneGeometry(19, 13, 8, 6)
  const p = g.attributes.position
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i)
    const y = p.getY(i)
    // a belly: deepest in the middle
    p.setZ(i, 2.6 * (1 - (x / 9.5) ** 2) * (1 - ((y + 1) / 7.5) ** 2))
  }
  g.computeVertexNormals()
  // facing +x (forward), turned on the mast, hung below the yard
  return g.rotateY(Math.PI / 2 + 0.7).translate(0.4, SHIP.depth + 12.5, 0)
})

/** one shield: a flat round boss, facing +z */
export const shieldGeo = memo(() => new CylinderGeometry(2.3, 2.3, 0.8, 12).rotateX(Math.PI / 2))
/** where the shields hang: down both sides along the gunwale, facing out */
export function shieldSpots() {
  const out: { x: number; y: number; z: number; side: 1 | -1 }[] = []
  for (const side of [1, -1] as const)
    for (let i = 0; i < 6; i++) {
      const x = -12.5 + i * 5
      const u = x / (SHIP.len / 2)
      out.push({ x, y: SHIP.depth - 1.2 + 4.2 * u ** 4, z: side * ((SHIP.beam / 2) * (1 - u * u * 0.94) + 0.45), side })
    }
  return out
}

// ---------------------------------------------------------------- the town at the barbarians' landing

/** a watchtower: a tapered tower with a pointed cap */
export const towerGeo = memo(() =>
  mergeGeometries([
    plain(new CylinderGeometry(2.6, 3.4, 15, 8).translate(0, 7.5, 0)),
    plain(new CylinderGeometry(0, 4, 5.5, 8).translate(0, 17.7, 0)),
  ])!,
)
// ---------------------------------------------------------------- flip charts

/** a flip chart's stand: two boards meeting at the top (the front leans back so its page faces you) */
export const CHART = { w: 50, leg: 56, lean: (54 * Math.PI) / 180, board: 2.4, page: { w: 44, h: 48 } } // [D]
export const chartTop = () => CHART.leg * Math.sin(CHART.lean)
export const chartGeo = memo(() => {
  const { w, leg, lean, board } = CHART
  const top = chartTop()
  const half = (leg * Math.cos(lean)) / 2
  const front = new BoxGeometry(w, leg, board).applyMatrix4(new Matrix4().makeRotationX(-(Math.PI / 2 - lean))).translate(0, top / 2, half)
  const back = new BoxGeometry(w * 0.92, leg, board).applyMatrix4(new Matrix4().makeRotationX(Math.PI / 2 - lean)).translate(0, top / 2, -half)
  return mergeGeometries([plain(front), plain(back)])!
})
/** the spiral rings across the top */
export const ringGeo = memo(() => {
  const parts: BufferGeometry[] = []
  for (let i = 0; i < 5; i++) parts.push(plain(new TorusGeometry(2.6, 0.55, 6, 12).rotateY(Math.PI / 2).translate(-16 + i * 8, chartTop() + 0.4, 0)))
  return mergeGeometries(parts)!
})
/** a page: hinged at its top edge (the origin), hanging down -y, facing +z */
export const pageGeo = memo(() => new PlaneGeometry(CHART.page.w, CHART.page.h).translate(0, -CHART.page.h / 2 - 2.4, 0))
