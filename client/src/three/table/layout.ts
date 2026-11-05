/**
 * Where everything sits on the table, in millimetres, in the board's frame (+x right, +z toward you). The board is in
 * the middle; your area is the near edge; the other players sit along the far edge; the bank, the dice and the trade
 * tray take the sides (or, on a tall screen, stack above and below the board).
 *
 * Every object's footprint is listed in `boxes`, so a check can prove nothing overlaps.
 */
export type Spot = [number, number]
export type Box = { what: string; x: number; z: number; w: number; d: number; poly?: Spot[] }

export const CARD = { w: 64, d: 90, t: 0.9, small: 0.6 } // [D] a card lying flat; small ones (on the tray, and everyone else's on a tall screen) are 60%
/** your hand's stacks lie side by side, nearly touching */
export const HAND_STEP = CARD.w + 2
export const TRAY = { w: 200, d: 150, rim: 6, h: 7 } // [D] the trade tray: near half is what you give, far half what you get
export const DICE_TRAY = { w: 92, d: 62 } // [D] (matches spec DICE.tray)
/** your pieces waiting to be built: a pile of roads, a cluster of houses, a group of cities */
export const SUPPLY = { road: { w: 52, d: 52 }, settlement: { w: 72, d: 50 }, city: { w: 76, d: 54 }, knight: { w: 44, d: 44 }, wall: { w: 62, d: 40 } } // [D]
/** the expansion's boards on the table: your three city tracks as flip charts (everyone else's small, by their cards),
 *  and the barbarians' voyage, a little sea board with their route to the island */
/** your three flip charts side by side, drawn at `scale`: how far apart, and their footprint (a chart's stand is
 *  50 mm wide and 72 deep at scale 1). Everyone else's levels show as numbers by their names */
export const tracksBox = (scale: number) => ({ stand: 58 * scale, w: (2 * 58 + 50) * scale, d: 72 * scale })
/** the frame round the board: its outside, centre to corner (flat-topped; matches spec SEA.inner + SEA.rim) */
export const FRAME_R = 344

/**
 * The barbarians' voyage: a sea board in a frame, lying along the board's upper-left side, and on it big
 * flat-topped hexes, one per step, zig-zagging from the open sea at its top end to the island at its bottom end,
 * beside the board. `hexes` and `island` are in the sea board's own frame (x along it, toward the island; z across
 * it, away from the board); `yaw` turns that frame onto the table.
 */
export type Raid = { r: number; x: number; z: number; len: number; wid: number; yaw: number; hexes: Spot[]; island: Spot; corners: Spot[] }
export function raidBoard(r: number, s: number, gap = 10): Raid {
  const h = (Math.sqrt(3) / 2) * r
  const m = 7 // the sea's margin inside the frame
  const isle = 0.95 * r // the island's radius
  const len = 2 * m + 2 * r + 10.5 * r + 4 + 2 * isle
  const wid = 2 * m + 3 * h
  const P0: Spot = [-FRAME_R / 2, -(Math.sqrt(3) / 2) * FRAME_R] // the frame's top-left corner
  const u: Spot = [-0.5, Math.sqrt(3) / 2] // along the side, toward its left corner
  const n: Spot = [-Math.sqrt(3) / 2, -0.5] // away from the board
  const off = gap + wid / 2
  const x = P0[0] + s * u[0] + off * n[0]
  const z = P0[1] + s * u[1] + off * n[1]
  const hexes = Array.from({ length: 8 }, (_, i): Spot => [-len / 2 + m + r + 1.5 * r * i, (i % 2 === 0 ? 1 : -1) * (h / 2)])
  const world = ([a, b]: Spot): Spot => [x + a * u[0] + b * n[0], z + a * u[1] + b * n[1]]
  const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => world([(a * len) / 2, (b * wid) / 2]))
  // (the frame maps the board's x onto u and z onto n: a turn of -120 degrees)
  return { r, x, z, len, wid, yaw: (-2 * Math.PI) / 3, hexes, island: [len / 2 - m - isle, 0], corners }
}
/** a point of the sea board's own frame, on the table */
export function raidToTable(R: Raid, [a, b]: Spot): Spot {
  const c = Math.cos(R.yaw)
  const sn = Math.sin(R.yaw)
  return [R.x + a * c + b * sn, R.z - a * sn + b * c]
}

