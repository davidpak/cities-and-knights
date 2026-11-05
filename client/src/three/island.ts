/**
 * The whole island as two meshes: everything coloured (tiles, trees, sheep, wheat, bricks, peaks, dunes, frame,
 * sea, piers, token rims) merged into one geometry with vertex colours, and every painted face (token tops,
 * harbour signs) merged into one geometry on the atlas. Two draw calls for the board, however busy it looks.
 *
 * Built once per board (tiles and harbours never change during a game). Decorations come from a seed per tile, so
 * every player sees the same island and it looks the same after a reload.
 */
import {
  BoxGeometry, BufferGeometry, CircleGeometry, Color, ConeGeometry, CylinderGeometry, Float32BufferAttribute, Matrix4,
  Quaternion, SphereGeometry, Vector3,
} from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { Harbor, Tile } from '../../../shared/engine.ts'
import type { Terrain } from '../../../shared/rules.ts'
import { PAL, TERRAIN } from '../lib/palette.ts'
import { atlasUV, cellOf } from './atlas.ts'
import { frameGeo, hullGeo, sailGeo, seaGeo, signGeo, tileGeo, tokenGeo } from './geometry.ts'
import { DIORAMA, HARBOR, SEA, TILE, TOKEN, harborFrame, hexAt, pierLine } from './spec.ts'

const UNIT = {
  // (a box is centred; cones and cylinders stand on y 0)
  cone: new ConeGeometry(1, 1, 8, 1).translate(0, 0.5, 0),
  peak: new ConeGeometry(1, 1, 7, 1).translate(0, 0.5, 0),
  cyl: new CylinderGeometry(1, 1, 1, 8).translate(0, 0.5, 0),
  ball: new SphereGeometry(1, 12, 8),
  brick: new BoxGeometry(1, 1, 1),
}

const UP = new Vector3(0, 1, 0)
/** a transform: where, how big, turned how far about the vertical */
function at(x: number, y: number, z: number, s: number | [number, number, number] = 1, turn = 0) {
  const sc = typeof s === 'number' ? new Vector3(s, s, s) : new Vector3(...s)
  return new Matrix4().compose(new Vector3(x, y, z), new Quaternion().setFromAxisAngle(UP, turn), sc)
}

class Builder {
  private parts: BufferGeometry[] = []
  /** adds a copy of geo, moved by m, coloured (one colour, or one per material group) */
  add(geo: BufferGeometry, color: string | string[], m: Matrix4) {
    const g = geo.index ? geo.toNonIndexed() : geo.clone()
    g.applyMatrix4(m)
    const out = new BufferGeometry()
    out.setAttribute('position', g.attributes.position)
    out.setAttribute('normal', g.attributes.normal)
    const n = g.attributes.position.count
    const col = new Float32Array(n * 3)
    const paint = (from: number, count: number, hex: string) => {
      const c = new Color(hex)
      for (let i = from; i < from + count && i < n; i++) col.set([c.r, c.g, c.b], i * 3)
    }
    if (Array.isArray(color) && g.groups.length) for (const gr of g.groups) paint(gr.start, gr.count, color[gr.materialIndex ?? 0] ?? color[0])
    else paint(0, n, Array.isArray(color) ? color[0] : color)
    out.setAttribute('color', new Float32BufferAttribute(col, 3))
    this.parts.push(out)
  }
  build() {
    return mergeGeometries(this.parts)!
  }
}

function seeded(seed: number) {
  let t = seed * 7919 + 13
  return () => {
    t = (t + 0x6d2b79f5) | 0
    let x = Math.imul(t ^ (t >>> 15), t | 1)
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61)
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296
  }
}

/** n spots in the ring between the token and the pieces, spread round it */
function ring(n: number, rnd: () => number, rIn = DIORAMA.clearIn + 4, rOut = DIORAMA.clearOut - 6) {
  const start = rnd() * Math.PI * 2
  return Array.from({ length: n }, (_, i) => {
    const a = start + (i / n) * Math.PI * 2 + (rnd() - 0.5) * 0.5
    const r = rIn + rnd() * (rOut - rIn)
    return { x: Math.cos(a) * r, z: Math.sin(a) * r, a, s: 0.85 + rnd() * 0.3 }
  })
}

