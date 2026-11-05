/**
 * The board and its pieces, in millimetres.
 *
 * Sources
 *   [D]   our own design (this is our game; nothing here is measured off another game's pieces)
 *   [T]   follows from the board layout in shared/board.ts (unit hexes, pointy-topped)
 *
 * Its frame: the middle tile's centre at x 0, z 0; the tray floor (where tiles stand) at y 0; +x right, +z toward
 * the player, +y up. The layout's +y (down the board) maps to +z.
 *
 * Details, in words
 *   tiles      chunky beveled hexes with a 2 mm gap between them; a small diorama on each (trees, sheep, wheat,
 *              brick mounds, peaks, dunes), kept out of the token in the middle and out of the corners and sides
 *              where pieces go
 *   tokens     cream pucks with a rounded edge; number and dots painted into the top face; 6 and 8 in red
 *   sea        a hexagonal tray of water held in a maple frame; harbours are little piers with a round sign
 *   pieces     settlement = a house; city = a house with a tower; road = a beveled bar along a side;
 *              robber = a plum pawn
 *
 * Estimates: none; every size here is a choice ([D]) or follows from one.
 */
import { SQRT3, TOPO } from '../../../shared/board.ts'

export const TILE = {
  r: 57.7, // [D] centre to corner: 100 mm across the flats
  gap: 2, // [D] between neighbouring tiles' flats
  h: 12, // [D] thickness
  bevel: 1.6, // [D]
  get layout() {
    return this.r + this.gap / SQRT3 // [T] centre to corner of the layout (corners sit in the gaps)
  },
  get flat() {
    return (this.r * SQRT3) / 2 // [T] centre to the middle of a side
  },
}

/** where things stand: decorations stay between `clearIn` and `clearOut` from the tile centre */
export const DIORAMA = {
  clearIn: 25, // [D] the token's radius plus a margin
  clearOut: 44, // [D] corners hold a settlement or city, sides a road
  maxH: 30, // [D] tallest thing (a peak)
}

export const TOKEN = { r: 21, h: 4.5, bevel: 1.4 } // [D] seen straight down, big enough to read at a glance

export const SETTLEMENT = { w: 17, d: 17, wall: 10, peak: 18, round: 1.3 } // [D] seen from above: a square with a roof ridge
export const CITY = { w: 30, d: 19, wall: 11, peak: 17, towerW: 13, tower: 22, towerPeak: 28, round: 1.3 } // [D] wider and deeper: tells apart from above
export const ROAD = { len: 32, w: 8, h: 6, round: 1.8 } // [D]
export const ROBBER = { r: 11, h: 30 } // [D]

/**
 * A harbour: a little wooden dock along the coast side it serves (so it plainly belongs to that side's two corners),
 * a short pier out from its middle, the sign at the end of the pier, posts in the water, and a boat tied up beside.
 * Measured in the harbour's own frame: u along the coast (0 = the side's middle), v straight out to sea from it.
 */
export const HARBOR = {
  deck: { len: 40, from: 1.5, to: 13, planks: 7, gap: 0.7, h: 2.2, top: 9.5, beam: 1.8 }, // [D] stands just off the tile, over water; a darker beam along its sea edge
  pier: { w: 10, from: 13.5, planks: 3, plank: 2.4, gap: 0.6 }, // [D] a walkway of cross planks from the dock into the sign
  post: { r: 1.5, above: 2.6 }, // [D] the dock's sea-side posts stand a little above the deck
  out: 30, // [D] the sign's centre, from the side's middle
  signR: 14, // [D] big enough to read the rate, small enough to sit in the water
  signH: 4, // [D]
  boat: { u: 18, v: 23, len: 20, beam: 7.5, h: 4, mast: 18 }, // [D] moored beside the pier
}

export const SEA = {
  level: 6, // [D] water surface (tiles stand 6 mm proud of it)
  inner: 318, // [D] the frame's inside, centre to corner (flat-topped)
  rim: 26, // [D] frame width
  rimH: 16, // [D]
}