/**
 * The bank: one card of each kind, fanned from a point below them like a hand of cards held up (the stacks behind
 * them aren't shown: only when a kind runs low does its count show). Card i of n: where it lies and how it's turned,
 * and a point on the part of it that shows (to click).
 */
export const FAN = { reach: 50, step8: 10.5, step5: 13 } // [D] the card's middle from the pivot (mm); degrees between cards
export function fanPose(pivot: Spot, n: number, i: number) {
  const step = ((n > 5 ? FAN.step8 : FAN.step5) * Math.PI) / 180
  const th = (i - (n - 1) / 2) * step
  const at = (d: number, off = 0): Spot => [pivot[0] + d * Math.sin(th + off), pivot[1] - d * Math.cos(th + off)]
  const [x, z] = at(FAN.reach)
  // the next card covers this one's right side; what shows is a wedge on its left, widest near the top
  const d = FAN.reach + CARD.d / 2 - 8
  const tap = i === n - 1 ? at(FAN.reach + 10) : at(d, -Math.atan(CARD.w / 2 / d) + step / 2)
  return { x, z, yaw: -th, base: i * CARD.t, tap }
}
/** the fan's footprint (for the layout check) */
function fanBox(pivot: Spot, n: number): { x0: number; x1: number; z0: number; z1: number } {
  let x0 = Infinity
  let x1 = -Infinity
  let z0 = Infinity
  let z1 = -Infinity
  for (let i = 0; i < n; i++) {
    const p = fanPose(pivot, n, i)
    for (const [lx, lz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const ax = (lx * CARD.w) / 2
      const az = (lz * CARD.d) / 2
      const c = Math.cos(p.yaw)
      const sn = Math.sin(p.yaw)
      const wx = p.x + ax * c + az * sn
      const wz = p.z - ax * sn + az * c
      x0 = Math.min(x0, wx)
      x1 = Math.max(x1, wx)
      z0 = Math.min(z0, wz)
      z1 = Math.max(z1, wz)
    }
  }
  return { x0, x1, z0, z1 }
}

export type Layout = SeatStyle & {
  portrait: boolean
  hand: Spot[] // where your stacks go, left to right (only the kinds you hold, packed from the left)
  /** your development (or progress) cards, by kind; given how many kinds your hand holds, they may follow it */
  dev: (i: number, held?: number) => Spot
  supply: { road: Spot; settlement: Spot; city: Spot }
  awardsMine: Spot
  meLabel: Spot
  tray: Spot
  /** the tray's check and cross: beside it, on this side, or (on a phone) big, down in the corner by the turn button */
  marks: 'left' | 'right' | 'corner'
  wants: (i: number) => Spot // the five "ask for" cards behind the tray
  bank: Spot[] // where to click each kind of the bank's cards
  fan: Spot // the bank's fan of cards: its pivot
  deck: Spot
  dice: Spot
  /** where a roll is shown big for a moment (by the dice, off the board, so the tiles it lights stay in view) */
  flash: Spot
  seats: { p: number; at: Spot }[]
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number }
  boxes: Box[]
  /** the expansion's places (absent in the basic game) */
  k: {
    knights: [Spot, Spot, Spot] // your knights waiting, by strength
    wall: Spot
    points: Spot // your defender and point cards
    tracks: Spot // the middle of your three flip charts (put away while the tray is out, if `tracksYield`)
    tracksScale: number
    tracksYield: boolean
    raid: Raid // the barbarians' voyage
    decks: Record<'trade' | 'politics' | 'science', Spot>
  } | null
}

/** how a layout lays out everyone else's places: small cards (the basic game on a tall screen, where four piles
 *  each must fit across), or three piles (the expansion: no knights are played as cards) */