/** what stands on one tile, at its centre (cx, cz), on its top (y) */
function decorate(b: Builder, terrain: Terrain, seed: number, cx: number, cz: number) {
  const y = TILE.h
  const c = TERRAIN[terrain]
  const rnd = seeded(seed)
  const put = (geo: BufferGeometry, color: string, local: Matrix4, group = new Matrix4()) =>
    b.add(geo, color, new Matrix4().multiplyMatrices(at(cx, y, cz), group).multiply(local))

  switch (terrain) {
    case 'forest':
      ring(7, rnd).forEach((p, i) => {
        const g = at(p.x, 0, p.z, p.s)
        put(UNIT.cyl, c.c, at(0, 0, 0, [2, 6, 2]), g)
        put(UNIT.cone, i % 2 ? c.a : c.b, at(0, 4.5, 0, [9, 13, 9]), g)
        put(UNIT.cone, i % 2 ? c.a : c.b, at(0, 11, 0, [6.6, 11, 6.6]), g)
      })
      break
    case 'pasture': {
      ring(3, rnd).forEach((p) => {
        const g = at(p.x, 0, p.z, p.s, -p.a)
        for (const [lx, lz] of [[-3, -2], [-3, 2], [3, -2], [3, 2]]) put(UNIT.cyl, c.b, at(lx, 0, lz, [1.1, 4.5, 1.1]), g)
        put(UNIT.ball, c.a, at(0, 7.5, 0, [7.2, 5, 5.2]), g)
        put(UNIT.ball, c.b, at(8, 8.6, 0, [3.2, 2.5, 2.3]), g)
      })
      ring(6, rnd).forEach((p) => {
        const g = at(p.x, 0, p.z, p.s)
        ;[[-1.6, 0], [1.4, 0.6], [0, -1.5]].forEach(([dx, dz], j) => put(UNIT.cone, c.c, at(dx, 0, dz, [1.6, 5 + j, 1.6]), g))
      })
      break
    }
    case 'fields':
      ring(12, rnd, DIORAMA.clearIn + 3, DIORAMA.clearOut - 3).forEach((p, i) => {
        const g = at(p.x, 0, p.z, p.s)
        put(UNIT.cyl, i % 2 ? c.a : c.b, at(0, 0, 0, [2.6, 9, 2.6]), g)
        put(UNIT.cyl, c.c, at(0, 4, 0, [2.75, 1.2, 2.75]), g)
        put(UNIT.cone, i % 2 ? c.a : c.b, at(0, 9, 0, [3.4, 6, 3.4]), g)
      })
      break
    case 'hills': {
      const mounds = ring(3, rnd)
      mounds.forEach((p) => put(UNIT.ball, c.b, at(p.x, 0, p.z, [11 * p.s, 7 * p.s, 9 * p.s])))
      ring(2, rnd).forEach((p, i) => {
        const g = at((p.x + mounds[i].x) / 2, 0, (p.z + mounds[i].z) / 2, 1, p.a)
        ;[[-3.3, 0], [3.3, 0], [0, 1]].forEach(([bx, row], j) => put(UNIT.brick, j === 2 ? c.c : c.a, at(bx, 1.8 + row * 3.6, 0, [6.2, 3.4, 3.6]), g))
      })
      break
    }
    case 'mountains': {
      const sizes = [[13, 28], [10.5, 21], [9, 17]]
      ring(3, rnd, DIORAMA.clearIn + 7, DIORAMA.clearOut - 9).forEach((p, i) => {
        const [r, h] = sizes[i]
        const g = at(p.x, 0, p.z, 1, p.a)
        put(UNIT.peak, i % 2 ? c.b : c.a, at(0, 0, 0, [r, h, r]), g)
        put(UNIT.peak, c.c, at(0, h * 0.64, 0, [r * 0.38, h * 0.37, r * 0.38]), g) // snow, just outside the rock
      })
      ring(4, rnd).forEach((p) => put(UNIT.ball, c.a, at(p.x, 0, p.z, [3.2 * p.s, 2.4 * p.s, 2.8 * p.s])))
      break
    }
    case 'desert': {
      const dunes = ring(3, rnd)
      dunes.forEach((p) => put(UNIT.ball, c.a, at(p.x, 0, p.z, [13 * p.s, 4.5 * p.s, 7 * p.s], p.a)))
      const k = ring(1, rnd)[0]
      const g = at((k.x + dunes[0].x) / 2, 0, (k.z + dunes[0].z) / 2)
      put(UNIT.cyl, c.b, at(0, 0, 0, [2.4, 14, 2.4]), g)
      put(UNIT.ball, c.b, at(0, 14, 0, 2.4), g)
      put(UNIT.cyl, c.b, at(3.6, 6, 0, [1.7, 5, 1.7]), g)
      put(UNIT.ball, c.b, at(3.6, 11, 0, 1.7), g)
      break
    }
  }
}

const WOOD = ['#e3b384', '#d6a473'] // deck planks, alternating
const POST = '#8a5e3c'

