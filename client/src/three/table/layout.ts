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
 * The barbarians' voyage: a straight sea board in a frame, standing on end beside the board, and on it big
 * flat-topped hexes, one per step, zig-zagging from the open sea at its top end down to the island at its bottom end.
 * `hexes` and `island` are in the sea board's own frame (x along it, toward the island; z across it); `yaw` turns that
 * frame onto the table (-90 degrees: x runs toward you, z to the left).
 */
export type Raid = { r: number; x: number; z: number; len: number; wid: number; yaw: number; hexes: Spot[]; island: Spot; corners: Spot[] }
export function raidBoard(r: number, [x, z]: Spot, yaw = -Math.PI / 2): Raid {
  const h = (Math.sqrt(3) / 2) * r
  const m = 7 // the sea's margin inside the frame
  const isle = 0.95 * r // the island's radius
  const len = 2 * m + 2 * r + 10.5 * r + 4 + 2 * isle
  const wid = 2 * m + 3 * h
  const hexes = Array.from({ length: 8 }, (_, i): Spot => [-len / 2 + m + r + 1.5 * r * i, (i % 2 === 0 ? 1 : -1) * (h / 2)])
  const R = { r, x, z, len, wid, yaw, hexes, island: [len / 2 - m - isle, 0] as Spot, corners: [] as Spot[] }
  R.corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => raidToTable(R, [(a * len) / 2, (b * wid) / 2]))
  return R
}
/** the sea board's footprint on the table (standing on end: as wide as it is across, as deep as it is long) */
export const raidSize = (r: number) => {
  const R = raidBoard(r, [0, 0])
  return { w: R.wid, d: R.len }
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
/** a bank card's place in the fan; `spread` opens the fan wider (where there's room) and each card is a stack of
 *  up to BANK_STACK, so the next card lies above the whole stack */
export const BANK_STACK = 4
/** a bank stack's cards, as a share of a full card (laid out in rows on a wide table) */
export const BANK_SCALE = CARD.small
export function fanPose(pivot: Spot, n: number, i: number, spread = 1) {
  const step = ((n > 5 ? FAN.step8 : FAN.step5) * spread * Math.PI) / 180
  const th = (i - (n - 1) / 2) * step
  const at = (d: number, off = 0): Spot => [pivot[0] + d * Math.sin(th + off), pivot[1] - d * Math.cos(th + off)]
  const reach = FAN.reach * spread
  const [x, z] = at(reach)
  // the next card covers this one's right side; what shows is a wedge on its left, widest near the top
  const d = reach + CARD.d / 2 - 8
  const tap = i === n - 1 ? at(reach + 10) : at(d, -Math.atan(CARD.w / 2 / d) + step / 2)
  return { x, z, yaw: -th, base: i * CARD.t, tap }
}
/** the fan's footprint (for the layout check) */
function fanBox(pivot: Spot, n: number, spread = 1): { x0: number; x1: number; z0: number; z1: number } {
  let x0 = Infinity
  let x1 = -Infinity
  let z0 = Infinity
  let z1 = -Infinity
  for (let i = 0; i < n; i++) {
    const p = fanPose(pivot, n, i, spread)
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
  /** your stacks are packed against the right end instead (beside your flip charts) */
  handEnd?: boolean
  /** your development (or progress) cards, by kind; given how many kinds your hand holds, they may follow it */
  dev: (i: number, held?: number) => Spot
  supply: { road: Spot; settlement: Spot; city: Spot }
  awardsMine: Spot
  /** your name tag starts at meLabel (and wraps its chips under the name) rather than centring on it */
  meLabelStart?: boolean
  /** the bank laid out as a stack per kind, small, in rows (on a wide table; else the fan) */
  bankGrid?: Spot[]
  /** the basic game: the knights you've played, face up beside your awards (Largest Army in the making) */
  armyMine?: Spot
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
 *  each must fit across), or three piles (the expansion: no knights are played as cards); and where their name goes:
 *  under their cards, or (`seatRowFrom`, everyone in a list, one under another) at the start of their row */
export type SeatStyle = { seatSmall?: boolean; seatThree?: boolean; seatRowFrom?: number }
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
    // their name and points, just below their cards (toward the board), or at the start of their row
    label: (o.seatRowFrom !== undefined ? [o.seatRowFrom, at[1]] : [at[0], at[1] + (CARD.d * k) / 2 + 25]) as Spot,
    /** the name starts at `label` (in a list) or is centred on it */
    labelStart: o.seatRowFrom !== undefined,
    small: !!o.seatSmall,
    three,
  }
}