export type SeatStyle = { seatSmall?: boolean; seatThree?: boolean }
/** an opponent's area: their hand (face down), their development or progress cards (face down), knights played,
 *  awards (and in the expansion their defender and point cards) */
export const seatParts = (at: Spot, o: SeatStyle = {}) => {
  const k = o.seatSmall ? CARD.small : 1
  const step = CARD.w * k + 8
  const three = !!o.seatThree
  return {
    hand: [at[0] - (three ? step : step / 2), at[1]] as Spot,
    dev: [at[0] + (three ? 0 : step / 2), at[1]] as Spot,
    knights: [at[0] + (three ? 0 : step * 1.5), at[1]] as Spot,
    awards: [at[0] + (three ? step : -step * 1.5), at[1]] as Spot,
    // their name and points, just below their cards (toward the board)
    label: [at[0], at[1] + (CARD.d * k) / 2 + 25] as Spot,
    small: !!o.seatSmall,
    three,
  }
}

/** the height kept clear at the top for the two lines (whose turn, what just happened) */
const LINES = 70
/** (on a phone the lines keep a readable size however small the table is drawn, so they take more of it) */
const LINES_TALL = 120
/** the voyage's hexes, and where along the board's side its middle lies (mm from the frame's top-left corner) */
const RAID_R = { wide: 32, tall: 33 }
const RAID_S = { wide: 266, tall: -66 }

