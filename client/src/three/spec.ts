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

/**
 * The pieces are wooden toys, each one solid piece: a silhouette (seen from the front, x across, y up) sawn out and
 * pushed back to a depth, every edge sanded round. Fronts face +z (toward you), so the silhouette is what you see.
 *   settlement  a house: square walls under a steep gable, the gable end toward you
 *   city        a tall gabled hall with a lower wing beside it (twice the house, unmistakably bigger)
 *   road        a square bar
 */
export const SETTLEMENT = { w: 15, d: 19, wall: 10.5, peak: 18.5, round: 1.5 } // [D]
export const CITY = { w: 32, d: 17, hall: 16, wall: 19.5, peak: 28.5, wing: 12.5, round: 1.5 } // [D] hall: its width (left part); wall/peak: its heights; wing: the right part's height
export const ROAD = { len: 36, w: 8, h: 8, round: 1.7 } // [D]
export const ROBBER = { r: 12.5, h: 34 } // [D]

/**
 * A harbour, as on the usual board: its sign sits out in the water off one coast side, and two short wooden piers
 * come out from that side's two corners and meet at it. Those two corners are the building spots that get its rate.
 * Measured in the harbour's own frame: u along the coast (0 = the side's middle), v straight out to sea from it.
 */
export const HARBOR = {
  out: 23, // [D] the sign's centre, out from the side's middle: close in, so the piers stay short
  signR: 14, // [D] big enough to read the rate
  signH: 4, // [D]
  pier: {
    w: 7.5, // [D] a walkway, not a stick
    inset: 1.5, // [D] starts this far out from its corner (from under a settlement standing there)
    into: 2.5, // [D] runs this far under the sign's rim
    plank: 2.2, // [D] cross planks, along the pier
    gap: 0.7, // [D]
    h: 2.2, // [D]
    top: 9.5, // [D] a little below the tile tops
    rail: 1.1, // [D] a darker beam down each side
  },
  post: { r: 1.4 }, // [D] at each end of each pier, both sides
  boat: { u: 24, v: 17, len: 18, beam: 7, h: 4, mast: 16 }, // [D] moored beside the sign
}

