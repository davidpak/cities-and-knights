/**
 * Where everything sits on the table, in millimetres, in the board's frame (+x right, +z toward you). The board is in
 * the middle; your area is the near edge; the other players sit along the far edge; the bank, the dice and the trade
 * tray take the sides (or, on a tall screen, stack above and below the board).
 *
 * Every object's footprint is listed in `boxes`, so a check can prove nothing overlaps.
 */
export type Spot = [number, number]
export type Box = { what: string; x: number; z: number; w: number; d: number; hex?: number }

export const CARD = { w: 64, d: 90, t: 0.9, small: 0.6 } // [D] a card lying flat; small ones (on the tray, and everyone else's on a tall screen) are 60%
/** your hand's stacks lie side by side, nearly touching */
export const HAND_STEP = CARD.w + 2
export const TRAY = { w: 200, d: 150, rim: 6, h: 7 } // [D] the trade tray: near half is what you give, far half what you get
export const DICE_TRAY = { w: 92, d: 62 } // [D] (matches spec DICE.tray)
/** your pieces waiting to be built: a pile of roads, a cluster of houses, a group of cities */
export const SUPPLY = { road: { w: 52, d: 52 }, settlement: { w: 72, d: 50 }, city: { w: 76, d: 54 }, knight: { w: 44, d: 44 }, wall: { w: 62, d: 40 } } // [D]
/** the expansion's boards on the table: your three city tracks as flip charts (everyone else's small, by their cards),
 *  and the barbarians' voyage, a little sea board with their route to the island */
export const TRACKS_BOX = { stand: 70, w: 3 * 70, d: 86 } // [D] yours: three flip charts side by side (drawn at 1.2)
export const SEAT_TRACKS = { scale: 0.36, mine: 1.2 } // [D] everyone else's: the same charts, small
/** the frame round the board: its outside, centre to corner (flat-topped; matches spec SEA.inner + SEA.rim) */
export const FRAME_R = 344

/**
 * The barbarians' raid: big flat-topped hexes, one per step, zig-zagging down beside the board's upper-left side
 * (straight down, down-left, straight down... which runs parallel to that side), from the open sea at the top to the
 * landing beside the board. Hex i of 8: its centre.
 */
export function raidPath(r: number, s0: number, gap = 10): Spot[] {
  const h = (Math.sqrt(3) / 2) * r
  const P0: Spot = [-FRAME_R / 2, -(Math.sqrt(3) / 2) * FRAME_R] // the frame's top-left corner
  const u: Spot = [-0.5, Math.sqrt(3) / 2] // along the side, toward its left corner
  const n: Spot = [-Math.sqrt(3) / 2, -0.5] // away from the board
  return Array.from({ length: 8 }, (_, i) => {
    const s = s0 + 1.5 * r * i
    const off = gap + h + (i % 2 === 0 ? h : 0)
    return [P0[0] + s * u[0] + off * n[0], P0[1] + s * u[1] + off * n[1]] as Spot
  })
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

export type Layout = {
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
    tracksYield: boolean
    raid: { r: number; at: Spot[] } // the barbarians' hexes
    decks: Record<'trade' | 'politics' | 'science', Spot>
  } | null
}

/** an opponent's area: their hand (face down), their development cards (face down), knights played, awards.
 *  On a tall screen their cards are small ones (the width there goes to the board) */
export const seatParts = (at: Spot, portrait = false) => {
  const k = portrait ? CARD.small : 1
  const step = CARD.w * k + 8
  return {
    hand: [at[0] - step / 2, at[1]] as Spot,
    dev: [at[0] + step / 2, at[1]] as Spot,
    knights: [at[0] + step * 1.5, at[1]] as Spot,
    awards: [at[0] - step * 1.5, at[1]] as Spot,
    // their name and points, just below their cards (toward the board)
    label: [at[0], at[1] + (CARD.d * k) / 2 + 25] as Spot,
    small: portrait,
  }
}