export function layoutFor(players: number, you: number, aspect: number, knights = false): Layout {
  const portrait = aspect < 0.95
  const others = Array.from({ length: players }, (_, i) => i).filter((i) => i !== you)
  const spread = (n: number, w: number) => (n === 1 ? [0] : Array.from({ length: n }, (_, i) => -w + (2 * w * i) / (n - 1)))

  let L: Omit<Layout, 'boxes'>
  if (!portrait) {
    // the board in the middle; above it everyone else; below it your hand and development cards; on the left the
    // trade tray and your waiting pieces; on the right the bank, its deck and the dice
    const xs = spread(others.length, others.length === 2 ? 300 : 430)
    L = {
      portrait,
      hand: Array.from({ length: 5 }, (_, i): Spot => [-300 + i * HAND_STEP, 392]),
      dev: (i) => [84 + i * 74, 392],
      supply: { road: [-590, 190], settlement: [-515, 190], city: [-428, 190] },
      awardsMine: [-560, 318],
      meLabel: [-144, 322],
      tray: [-520, 0],
      marks: 'right',
      wants: (i) => [-520 + (i - 2) * 44, -130],
      fan: [520, -10],
      bank: [],
      deck: [520, 95],
      dice: [526, 205],
      flash: [520, 300],
      seats: others.map((p, i) => ({ p, at: [xs[i], -395] as Spot })),
      bounds: { minX: -645, maxX: 645, minZ: -515, maxZ: 450 },
      k: null,
    }
    if (knights) {
      // the expansion: eight kinds of card; along the bottom your hand, then your progress cards, points and awards;
      // above the hand (on the left, beside the board) your three flip charts; on the left your pieces and the
      // barbarians' raid zig-zagging down beside the board; on the right the progress decks, the bank, the tray, the dice
      const xs3 = spread(others.length, 360)
      L = {
        ...L,
        seats: others.map((p, i) => ({ p, at: [xs3[i], -395] as Spot })),
        hand: Array.from({ length: 8 }, (_, i): Spot => [-600 + i * HAND_STEP, 437]),
        dev: (i, held = 8) => [-600 + held * HAND_STEP + 22 + i * HAND_STEP, 437],
        meLabel: [-250, 370],
        seatThree: true,
        supply: { road: [-614, 171], settlement: [-540, 171], city: [-455, 171] },
        awardsMine: [412, 437],
        tray: [540, 120],
        marks: 'left',
        wants: (i) => [540 + ((i % 4) - 1.5) * 42, i < 4 ? -45 : 13],
        fan: [540, -205],
        deck: [540, -130],
        dice: [560, 262],
        flash: [540, 120],
        bounds: { minX: -645, maxX: 645, minZ: -515, maxZ: 495 },
        k: {
          knights: [[-620, 225], [-572, 225], [-524, 225]],
          wall: [-460, 225],
          points: [342, 437],
          tracks: [-470, 316],
          tracksScale: 1.6,
          tracksYield: false,
          raid: raidBoard(RAID_R.wide, RAID_S.wide),
          decks: { trade: [470, -130], politics: [540, -130], science: [610, -130] },
        },
      }
    }
  } else {
    // stacked: everyone else, the bank and dice, the board, the tray, your hand, then your development cards
    // and pieces
    const xs = spread(others.length, others.length === 2 ? 180 : 268)
    L = {
      portrait,
      seatSmall: true,
      hand: Array.from({ length: 5 }, (_, i): Spot => [-150 + i * HAND_STEP, 620]),
      dev: (i) => [40 + i * 70, 724],
      supply: { road: [-330, 724], settlement: [-255, 724], city: [-170, 724] },
      awardsMine: [-300, 620],
      meLabel: [0, 548],
      tray: [0, 450],
      marks: 'corner',
      wants: (i) => [(i - 2) * 44, 340],
      fan: [0, -345],
      bank: [],
      deck: [190, -400],
      // the dice at the board's bottom right, where there's room
      dice: [300, 340],
      flash: [0, 450],
      seats: others.map((p, i) => ({ p, at: [xs[i], -560] as Spot })),
      bounds: { minX: -362, maxX: 362, minZ: -715, maxZ: 852 },
      k: null,
    }
    if (knights)
      // the expansion: everyone else; the barbarians' raid down the board's upper left, the bank and the decks on
      // its upper right; the board; the dice at its lower right; your flip charts (the tray takes their place while
      // it's out, with what you can ask for either side of it); your hand; your pieces and progress cards
      L = {
        ...L,
        seats: others.map((p, i) => ({ p, at: [spread(others.length, 241)[i], -690] as Spot })),
        seatSmall: false,
        seatThree: true,
        hand: Array.from({ length: 8 }, (_, i): Spot => [-300 + i * HAND_STEP, 560]),
        dev: (i) => [-80 + i * 70, 660],
        supply: { road: [-330, 660], settlement: [-255, 660], city: [-170, 660] },
        meLabel: [-262, 462],
        tray: [0, 430],
        marks: 'corner',
        wants: (i) => [(i < 4 ? -1 : 1) * (TRAY.w / 2 + 8 + 19 + (i % 2 ? 44 : 0)), 430 + ((i % 4) < 2 ? -30 : 30)],
        fan: [215, -380],
        deck: [220, -540],
        dice: [300, 330],
        flash: [0, 420],
        awardsMine: [10, 756],
        bounds: { minX: -362, maxX: 362, minZ: -860, maxZ: 810 },
        k: {
          knights: [[-330, 756], [-280, 756], [-230, 756]],
          wall: [-160, 756],
          points: [-60, 756],
          tracks: [0, 447],
          tracksScale: 1.75,
          tracksYield: true,
          raid: raidBoard(RAID_R.tall, RAID_S.tall),
          decks: { trade: [150, -540], politics: [220, -540], science: [290, -540] },
        },
      }
  }

  const kinds = knights ? 8 : 5
  L.bank = Array.from({ length: kinds }, (_, i) => fanPose(L.fan, kinds, i).tap)
  const c = (what: string, [x, z]: Spot, w = CARD.w, d = CARD.d): Box => ({ what, x, z, w, d })
  const boxes: Box[] = [
    ...L.hand.map((s, i) => c(`hand ${i}`, s)),
    // (flip charts that make way for the tray: they only have to keep clear of everything but the tray)
    ...(L.k?.tracksYield ? [c('my tracks [yields]', L.k.tracks, tracksBox(L.k.tracksScale).w, tracksBox(L.k.tracksScale).d)] : []),
    ...[0, 1, 2, 3, 4].map((i) => c(`dev ${i}`, L.dev(i))),
    c('roads', L.supply.road, SUPPLY.road.w, SUPPLY.road.d),
    c('settlements', L.supply.settlement, SUPPLY.settlement.w, SUPPLY.settlement.d),
    c('cities', L.supply.city, SUPPLY.city.w, SUPPLY.city.d),
    c('tray', L.tray, TRAY.w, TRAY.d),
    ...L.hand.map((_, i) => c(`want ${i}`, L.wants(i), CARD.w * CARD.small, CARD.d * CARD.small)),
    (() => {
      const f = fanBox(L.fan, kinds)
      return { what: 'bank fan', x: (f.x0 + f.x1) / 2, z: (f.z0 + f.z1) / 2, w: f.x1 - f.x0, d: f.z1 - f.z0 }
    })(),
    ...(L.k ? [] : [c('deck', L.deck)]),
    c('dice', L.dice, DICE_TRAY.w, DICE_TRAY.d),
    c('my awards', L.awardsMine),
    ...(L.k
      ? [
          ...L.k.knights.map((s, i) => c(`knights ${i + 1}`, s, SUPPLY.knight.w, SUPPLY.knight.d)),
          c('walls', L.k.wall, SUPPLY.wall.w, SUPPLY.wall.d),
          c('my points', L.k.points),
          ...(L.k.tracksYield ? [] : [c('my tracks', L.k.tracks, tracksBox(L.k.tracksScale).w, tracksBox(L.k.tracksScale).d)]),
          (() => {
            const cs = L.k!.raid.corners
            const xs = cs.map((p) => p[0])
            const zs = cs.map((p) => p[1])
            const x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs)
            return { what: 'barbarian voyage', x: (x0 + x1) / 2, z: (z0 + z1) / 2, w: x1 - x0, d: z1 - z0, poly: cs }
          })(),
          ...Object.entries(L.k.decks).map(([t, s]) => c(`${t} deck`, s)),
        ]
      : []),
    ...L.seats.flatMap(({ p, at }) => {
      const s = seatParts(at, L)
      const k = s.small ? CARD.small : 1
      return [c(`p${p} hand`, s.hand, CARD.w * k, CARD.d * k), c(`p${p} dev`, s.dev, CARD.w * k, CARD.d * k), ...(s.three ? [] : [c(`p${p} knights`, s.knights, CARD.w * k, CARD.d * k)]), c(`p${p} awards`, s.awards, CARD.w * k, CARD.d * k)]
    }),
  ]
  // where the few things drawn over the table sit (sizes at the labels' usual scale; they scale with the table):
  // the two lines at the top, the History button, the turn button, the tray's check and cross, the name tags
  const { maxX, minZ, maxZ } = L.bounds
  const ui = (what: string, x0: number, x1: number, z0: number, z1: number): Box => ({ what: `[${what}]`, x: (x0 + x1) / 2, z: (z0 + z1) / 2, w: x1 - x0, d: z1 - z0 })
  boxes.push(
    ui('top lines', -230, 230, minZ, minZ + (portrait ? LINES_TALL : LINES)),
    ui('history', maxX - 110, maxX, minZ, minZ + 56),
    ui('turn button', maxX - 150, maxX, maxZ - 76, maxZ),
    ...(L.marks === 'corner' ? [] : [L.marks === 'right'
      ? ui('tray check and cross', L.tray[0] + TRAY.w / 2 + 4, L.tray[0] + TRAY.w / 2 + 62, L.tray[1] - 62, L.tray[1] + 62)
      : ui('tray check and cross', L.tray[0] - TRAY.w / 2 - 62, L.tray[0] - TRAY.w / 2 - 4, L.tray[1] - 62, L.tray[1] + 62)]),
    ui('your name', L.meLabel[0] - 62, L.meLabel[0] + 62, L.meLabel[1] - 18, L.meLabel[1] + 18),
    ...L.seats.map(({ p, at }) => {
      const [x, z] = seatParts(at, L).label
      return ui(`p${p} name`, x - 62, x + 62, z - 18, z + 18)
    }),
  )
  return { ...L, boxes }
}

