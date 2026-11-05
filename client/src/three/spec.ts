/**
 * The board and its pieces, in millimetres.
 *
 * Sources
 *   [D]   our own design (this is our game; nothing here is measured off another game's pieces)
 *   [STD] common real-world sizes: a 16 mm six-sided die with opposite faces adding to 7
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
 *   dice       two rounded 16 mm dice, beside the board
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
  maxH: 30, // [D] tallest thing (a peak), so it never hides a piece behind it from the usual camera
}

export const TOKEN = { r: 19, h: 4.5, bevel: 1.4 } // [D]

export const SETTLEMENT = { w: 15, d: 15, wall: 10, peak: 18, round: 1.3 } // [D]
export const CITY = { w: 27, d: 15, wall: 11, peak: 17, towerW: 12, tower: 22, towerPeak: 28, round: 1.3 } // [D]
export const ROAD = { len: 34, w: 6.5, h: 6, round: 1.6 } // [D]
export const ROBBER = { r: 9, h: 30 } // [D]

export const HARBOR = {
  out: 30, // [D] how far the sign stands out to sea from the coast side
  signR: 17, // [D] big enough to read the rate from the usual camera
  signH: 4, // [D]
  plank: { w: 5, h: 2.5 }, // [D]
}

export const SEA = {
  level: 6, // [D] water surface (tiles stand 6 mm proud of it)
  inner: 318, // [D] the frame's inside, centre to corner (flat-topped)
  rim: 26, // [D] frame width
  rimH: 16, // [D]
}

export const DIE = { size: 16, round: 2.6, pip: 1.6 } // [STD] 16 mm; [D] rounding and pips
export const DICE_AT = { x: 345, z: 225, apart: 26 } // [D] on the table, front right of the frame

export const TABLE = { r: 900, top: 0, h: 30 } // [D] its top is the tray floor

/** layout coordinates (unit hexes) to the board plane, mm */
export const toBoard = (x: number, y: number): [number, number] => [x * TILE.layout, y * TILE.layout]

export const hexAt = (h: number) => toBoard(TOPO.hexes[h].x, TOPO.hexes[h].y)
export const vertexAt = (v: number) => toBoard(TOPO.vertices[v].x, TOPO.vertices[v].y)
export const edgeAt = (e: number) => toBoard(TOPO.edges[e].x, TOPO.edges[e].y)

/** where a harbour's sign stands */
export function harborSign(edge: number): [number, number] {
  const e = TOPO.edges[edge]
  const h = TOPO.hexes[e.hexes[0]]
  const [mx, mz] = toBoard(e.x, e.y)
  const [hx, hz] = toBoard(h.x, h.y)
  const l = Math.hypot(mx - hx, mz - hz)
  return [mx + ((mx - hx) / l) * HARBOR.out, mz + ((mz - hz) / l) * HARBOR.out]
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

  // harbours sit in open water inside the frame and don't touch each other
  const apothem = (SEA.inner * SQRT3) / 2
  const signs = TOPO.harbors.map(harborSign)
  const farthest = Math.max(...signs.map(([x, z]) => Math.hypot(x, z)))
  add('every harbour sign is inside the frame', farthest + HARBOR.signR < apothem, `${f(farthest + HARBOR.signR)} < ${f(apothem)}`)
  let closest = Infinity
  signs.forEach((a, i) => signs.forEach((b, j) => j > i && (closest = Math.min(closest, Math.hypot(a[0] - b[0], a[1] - b[1])))))
  add('harbour signs never overlap', closest > 2 * HARBOR.signR, `${f(closest)} mm apart`)
  const landR = Math.max(...TOPO.vertices.map((v) => Math.hypot(...toBoard(v.x, v.y))))
  add('the frame clears the land', landR < apothem - 10, `${f(landR)} < ${f(apothem - 10)}`)

  // the dice sit on the table, off the frame
  const frameOut = SEA.inner + SEA.rim
  const diceR = Math.hypot(DICE_AT.x, DICE_AT.z) - DIE.size
  add('the dice clear the frame', diceR > frameOut * (SQRT3 / 2), `${f(diceR)} > ${f(frameOut * (SQRT3 / 2))}`)
  add('dice: 16 mm', DIE.size === 16, `${DIE.size} mm`)

  // the board's nine harbours each touch two corners and no corner twice
  const hc = new Set(TOPO.harbors.flatMap((e) => [TOPO.edges[e].a, TOPO.edges[e].b]))
  add('harbours use 18 distinct corners', hc.size === 18, `${hc.size}`)

  return out
}