/** the height kept clear at the top for the two lines (whose turn, what just happened) */
const LINES = 70
/** (on a phone the lines keep a readable size however small the table is drawn, so they take more of it) */
const LINES_TALL = 120
/** where along the board's side the raid starts (mm before the frame's top-left corner, negative: above it) */
const RAID_S0 = { wide: 90, tall: -215 }

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
      const xs3 = spread(others.length, others.length === 3 ? 360 : 300)
      L = {
        ...L,
        seats: others.map((p, i) => ({ p, at: [xs3[i], -395] as Spot })),
        hand: Array.from({ length: 8 }, (_, i): Spot => [-600 + i * HAND_STEP, 392]),
        dev: (i, held = 8) => [-600 + held * HAND_STEP + 22 + i * HAND_STEP, 392],
        meLabel: [-560, 312],
        supply: { road: [-614, 160], settlement: [-540, 160], city: [-455, 160] },
        awardsMine: [412, 392],
        tray: [540, 30],
        marks: 'left',
        wants: (i) => [540 + ((i % 4) - 1.5) * 42, i < 4 ? -140 : -80],
        fan: [540, -205],
        deck: [578, -420],
        dice: [560, 175],
        flash: [540, 30],
        k: {
          knights: [[-620, 225], [-572, 225], [-524, 225]],
          wall: [-460, 225],
          points: [342, 392],
          tracks: [-370, 295],
          tracksYield: false,
          raid: { r: 36, at: raidPath(36, RAID_S0.wide) },
          decks: { trade: [535, -420], politics: [578, -420], science: [621, -420] },
        },
      }
    }
  } else {
    // stacked: everyone else, the bank and dice, the board, the tray, your hand, then your development cards
    // and pieces
    const xs = spread(others.length, others.length === 2 ? 180 : 268)
    L = {
      portrait,
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
        seats: others.map((p, i) => ({ p, at: [xs[i], -700] as Spot })),
        hand: Array.from({ length: 8 }, (_, i): Spot => [-300 + i * HAND_STEP, 560]),
        dev: (i) => [-80 + i * 70, 660],
        supply: { road: [-330, 660], settlement: [-255, 660], city: [-170, 660] },
        meLabel: [-262, 462],
        tray: [0, 430],
        marks: 'corner',
        wants: (i) => [(i < 4 ? -1 : 1) * (TRAY.w / 2 + 8 + 19 + (i % 2 ? 44 : 0)), 430 + ((i % 4) < 2 ? -30 : 30)],
        fan: [215, -430],
        deck: [195, -575],
        dice: [300, 330],
        flash: [0, 420],
        awardsMine: [10, 756],
        bounds: { minX: -362, maxX: 362, minZ: -855, maxZ: 810 },
        k: {
          knights: [[-330, 756], [-280, 756], [-230, 756]],
          wall: [-160, 756],
          points: [-60, 756],
          tracks: [0, 462],
          tracksYield: true,
          raid: { r: 40, at: raidPath(40, RAID_S0.tall) },
          decks: { trade: [150, -575], politics: [195, -575], science: [240, -575] },
        },
      }
  }

  const kinds = knights ? 8 : 5
  L.bank = Array.from({ length: kinds }, (_, i) => fanPose(L.fan, kinds, i).tap)
  const c = (what: string, [x, z]: Spot, w = CARD.w, d = CARD.d): Box => ({ what, x, z, w, d })
  const boxes: Box[] = [
    ...L.hand.map((s, i) => c(`hand ${i}`, s)),
    // (flip charts that make way for the tray: they only have to keep clear of everything but the tray)
    ...(L.k?.tracksYield ? [c('my tracks [yields]', L.k.tracks, TRACKS_BOX.w, TRACKS_BOX.d)] : []),
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
          ...(L.k.tracksYield ? [] : [c('my tracks', L.k.tracks, TRACKS_BOX.w, TRACKS_BOX.d)]),
          ...L.k.raid.at.map(([x, z], i): Box => ({ what: `raid ${i}`, x, z, w: 2 * L.k!.raid.r, d: Math.sqrt(3) * L.k!.raid.r, hex: L.k!.raid.r })),
          ...Object.entries(L.k.decks).map(([t, s]) => c(`${t} deck`, s, CARD.w * CARD.small, CARD.d * CARD.small)),
        ]
      : []),
    ...L.seats.flatMap(({ p, at }) => {
      const s = seatParts(at, portrait)
      const k = s.small ? CARD.small : 1
      return [c(`p${p} hand`, s.hand, CARD.w * k, CARD.d * k), c(`p${p} dev`, s.dev, CARD.w * k, CARD.d * k), c(`p${p} knights`, s.knights, CARD.w * k, CARD.d * k), c(`p${p} awards`, s.awards, CARD.w * k, CARD.d * k)]
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
      const [x, z] = seatParts(at, portrait).label
      return ui(`p${p} name`, x - 62, x + 62, z - 18, z + 18)
    }),
  )
  return { ...L, boxes }
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
          if (a.what.startsWith('raid') && b.what.startsWith('raid')) return
          const yields = (x: Box) => x.what.includes('[yields]')
          const trayish = (x: Box) => x.what === 'tray' || x.what.startsWith('want') || x.what.startsWith('[tray')
          if ((yields(a) && trayish(b)) || (yields(b) && trayish(a))) return
          if (Math.abs(a.x - b.x) * 2 < a.w + b.w + 4 && Math.abs(a.z - b.z) * 2 < a.d + b.d + 4) hits.push(`${a.what} / ${b.what}`)
        }),
      )
      for (const a of L.boxes) {
        const pts = a.hex
          ? [[a.x, a.z], ...Array.from({ length: 6 }, (_, k) => [a.x + a.hex! * Math.cos((k * Math.PI) / 3), a.z + a.hex! * Math.sin((k * Math.PI) / 3)])]
          : [-1, 0, 1].flatMap((sx) => [-1, 0, 1].map((sz) => [a.x + (sx * a.w) / 2, a.z + (sz * a.d) / 2]))
        if (pts.some(([x, z]) => inFrame(x, z))) hits.push(`${a.what} / board`)
        const { minX, maxX, minZ, maxZ } = L.bounds
        if (a.x - a.w / 2 < minX || a.x + a.w / 2 > maxX || a.z - a.d / 2 < minZ || a.z + a.d / 2 > maxZ) hits.push(`${a.what} outside the view`)
      }
      out.push({ what: `${knights ? 'knights, ' : ''}${portrait ? 'tall' : 'wide'} table, ${n} players: nothing overlaps`, ok: hits.length === 0, value: hits.length ? hits.slice(0, 4).join('; ') : `${L.boxes.length} things placed` })
    }
  }
  return out
}