const boxPoly = (b: Box): Spot[] => [[b.x - b.w / 2, b.z - b.d / 2], [b.x + b.w / 2, b.z - b.d / 2], [b.x + b.w / 2, b.z + b.d / 2], [b.x - b.w / 2, b.z + b.d / 2]]
/** points along a polygon's edges, every few mm */
function edgePoints(p: Spot[]): Spot[] {
  const out: Spot[] = []
  p.forEach((a, i) => {
    const b = p[(i + 1) % p.length]
    const n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 6)
    for (let k = 0; k < n; k++) out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n])
  })
  return out
}
/** two convex polygons overlap (or come within 2 mm): separating axes */
function polyHits(a: Spot[], b: Spot[]) {
  for (const poly of [a, b])
    for (let i = 0; i < poly.length; i++) {
      const [x0, z0] = poly[i]
      const [x1, z1] = poly[(i + 1) % poly.length]
      const nx = z1 - z0
      const nz = -(x1 - x0)
      const l = Math.hypot(nx, nz)
      const proj = (q: Spot[]) => q.map(([x, z]) => (x * nx + z * nz) / l)
      const pa = proj(a)
      const pb = proj(b)
      if (Math.max(...pa) + 2 < Math.min(...pb) || Math.max(...pb) + 2 < Math.min(...pa)) return false
    }
  return true
}

