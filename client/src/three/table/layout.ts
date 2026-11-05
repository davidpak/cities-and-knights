/**
 * Where everything sits on the table, in millimetres, in the board's frame (+x right, +z toward you). The board is in
 * the middle; your area is the near edge; the other players sit along the far edge; the bank, the dice and the trade
 * tray take the sides (or, on a tall screen, stack above and below the board).
 *
 * Every object's footprint is listed in `boxes`, so a check can prove nothing overlaps.
 */
export type Spot = [number, number]
export type Box = { what: string; x: number; z: number; w: number; d: number }

export const CARD = { w: 64, d: 90, t: 0.9, small: 0.6 } // [D] a card lying flat; small ones (on the tray, and everyone else's on a tall screen) are 60%
export const TRAY = { w: 200, d: 150, rim: 6, h: 7 } // [D] the trade tray: near half is what you give, far half what you get
export const DICE_TRAY = { w: 92, d: 62 } // [D] (matches spec DICE.tray)
/** your pieces waiting to be built: a pile of roads, a cluster of houses, a group of cities */
export const SUPPLY = { road: { w: 52, d: 52 }, settlement: { w: 72, d: 50 }, city: { w: 76, d: 54 } } // [D]

export type Layout = {
  portrait: boolean
  hand: Spot[] // your five resource stacks
  dev: (i: number) => Spot // your development cards, by kind
  supply: { road: Spot; settlement: Spot; city: Spot }
  awardsMine: Spot
  meLabel: Spot
  tray: Spot
  wants: (i: number) => Spot // the five "ask for" cards behind the tray
  bank: Spot[] // five resource stacks
  deck: Spot
  dice: Spot
  seats: { p: number; at: Spot }[]
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number }
  boxes: Box[]
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

export function layoutFor(players: number, you: number, aspect: number): Layout {
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
      hand: Array.from({ length: 5 }, (_, i): Spot => [-300 + i * 78, 392]),
      dev: (i) => [84 + i * 74, 392],
      supply: { road: [-590, 190], settlement: [-515, 190], city: [-428, 190] },
      awardsMine: [-560, 318],
      meLabel: [-144, 322],
      tray: [-520, 0],
      wants: (i) => [-520 + (i - 2) * 44, -130],
      bank: Array.from({ length: 5 }, (_, i): Spot => [452 + (i % 3) * 74, -100 + Math.floor(i / 3) * 100]),
      deck: [600, 0],
      dice: [526, 140],
      seats: others.map((p, i) => ({ p, at: [xs[i], -395] as Spot })),
      bounds: { minX: -645, maxX: 645, minZ: -515, maxZ: 450 },
    }
  } else {
    // stacked: everyone else, the bank and dice, the board, the tray, your hand, then your development cards
    // and pieces
    const xs = spread(others.length, others.length === 2 ? 180 : 268)
    L = {
      portrait,
      hand: Array.from({ length: 5 }, (_, i): Spot => [(i - 2) * 76, 620]),
      dev: (i) => [40 + i * 70, 724],
      supply: { road: [-330, 724], settlement: [-255, 724], city: [-170, 724] },
      awardsMine: [-300, 620],
      meLabel: [0, 548],
      tray: [0, 450],
      wants: (i) => [(i - 2) * 44, 450 - TRAY.d / 2 - 32],
      bank: Array.from({ length: 5 }, (_, i): Spot => [-300 + i * 72, -440]),
      deck: [66, -440],
      dice: [200, -440],
      seats: others.map((p, i) => ({ p, at: [xs[i], -560] as Spot })),
      bounds: { minX: -362, maxX: 362, minZ: -665, maxZ: 852 },
    }
  }

  const c = (what: string, [x, z]: Spot, w = CARD.w, d = CARD.d): Box => ({ what, x, z, w, d })
  const boxes: Box[] = [
    ...L.hand.map((s, i) => c(`hand ${i}`, s)),
    ...[0, 1, 2, 3, 4].map((i) => c(`dev ${i}`, L.dev(i))),
    c('roads', L.supply.road, SUPPLY.road.w, SUPPLY.road.d),
    c('settlements', L.supply.settlement, SUPPLY.settlement.w, SUPPLY.settlement.d),
    c('cities', L.supply.city, SUPPLY.city.w, SUPPLY.city.d),
    c('tray', L.tray, TRAY.w, TRAY.d),
    ...[0, 1, 2, 3, 4].map((i) => c(`want ${i}`, L.wants(i), CARD.w * CARD.small, CARD.d * CARD.small)),
    ...L.bank.map((s, i) => c(`bank ${i}`, s)),
    c('deck', L.deck),
    c('dice', L.dice, DICE_TRAY.w, DICE_TRAY.d),
    c('my awards', L.awardsMine),
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
    ui('top lines', -230, 230, minZ, minZ + LINES),
    ui('history', maxX - 110, maxX, minZ, minZ + 56),
    ui('turn button', maxX - 150, maxX, maxZ - 76, maxZ),
    ui('tray check and cross', L.tray[0] + TRAY.w / 2 + 4, L.tray[0] + TRAY.w / 2 + 62, L.tray[1] - 62, L.tray[1] + 62),
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
  const out: { what: string; ok: boolean; value: string }[] = []
  const inFrame = (x: number, z: number) => Math.abs(z) <= (Math.sqrt(3) / 2) * frameR && Math.sqrt(3) * Math.abs(x) + Math.abs(z) <= Math.sqrt(3) * frameR
  for (const portrait of [false, true]) {
    for (const n of [2, 3, 4]) {
      const L = layoutFor(n, 0, portrait ? 0.6 : 1.6)
      const hits: string[] = []
      L.boxes.forEach((a, i) =>
        L.boxes.forEach((b, j) => {
          if (j <= i) return
          if (Math.abs(a.x - b.x) * 2 < a.w + b.w + 4 && Math.abs(a.z - b.z) * 2 < a.d + b.d + 4) hits.push(`${a.what} / ${b.what}`)
        }),
      )
      for (const a of L.boxes) {
        const pts = [-1, 0, 1].flatMap((sx) => [-1, 0, 1].map((sz) => [a.x + (sx * a.w) / 2, a.z + (sz * a.d) / 2]))
        if (pts.some(([x, z]) => inFrame(x, z))) hits.push(`${a.what} / board`)
        const { minX, maxX, minZ, maxZ } = L.bounds
        if (a.x - a.w / 2 < minX || a.x + a.w / 2 > maxX || a.z - a.d / 2 < minZ || a.z + a.d / 2 > maxZ) hits.push(`${a.what} outside the view`)
      }
      out.push({ what: `${portrait ? 'tall' : 'wide'} table, ${n} players: nothing overlaps`, ok: hits.length === 0, value: hits.length ? hits.slice(0, 4).join('; ') : `${L.boxes.length} things placed` })
    }
  }
  return out
}