/** two short piers out from the side's two corners, meeting at the sign; a boat tied up beside */
function harbor(b: Builder, pictures: BufferGeometry[], h: Harbor, n: number, sign: { side: BufferGeometry }) {
  const H = HARBOR
  const P = H.pier
  const { at: on, along, out } = harborFrame(h.edge)
  const outTurn = Math.atan2(-out[1], out[0])
  for (const side of [-1, 1] as const) {
    const { start, d, len } = pierLine(side)
    // the pier's way in board coordinates, and the turn that lays a shape's +x along it
    const wx = along[0] * d[0] + out[0] * d[1]
    const wz = along[1] * d[0] + out[1] * d[1]
    const turn = Math.atan2(-wz, wx)
    const n: [number, number] = [-d[1], d[0]] // across the pier, in the harbour's frame
    const put = (t: number, k: number, sx: number, sz: number, top: number, hgt: number, color: string) => {
      const [x, z] = on(start[0] + d[0] * t + n[0] * k, start[1] + d[1] * t + n[1] * k)
      b.add(UNIT.brick, color, at(x, top - hgt / 2, z, [sx, hgt, sz], turn))
    }
    const post = (t: number, k: number) => {
      const [x, z] = on(start[0] + d[0] * t + n[0] * k, start[1] + d[1] * t + n[1] * k)
      b.add(UNIT.cyl, POST, at(x, 0, z, [H.post.r, P.top + 1.2, H.post.r]))
    }
    // cross planks, side by side down its length
    const count = Math.max(1, Math.round((len + P.gap) / (P.plank + P.gap)))
    const step = len / count
    for (let i = 0; i < count; i++) put(step * (i + 0.5), 0, step - P.gap, P.w, P.top, P.h, WOOD[i % 2])
    // a darker beam down each side, and posts at both ends
    for (const k of [-1, 1]) {
      put(len / 2, k * (P.w / 2 + P.rail / 2), len, P.rail, P.top - 0.5, P.h, POST)
      post(0.8, k * (P.w / 2 + P.rail / 2))
      post(len - (H.signR - P.into) * 0.15, k * (P.w / 2 + P.rail / 2))
    }
  }
  // the sign, its face level with the piers
  const [sx, sz] = on(0, H.out)
  b.add(sign.side, PAL.creamDeep, at(sx, P.top + 0.3 - H.signH, sz))
  pictures.push(pictureDisc(H.signR - 1.2, cellOf({ harbor: h.kind })).translate(sx, P.top + 0.3, sz))
  // a boat beside the sign, one side or the other, sitting in the water
  const side = n % 2 ? 1 : -1
  const [bx, bz] = on(side * H.boat.u, H.boat.v)
  const hullAt = at(bx, SEA.level - 1.2, bz, 1, outTurn)
  b.add(hullGeo(), ['#d6a473', '#f4efe6'], hullAt) // wooden inside, white sides
  b.add(UNIT.cyl, POST, new Matrix4().multiplyMatrices(hullAt, at(-1, 1, 0, [0.6, H.boat.mast, 0.6])))
  b.add(sailGeo(), '#ffffff', new Matrix4().multiplyMatrices(hullAt, at(-0.4, 3.2, 0)))
}

/** a disc whose uvs point at one picture in the atlas */
function pictureDisc(r: number, cell: number) {
  const g = new CircleGeometry(r, 40)
  const uv = g.attributes.uv
  for (let i = 0; i < uv.count; i++) {
    const [u, v] = atlasUV(cell, uv.getX(i), uv.getY(i))
    uv.setXY(i, u, v)
  }
  g.rotateX(-Math.PI / 2)
  return g
}

export function buildIsland(tiles: Tile[], harbors: Harbor[]) {
  const b = new Builder()
  const pictures: BufferGeometry[] = []

  b.add(seaGeo(), PAL.sea, new Matrix4())
  b.add(frameGeo(), [PAL.maple, PAL.mapleDeep], new Matrix4())

  const tok = tokenGeo()
  tiles.forEach((t, i) => {
    const [x, z] = hexAt(i)
    b.add(tileGeo(), [TERRAIN[t.terrain].top, TERRAIN[t.terrain].side], at(x, 0, z))
    decorate(b, t.terrain, i * 31 + t.terrain.length, x, z)
    if (t.number !== null) {
      b.add(tok.side, PAL.creamDeep, at(x, TILE.h, z))
      pictures.push(pictureDisc(TOKEN.r - TOKEN.bevel, cellOf({ number: t.number })).translate(x, TILE.h + TOKEN.h, z))
    }
  })

  const sign = signGeo()
  harbors.forEach((h, n) => harbor(b, pictures, h, n, sign))

  const painted = mergeGeometries(pictures.map((g) => {
    const out = new BufferGeometry()
    out.setAttribute('position', g.attributes.position)
    out.setAttribute('normal', g.attributes.normal)
    out.setAttribute('uv', g.attributes.uv)
    out.setIndex(g.index)
    return out
  }))!
  return { colored: b.build(), painted }
}