/** checks every layout (2 to 4 players, wide and tall): nothing overlaps anything else or the board's frame */
export function checkLayouts(frameR: number): { what: string; ok: boolean; value: string }[] {
  const out: { what: string; ok: boolean; value: string }[] = [{ what: 'the layout knows the frame', ok: frameR === FRAME_R, value: `${frameR}` }]
  const inFrame = (x: number, z: number) => Math.abs(z) <= (Math.sqrt(3) / 2) * frameR && Math.sqrt(3) * Math.abs(x) + Math.abs(z) <= Math.sqrt(3) * frameR
  for (const knights of [false, true])
  for (const portrait of [false, true]) {
    for (const n of [2, 3, 4]) {
      const L = layoutFor(n, 0, portrait ? 0.6 : 1.6, knights)
      const hits: string[] = []
      L.boxes.forEach((a, i) =>
        L.boxes.forEach((b, j) => {
          if (j <= i) return
          // the raid's hexes touch each other; the charts that make way for the tray, the tray and its cards
          const yields = (x: Box) => x.what.includes('[yields]')
          const trayish = (x: Box) => x.what === 'tray' || x.what.startsWith('want') || x.what.startsWith('[tray')
          if ((yields(a) && trayish(b)) || (yields(b) && trayish(a))) return
          if (a.poly || b.poly) {
            if (polyHits(a.poly ?? boxPoly(a), b.poly ?? boxPoly(b))) hits.push(`${a.what} / ${b.what}`)
            return
          }
          if (Math.abs(a.x - b.x) * 2 < a.w + b.w + 4 && Math.abs(a.z - b.z) * 2 < a.d + b.d + 4) hits.push(`${a.what} / ${b.what}`)
        }),
      )
      for (const a of L.boxes) {
        const pts = a.poly ? edgePoints(a.poly) : [-1, 0, 1].flatMap((sx) => [-1, 0, 1].map((sz) => [a.x + (sx * a.w) / 2, a.z + (sz * a.d) / 2]))
        if (pts.some(([x, z]) => inFrame(x, z))) hits.push(`${a.what} / board`)
        const { minX, maxX, minZ, maxZ } = L.bounds
        if (a.poly && a.poly.some(([x, z]) => x < minX || x > maxX || z < minZ || z > maxZ)) hits.push(`${a.what} outside the view`)
        else if (!a.poly && (a.x - a.w / 2 < minX || a.x + a.w / 2 > maxX || a.z - a.d / 2 < minZ || a.z + a.d / 2 > maxZ)) hits.push(`${a.what} outside the view`)
      }
      out.push({ what: `${knights ? 'knights, ' : ''}${portrait ? 'tall' : 'wide'} table, ${n} players: nothing overlaps`, ok: hits.length === 0, value: hits.length ? hits.slice(0, 4).join('; ') : `${L.boxes.length} things placed` })
    }
  }
  return out
}