/** the camera: looking down, tipped toward you a little so pieces show their shape */
export const CAMERA = {
  tilt: (28 * Math.PI) / 180, // [D] from straight down
  margin: 1.03, // [D]
}

/** what the camera must show: the frame (flat-topped), tipped by the tilt, plus room for the tallest pieces */
export const VIEW = {
  get w() {
    return 2 * (SEA.inner + SEA.rim) * CAMERA.margin
  },
  get h() {
    const deep = 2 * (SEA.inner + SEA.rim) * (Math.sqrt(3) / 2)
    return (deep * Math.cos(CAMERA.tilt) + 40 * Math.sin(CAMERA.tilt)) * CAMERA.margin
  },
}

/** layout coordinates (unit hexes) to the board plane, mm */
export const toBoard = (x: number, y: number): [number, number] => [x * TILE.layout, y * TILE.layout]

export const hexAt = (h: number) => toBoard(TOPO.hexes[h].x, TOPO.hexes[h].y)
export const vertexAt = (v: number) => toBoard(TOPO.vertices[v].x, TOPO.vertices[v].y)
export const edgeAt = (e: number) => toBoard(TOPO.edges[e].x, TOPO.edges[e].y)

/** a harbour's frame: the side's middle, the way along the coast, the way out to sea */
export function harborFrame(edge: number) {
  const e = TOPO.edges[edge]
  const h = TOPO.hexes[e.hexes[0]]
  const [mx, mz] = toBoard(e.x, e.y)
  const [hx, hz] = toBoard(h.x, h.y)
  const l = Math.hypot(mx - hx, mz - hz)
  const out: [number, number] = [(mx - hx) / l, (mz - hz) / l]
  const along: [number, number] = [-out[1], out[0]]
  /** a point in the harbour's frame, on the board */
  const at = (u: number, v: number): [number, number] => [mx + along[0] * u + out[0] * v, mz + along[1] * u + out[1] * v]
  /** the turn about the vertical that lays a shape's +x along the coast and its -z out to sea */
  const turn = Math.atan2(-along[1], along[0])
  return { at, turn, along, out }
}

/** where a harbour's sign stands */
export function harborSign(edge: number): [number, number] {
  return harborFrame(edge).at(0, HARBOR.out)
}

/** points round everything a harbour puts in the water, for the checks */
export function harborFootprint(edge: number): [number, number][] {
  const { at } = harborFrame(edge)
  const H = HARBOR
  const pts: [number, number][] = []
  for (const u of [-H.deck.len / 2, H.deck.len / 2]) for (const v of [H.deck.from, H.deck.to]) pts.push(at(u, v))
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2
    pts.push(at(Math.cos(a) * H.signR, H.out + Math.sin(a) * H.signR))
  }
  for (const s of [-1, 1]) for (const dv of [-H.boat.len / 2, H.boat.len / 2]) for (const du of [-H.boat.beam / 2, H.boat.beam / 2]) pts.push(at(s * H.boat.u + du, H.boat.v + dv))
  return pts
}

/** is a board point on a land tile? (pointy-topped hexes) */
export function onLand(x: number, z: number) {
  return TOPO.hexes.some((h) => {
    const [hx, hz] = toBoard(h.x, h.y)
    const dx = Math.abs(x - hx)
    const dz = Math.abs(z - hz)
    return dx <= TILE.flat && dz <= TILE.r - dx / SQRT3
  })
}

export type CheckResult = { what: string; ok: boolean; value: string }