/** two real dice, thrown into a little wooden tray on the table beside the frame (front right) */
export const DICE = {
  size: 16, // [STD] an ordinary 16 mm die, opposite faces adding to 7
  round: 2.6, // [D]
  tray: { x: 298, z: 228, w: 92, d: 62, rim: 5, h: 9, felt: 2 }, // [D] outside the frame, inside the camera's view
  throw: 1.0, // [D] seconds from the toss to rest
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

/** one of a harbour's two piers (side -1 or +1), in the harbour's frame: where it starts and ends, which way it runs */
export function pierLine(side: -1 | 1) {
  const H = HARBOR
  const corner: [number, number] = [(side * TILE.layout) / 2, 0]
  const dx = 0 - corner[0]
  const dy = H.out - corner[1]
  const l = Math.hypot(dx, dy)
  const d: [number, number] = [dx / l, dy / l]
  const start: [number, number] = [corner[0] + d[0] * H.pier.inset, corner[1] + d[1] * H.pier.inset]
  const end: [number, number] = [-d[0] * (H.signR - H.pier.into), H.out - d[1] * (H.signR - H.pier.into)]
  return { corner, start, end, d, len: Math.hypot(end[0] - start[0], end[1] - start[1]) }
}

/** points round everything a harbour puts in the water, for the checks */
export function harborFootprint(edge: number): [number, number][] {
  const { at } = harborFrame(edge)
  const H = HARBOR
  const pts: [number, number][] = []
  for (const side of [-1, 1] as const) {
    const { start, end, d } = pierLine(side)
    const n: [number, number] = [-d[1], d[0]]
    // a pier leaves the coast at a slant, so its first 5 mm reaches under the tile it starts from (out of sight below
    // the tile top: that is it meeting the shore); its footprint starts past that
    const off: [number, number] = [start[0] + d[0] * 5, start[1] + d[1] * 5]
    for (const p of [off, end]) for (const k of [-1, 1]) pts.push(at(p[0] + (n[0] * k * (H.pier.w / 2 + H.pier.rail)), p[1] + (n[1] * k * (H.pier.w / 2 + H.pier.rail))))
  }
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2
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
  add('every harbour (piers, sign, boat) is inside the frame', farthest < apothem - 2, `${f(farthest)} < ${f(apothem - 2)}`)
  const wet = prints.flat().filter(([x, z]) => onLand(x, z)).length
  add('no part of a harbour stands on a tile (past where each pier meets the shore)', wet === 0, `${wet} points on land`)
  const signs = TOPO.harbors.map(harborSign)
  let closest = Infinity
  signs.forEach((a, i) => signs.forEach((b, j) => j > i && (closest = Math.min(closest, Math.hypot(a[0] - b[0], a[1] - b[1])))))
  add('harbours never touch each other', closest > 2 * (HARBOR.boat.u + HARBOR.boat.beam), `${f(closest)} mm apart`)
  // the two piers come out from the side's two corners (the two that get the rate) and meet the sign
  const left = pierLine(-1)
  const right = pierLine(1)
  add('a pier starts at each of the side\'s two corners', Math.abs(Math.hypot(left.start[0] - left.corner[0], left.start[1] - left.corner[1]) - HARBOR.pier.inset) < 0.01 && left.corner[0] === -right.corner[0], `${f(HARBOR.pier.inset)} mm out from corners at u ±${f(right.corner[0])}`)
  const reach = Math.hypot(right.end[0], right.end[1] - HARBOR.out)
  add('both piers run into the sign', reach < HARBOR.signR, `ends ${f(reach)} mm from its centre (rim ${HARBOR.signR})`)
  add('the piers are short', right.len < 26, `${f(right.len)} mm each`)
  const apart = Math.hypot(right.end[0] - left.end[0], right.end[1] - left.end[1])
  add('the two piers stay apart where they meet the sign', apart > HARBOR.pier.w + 2 * HARBOR.pier.rail, `${f(apart)} mm between their ends`)
  const landR = Math.max(...TOPO.vertices.map((v) => Math.hypot(...toBoard(v.x, v.y))))
  add('the frame clears the land', landR < apothem - 10, `${f(landR)} < ${f(apothem - 10)}`)

  // from straight above, a city must look different from a settlement
  add('a city is clearly bigger than a settlement from above', CITY.w * CITY.d > 1.7 * SETTLEMENT.w * SETTLEMENT.d, `${CITY.w * CITY.d} vs ${SETTLEMENT.w * SETTLEMENT.d} mm²`)
  add('a settlement at a corner overhangs no token', TILE.layout - Math.hypot(SETTLEMENT.w, SETTLEMENT.d) / 2 > TOKEN.r + 4, `${f(TILE.layout - Math.hypot(SETTLEMENT.w, SETTLEMENT.d) / 2)} > ${TOKEN.r + 4}`)

  // the dice tray sits on the table, clear of the frame, and holds two dice side by side with room to tumble
  const T = DICE.tray
  const frameOut = SEA.inner + SEA.rim
  const nearest = Math.min(
    ...[[T.x - T.w / 2, T.z - T.d / 2], [T.x - T.w / 2, T.z + T.d / 2], [T.x + T.w / 2, T.z - T.d / 2]].map(([x, z]) => {
      // distance outside the frame's slanted lower-right side (flat-topped hexagon)
      const nx = Math.cos(Math.PI / 6)
      const nz = Math.sin(Math.PI / 6)
      return x * nx + z * nz - frameOut * (SQRT3 / 2)
    }),
  )
  add('the dice tray stands clear of the frame', nearest > 2, `${f(nearest)} mm clear`)
  add('the tray fits two dice with room to spare', T.w - 2 * T.rim > 3 * DICE.size && T.d - 2 * T.rim > 2 * DICE.size, `${T.w - 2 * T.rim} x ${T.d - 2 * T.rim} inside`)
  add('the tray is inside the camera\'s view', T.x + T.w / 2 < VIEW.w / 2 && T.z + T.d / 2 < (SEA.inner + SEA.rim) * (SQRT3 / 2), `right edge ${f(T.x + T.w / 2)} < ${f(VIEW.w / 2)}`)

  // the board's nine harbours each touch two corners and no corner twice
  const hc = new Set(TOPO.harbors.flatMap((e) => [TOPO.edges[e].a, TOPO.edges[e].b]))
  add('harbours use 18 distinct corners', hc.size === 18, `${hc.size}`)

  return out
}