/** the height kept clear at the top for the two lines (whose turn, what just happened) */
const LINES = 70
/** (on a phone the lines keep a readable size however small the table is drawn, so they take more of it) */
const LINES_TALL = 120
/** the voyage's hexes (their radius, mm) */
const RAID_R = 34

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
      armyMine: [-470, 318],
      meLabel: [-144, 322],
      tray: [-520, 0],
      marks: 'right',
      wants: (i) => [-520 + (i - 2) * 44, -130],
      fan: [520, -10],
      bankGrid: Array.from({ length: 5 }, (_, i): Spot => [520 + (i - 2) * 46, -30]),
      bank: [],
      deck: [520, 95],
      dice: [526, 205],
      flash: [520, 300],
      seats: others.map((p, i) => ({ p, at: [xs[i], -395] as Spot })),
      bounds: { minX: -645, maxX: 645, minZ: -515, maxZ: 450 },
      k: null,
    }
    if (knights) {
      // the expansion, in three bands. Across the top: everyone else. In the middle: the barbarians' voyage standing
      // on end at the board's left, the board, and on its right the bank (fan, progress decks), the trade tray and the
      // dice. Along the bottom, your row: your pieces and name above your hand on the left, your three flip charts
      // in the middle under the board, then your progress cards, points and awards
      const xs3 = spread(others.length, 360)
      const row = 370
      L = {
        ...L,
        seats: others.map((p, i) => ({ p, at: [xs3[i], -395] as Spot })),
        hand: Array.from({ length: 8 }, (_, i): Spot => [-640 + i * HAND_STEP, row]),
        handEnd: true,
        dev: (i) => [170 + i * 70, row],
        meLabel: [-300, 290],
        seatThree: true,
        supply: { road: [-672, 170], settlement: [-603, 170], city: [-524, 170] },
        awardsMine: [525, row],
        armyMine: undefined,
        tray: [540, 120],
        marks: 'left',
        wants: (i) => [540 + ((i % 4) - 1.5) * 42, i < 4 ? -45 : 13],
        fan: [540, -205],
        bankGrid: Array.from({ length: 8 }, (_, i): Spot => [580 + ((i % 4) - 1.5) * 50, i < 4 ? -292 : -224]),
        deck: [540, -130],
        dice: [560, 262],
        flash: [540, 120],
        bounds: { minX: -720, maxX: 720, minZ: -515, maxZ: 470 },
        k: {
          knights: [[-680, 240], [-632, 240], [-584, 240]],
          wall: [-520, 240],
          points: [455, row],
          tracks: [0, row],
          tracksScale: 1.6,
          tracksYield: false,
          raid: raidBoard(RAID_R, [-FRAME_R - 22 - raidSize(RAID_R).w / 2, 0]),
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
      armyMine: [-226, 620],
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
    if (knights) {
      // the expansion, as one column of bands. At the top, the barbarians' voyage standing on end at the left, and
      // beside it everyone else as a list (name, then their cards), then the bank's fan and the progress decks
      // (lined up with the cards above them); the board; your three flip charts (the tray takes their place while
      // it's out, with what you can ask for either side of it) with your name beside them; your hand, with the
      // dice at its end; your progress cards, points and awards; your pieces
      const V = raidSize(RAID_R)
      const vx = -362 + 12 + V.w / 2
      const rowFrom = vx + V.w / 2 + 14 // where everyone's name starts
      const cols = [162, 232, 302] // their three piles; the progress decks under them
      const bankZ = -382
      const rowZ = (i: number) => bankZ - 55 - 14 - 45 - (others.length - 1 - i) * 108
      const top = bankZ - 55 - 14 - 90 - 2 * 108
      const charts = 385
      const handZ = 517
      const progZ = 619
      // your pieces in two rows at the left of the bottom band: its right side is kept for the big buttons
      const pieceZ = 702
      const pieceZ2 = 760
      L = {
        ...L,
        seats: others.map((p, i) => ({ p, at: [cols[1], rowZ(i)] as Spot })),
        seatSmall: false,
        seatThree: true,
        seatRowFrom: rowFrom,
        hand: Array.from({ length: 8 }, (_, i): Spot => [-330 + i * HAND_STEP, handZ]),
        dev: (i) => [-330 + i * 70, progZ],
        supply: { road: [-322, pieceZ], settlement: [-250, pieceZ], city: [-170, pieceZ] },
        // (your name starts at the left edge, its chips on a line under it: on a phone there's no room beside it)
        meLabel: [-352, charts],
        meLabelStart: true,
        tray: [0, charts],
        marks: 'corner',
        wants: (i) => [(i < 4 ? -1 : 1) * (TRAY.w / 2 + 8 + 19 + (i % 2 ? 44 : 0)), charts + ((i % 4) < 2 ? -30 : 30)],
        fan: [cols[0] - 32 - 24 - 83, bankZ + 55],
        deck: [cols[1], bankZ],
        dice: [300, handZ],
        flash: [0, charts],
        awardsMine: [30, progZ],
        armyMine: undefined,
        bounds: { minX: -362, maxX: 362, minZ: top - 8 - LINES_TALL, maxZ: 790 },
        k: {
          knights: [[-326, pieceZ2], [-278, pieceZ2], [-230, pieceZ2]],
          wall: [-164, pieceZ2],
          points: [-40, progZ],
          tracks: [0, charts],
          tracksScale: 1.9,
          tracksYield: true,
          raid: raidBoard(RAID_R, [vx, top + V.d / 2]),
          decks: { trade: [cols[0], bankZ], politics: [cols[1], bankZ], science: [cols[2], bankZ] },
        },
      }
    }
  }

  const kinds = knights ? 8 : 5
  L.bank = L.bankGrid ?? Array.from({ length: kinds }, (_, i) => fanPose(L.fan, kinds, i).tap)
  const c = (what: string, [x, z]: Spot, w = CARD.w, d = CARD.d): Box => ({ what, x, z, w, d })
  const boxes: Box[] = [
    ...L.hand.map((s, i) => c(`hand ${i}`, s)),
    // (flip charts that make way for the tray: they only have to keep clear of everything but the tray)
    ...(L.k?.tracksYield ? [c('my tracks [yields]', L.k.tracks, tracksBox(L.k.tracksScale).w, tracksBox(L.k.tracksScale).d)] : []),
    // (five kinds of development card; in the expansion, four progress cards at most)
    ...Array.from({ length: knights ? 4 : 5 }, (_, i) => c(`dev ${i}`, L.dev(i))),
    c('roads', L.supply.road, SUPPLY.road.w, SUPPLY.road.d),
    c('settlements', L.supply.settlement, SUPPLY.settlement.w, SUPPLY.settlement.d),
    c('cities', L.supply.city, SUPPLY.city.w, SUPPLY.city.d),
    c('tray', L.tray, TRAY.w, TRAY.d),
    ...L.hand.map((_, i) => c(`want ${i}`, L.wants(i), CARD.w * CARD.small, CARD.d * CARD.small)),
    ...(L.bankGrid
      ? L.bankGrid.map((spot, i) => c(`bank ${i}`, spot, CARD.w * BANK_SCALE, CARD.d * BANK_SCALE))
      : [
          (() => {
            const f = fanBox(L.fan, kinds)
            return { what: 'bank fan', x: (f.x0 + f.x1) / 2, z: (f.z0 + f.z1) / 2, w: f.x1 - f.x0, d: f.z1 - f.z0 }
          })(),
        ]),
    ...(L.k ? [] : [c('deck', L.deck)]),
    c('dice', L.dice, DICE_TRAY.w, DICE_TRAY.d),
    c('my awards', L.awardsMine),
    ...(L.armyMine ? [c('my knights', L.armyMine)] : []),
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
    // (on a phone the buttons keep a finger's size however small the table is drawn: the trade's two, with words,
    // take the whole right half of the bottom)
    portrait && knights ? ui('turn button', -10, maxX, maxZ - 104, maxZ) : ui('turn button', maxX - 150, maxX, maxZ - 76, maxZ),
    ...(L.marks === 'corner' ? [] : [L.marks === 'right'
      ? ui('tray check and cross', L.tray[0] + TRAY.w / 2 + 4, L.tray[0] + TRAY.w / 2 + 62, L.tray[1] - 62, L.tray[1] + 62)
      : ui('tray check and cross', L.tray[0] - TRAY.w / 2 - 62, L.tray[0] - TRAY.w / 2 - 4, L.tray[1] - 62, L.tray[1] + 62)]),
    L.meLabelStart ? ui('your name', L.meLabel[0], L.meLabel[0] + 150, L.meLabel[1] - 30, L.meLabel[1] + 30) : ui('your name', L.meLabel[0] - 62, L.meLabel[0] + 62, L.meLabel[1] - 18, L.meLabel[1] + 18),
    ...L.seats.map(({ p, at }) => {
      const s = seatParts(at, L)
      const [x, z] = s.label
      // (a name in a list carries its three levels on the same line: it's longer)
      return s.labelStart ? ui(`p${p} name`, x, x + 240, z - 22, z + 22) : ui(`p${p} name`, x - 62, x + 62, z - 18, z + 18)
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
