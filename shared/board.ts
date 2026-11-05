/**
 * The board's layout, generated (never hand-written): 19 land hexes in rows of 3-4-5-4-3, their 54 corners and
 * 72 sides, and the 9 harbours on the coast.
 *
 * Its frame: unit hexes (centre to corner = 1), pointy-topped, the middle hex at x 0, y 0. +x is to the right and +y
 * is toward the bottom of the board (the client maps +y onto +z, toward the camera).
 *
 * Everything here is a pure function of the shape, so the server and every client always agree on which corner is
 * which. Ids are array indices, in a fixed order (hexes by row then column; corners and sides top to bottom, then
 * left to right).
 */

export const SQRT3 = Math.sqrt(3)

export type Hex = {
  q: number
  r: number
  x: number
  y: number
  /** the land hexes that share a side with it */
  neighbors: number[]
  /** its six corners, clockwise from the top one */
  vertices: number[]
  /** its six sides, clockwise from the top-right one (side i joins corner i and i+1) */
  edges: number[]
}

export type Vertex = { x: number; y: number; hexes: number[]; neighbors: number[]; edges: number[] }
export type Edge = { a: number; b: number; hexes: number[]; x: number; y: number; /** radians, in the board plane */ angle: number }

export type Topology = {
  hexes: Hex[]
  vertices: Vertex[]
  edges: Edge[]
  /** the sides with land on one side only, in order round the coast (clockwise from the top) */
  coast: number[]
  /** the coast sides that carry a harbour */
  harbors: number[]
}

/** row lengths, top to bottom */
export const ROWS = [3, 4, 5, 4, 3]

const corner = (i: number): [number, number] => {
  const a = (Math.PI / 3) * i
  return [Math.sin(a), -Math.cos(a)]
}

function build(): Topology {
  // hexes: axial coordinates within radius 2, row by row
  const hexes: Hex[] = []
  for (let r = -2; r <= 2; r++) {
    for (let q = Math.max(-2, -2 - r); q <= Math.min(2, 2 - r); q++) {
      hexes.push({ q, r, x: SQRT3 * (q + r / 2), y: 1.5 * r, neighbors: [], vertices: [], edges: [] })
    }
  }
  const byAxial = new Map(hexes.map((h, i) => [`${h.q},${h.r}`, i]))
  const dirs = [
    [1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1],
  ]
  hexes.forEach((h) => {
    for (const [dq, dr] of dirs) {
      const n = byAxial.get(`${h.q + dq},${h.r + dr}`)
      if (n !== undefined) h.neighbors.push(n)
    }
    h.neighbors.sort((a, b) => a - b)
  })

  // corners, deduplicated by position
  const key = (x: number, y: number) => `${Math.round(x * 1000)},${Math.round(y * 1000)}`
  const raw = new Map<string, { x: number; y: number; hexes: number[] }>()
  hexes.forEach((h, hi) => {
    for (let i = 0; i < 6; i++) {
      const [cx, cy] = corner(i)
      const x = h.x + cx
      const y = h.y + cy
      const k = key(x, y)
      if (!raw.has(k)) raw.set(k, { x, y, hexes: [] })
      raw.get(k)!.hexes.push(hi)
    }
  })
  const sorted = [...raw.entries()].sort(([, a], [, b]) => (Math.abs(a.y - b.y) > 1e-6 ? a.y - b.y : a.x - b.x))
  const vIndex = new Map(sorted.map(([k], i) => [k, i]))
  const vertices: Vertex[] = sorted.map(([, v]) => ({ x: v.x, y: v.y, hexes: v.hexes.sort((a, b) => a - b), neighbors: [], edges: [] }))

  hexes.forEach((h) => {
    for (let i = 0; i < 6; i++) {
      const [cx, cy] = corner(i)
      h.vertices.push(vIndex.get(key(h.x + cx, h.y + cy))!)
    }
  })

  // sides
  const eRaw = new Map<string, { a: number; b: number; hexes: number[] }>()
  hexes.forEach((h, hi) => {
    for (let i = 0; i < 6; i++) {
      const a = Math.min(h.vertices[i], h.vertices[(i + 1) % 6])
      const b = Math.max(h.vertices[i], h.vertices[(i + 1) % 6])
      const k = `${a}-${b}`
      if (!eRaw.has(k)) eRaw.set(k, { a, b, hexes: [] })
      eRaw.get(k)!.hexes.push(hi)
    }
  })
  const eSorted = [...eRaw.entries()]
    .map(([k, e]) => {
      const va = vertices[e.a]
      const vb = vertices[e.b]
      return { k, ...e, x: (va.x + vb.x) / 2, y: (va.y + vb.y) / 2, angle: Math.atan2(vb.y - va.y, vb.x - va.x) }
    })
    .sort((a, b) => (Math.abs(a.y - b.y) > 1e-6 ? a.y - b.y : a.x - b.x))
  const eIndex = new Map(eSorted.map((e, i) => [e.k, i]))
  const edges: Edge[] = eSorted.map((e) => ({ a: e.a, b: e.b, hexes: e.hexes.sort((x, y) => x - y), x: e.x, y: e.y, angle: e.angle }))

  hexes.forEach((h) => {
    for (let i = 0; i < 6; i++) {
      const a = Math.min(h.vertices[i], h.vertices[(i + 1) % 6])
      const b = Math.max(h.vertices[i], h.vertices[(i + 1) % 6])
      h.edges.push(eIndex.get(`${a}-${b}`)!)
    }
  })
  edges.forEach((e, ei) => {
    vertices[e.a].edges.push(ei)
    vertices[e.b].edges.push(ei)
    vertices[e.a].neighbors.push(e.b)
    vertices[e.b].neighbors.push(e.a)
  })
  vertices.forEach((v) => {
    v.edges.sort((a, b) => a - b)
    v.neighbors.sort((a, b) => a - b)
  })

  // the coast, clockwise from straight up (angle measured from -y toward +x)
  const bearing = (x: number, y: number) => {
    const t = Math.atan2(x, -y)
    return t < -1e-9 ? t + 2 * Math.PI : t
  }
  const coast = edges
    .map((e, i) => ({ i, e }))
    .filter(({ e }) => e.hexes.length === 1)
    .sort((a, b) => bearing(a.e.x, a.e.y) - bearing(b.e.x, b.e.y))
    .map(({ i }) => i)

  // nine harbours: gaps of 2, 2, 3 coast sides between them, three times round
  const harbors: number[] = []
  let at = 0
  for (let i = 0; i < 9; i++) {
    harbors.push(coast[at])
    at += [3, 3, 4][i % 3]
  }

  return { hexes, vertices, edges, coast, harbors }
}

export const TOPO: Topology = build()

/** the side joining two corners, if they are neighbours */
export function edgeBetween(a: number, b: number): number | undefined {
  return TOPO.vertices[a].edges.find((e) => {
    const ed = TOPO.edges[e]
    return (ed.a === a && ed.b === b) || (ed.a === b && ed.b === a)
  })
}

/** the direction a harbour faces (out to sea), as a unit vector in the board plane */
export function harborOutward(edge: number): [number, number] {
  const e = TOPO.edges[edge]
  const h = TOPO.hexes[e.hexes[0]]
  const dx = e.x - h.x
  const dy = e.y - h.y
  const l = Math.hypot(dx, dy)
  return [dx / l, dy / l]
}