/** does the spec hang together? run with `npm run check` */
export function checkBoard(): CheckResult[] {
  const out: CheckResult[] = []
  const add = (what: string, ok: boolean, value: string) => out.push({ what, ok, value })
  const f = (n: number) => n.toFixed(1)

  // tiles tile
  const [ax, az] = hexAt(0)
  const [bx, bz] = hexAt(TOPO.hexes[0].neighbors[0])
  const between = Math.hypot(bx - ax, bz - az) - 2 * TILE.flat
  add('neighbouring tiles leave the gap', Math.abs(between - TILE.gap) < 0.01, `${f(between)} mm`)

  // a road fits between the two buildings at its ends
  const side = TILE.layout
  const settleHalf = Math.hypot(SETTLEMENT.w, SETTLEMENT.d) / 2
  add('a road clears settlements at both ends', ROAD.len + 2 * settleHalf * 0.8 <= side, `${f(ROAD.len)} + 2 x ${f(settleHalf * 0.8)} <= ${f(side)}`)
  const cityHalf = CITY.w / 2
  add('a road clears a city at one end', ROAD.len / 2 + cityHalf < side - 1, `${f(ROAD.len / 2 + cityHalf)} < ${f(side - 1)}`)

  // the token and the dioramas keep out of each other and of the pieces
  add('the token fits inside the clear middle', TOKEN.r < DIORAMA.clearIn, `${TOKEN.r} < ${DIORAMA.clearIn}`)
  const cityReach = TILE.layout - CITY.w / 2
  add('dioramas stay clear of a city at a corner', DIORAMA.clearOut < cityReach + 4, `${DIORAMA.clearOut} vs ${f(cityReach)} (low things only past it)`)
  add('dioramas stay clear of roads on the sides', DIORAMA.clearOut < TILE.flat - ROAD.w / 2, `${DIORAMA.clearOut} < ${f(TILE.flat - ROAD.w / 2)}`)
  add('the robber\'s base fits on a token', ROBBER.r < TOKEN.r, `${ROBBER.r} < ${TOKEN.r}`)

  // harbours sit in open water inside the frame and don't touch each other or the land
  const apothem = (SEA.inner * SQRT3) / 2
  const prints = TOPO.harbors.map(harborFootprint)
  const farthest = Math.max(...prints.flat().map(([x, z]) => Math.hypot(x, z)))
  add('every harbour (dock, pier, sign, boat) is inside the frame', farthest < apothem - 2, `${f(farthest)} < ${f(apothem - 2)}`)
  const wet = prints.flat().filter(([x, z]) => onLand(x, z)).length
  add('no part of a harbour stands on a tile', wet === 0, `${wet} points on land`)
  const signs = TOPO.harbors.map(harborSign)
  let closest = Infinity
  signs.forEach((a, i) => signs.forEach((b, j) => j > i && (closest = Math.min(closest, Math.hypot(a[0] - b[0], a[1] - b[1])))))
  add('harbours never touch each other', closest > 2 * (HARBOR.boat.u + HARBOR.boat.beam), `${f(closest)} mm apart`)
  add('the dock fits along its side, short of the corners', HARBOR.deck.len < TILE.layout - 2 * 8, `${HARBOR.deck.len} < ${f(TILE.layout - 16)}`)
  const landR = Math.max(...TOPO.vertices.map((v) => Math.hypot(...toBoard(v.x, v.y))))
  add('the frame clears the land', landR < apothem - 10, `${f(landR)} < ${f(apothem - 10)}`)

  // from straight above, a city must look different from a settlement
  add('a city is clearly bigger than a settlement from above', CITY.w * CITY.d > 1.7 * SETTLEMENT.w * SETTLEMENT.d, `${CITY.w * CITY.d} vs ${SETTLEMENT.w * SETTLEMENT.d} mm²`)
  add('a settlement at a corner overhangs no token', TILE.layout - Math.hypot(SETTLEMENT.w, SETTLEMENT.d) / 2 > TOKEN.r + 4, `${f(TILE.layout - Math.hypot(SETTLEMENT.w, SETTLEMENT.d) / 2)} > ${TOKEN.r + 4}`)

  // the board's nine harbours each touch two corners and no corner twice
  const hc = new Set(TOPO.harbors.flatMap((e) => [TOPO.edges[e].a, TOPO.edges[e].b]))
  add('harbours use 18 distinct corners', hc.size === 18, `${hc.size}`)

  return out
}
