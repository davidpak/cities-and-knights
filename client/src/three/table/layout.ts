/**
 * Where everything sits on the table, in millimetres, in the board's frame (+x right, +z toward you). The board is in
 * the middle; your area is the near edge; the other players sit along the far edge; the bank, the dice and the trade
 * tray take the sides (or, on a tall screen, stack above and below the board).
 *
 * Every object's footprint is listed in `boxes`, so a check can prove nothing overlaps.
 */
export type Spot = [number, number]
export type Box = { what: string; x: number; z: number; w: number; d: number }

export const CARD = { w: 40, d: 56, t: 0.8, small: 0.62 } // [D] a card lying flat; small ones are 62% (on the tray)
export const TRAY = { w: 200, d: 150, rim: 6, h: 7 } // [D] the trade tray: near half is what you give, far half what you get
export const DICE_TRAY = { w: 92, d: 62 } // [D] (matches spec DICE.tray)

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

/** an opponent's area: their hand (face down), their development cards (face down), knights played, awards */
export const seatParts = (at: Spot, portrait = false) => ({
  hand: [at[0] - 26, at[1]] as Spot,
  dev: [at[0] + 26, at[1]] as Spot,
  knights: [at[0] + 78, at[1]] as Spot,
  awards: [at[0] - 80, at[1]] as Spot,
  // below their cards, toward the board (on a tall screen, above them: the bank sits below)
  label: [at[0], portrait ? at[1] - 50 : at[1] + 62] as Spot,
})

export function layoutFor(players: number, you: number, aspect: number): Layout {
  const portrait = aspect < 0.95
  const others = Array.from({ length: players }, (_, i) => i).filter((i) => i !== you)
  const spread = (n: number, w: number) => (n === 1 ? [0] : Array.from({ length: n }, (_, i) => -w + (2 * w * i) / (n - 1)))

  let L: Omit<Layout, 'boxes'>
  if (!portrait) {
    const xs = spread(others.length, others.length === 2 ? 230 : 430)
    L = {
      portrait,
      hand: Array.from({ length: 5 }, (_, i): Spot => [-124 + i * 62, 402]),
      dev: (i) => [196 + i * 47, 402],
      supply: { road: [-345, 402], settlement: [-283, 402], city: [-222, 402] },
      awardsMine: [-470, 402],
      meLabel: [0, 452],
      tray: [-505, 205],
      wants: (i) => [-505 - 2 * 30 + i * 30, 205 - TRAY.d / 2 - 26],
      bank: Array.from({ length: 5 }, (_, i): Spot => [445 + (i % 3) * 58, -42 + Math.floor(i / 3) * 78]),
      deck: [561, 36],
      dice: [505, 222],
      seats: others.map((p, i) => ({ p, at: [xs[i], -410] as Spot })),
      bounds: { minX: -620, maxX: 620, minZ: -475, maxZ: 448 },
    }
  } else {
    const xs = spread(others.length, others.length === 2 ? 175 : 250)
    L = {
      portrait,
      hand: Array.from({ length: 5 }, (_, i): Spot => [-124 + i * 62, 556]),
      dev: (i) => [40 + i * 47, 636],
      supply: { road: [-330, 636], settlement: [-268, 636], city: [-207, 636] },
      awardsMine: [-330, 556],
      meLabel: [0, 604],
      tray: [0, 424],
      wants: (i) => [-2 * 30 + i * 30, 424 - TRAY.d / 2 - 24],
      bank: Array.from({ length: 5 }, (_, i): Spot => [-172 + i * 56, -390]),
      deck: [108, -390],
      dice: [250, -390],
      seats: others.map((p, i) => ({ p, at: [xs[i], -505] as Spot })),
      bounds: { minX: -375, maxX: 375, minZ: -680, maxZ: 686 }, // room at the top for the two lines
    }
  }

  const c = (what: string, [x, z]: Spot, w = CARD.w, d = CARD.d): Box => ({ what, x, z, w, d })
  const boxes: Box[] = [
    ...L.hand.map((s, i) => c(`hand ${i}`, s)),
    ...[0, 1, 2, 3, 4].map((i) => c(`dev ${i}`, L.dev(i))),
    c('roads', L.supply.road, 34, 30),
    c('settlements', L.supply.settlement, 40, 40),
    c('cities', L.supply.city, 44, 40),
    c('tray', L.tray, TRAY.w, TRAY.d),
    ...[0, 1, 2, 3, 4].map((i) => c(`want ${i}`, L.wants(i), CARD.w * CARD.small, CARD.d * CARD.small)),
    ...L.bank.map((s, i) => c(`bank ${i}`, s)),
    c('deck', L.deck),
    c('dice', L.dice, DICE_TRAY.w, DICE_TRAY.d),
    ...L.seats.flatMap(({ p, at }) => {
      const s = seatParts(at)
      return [c(`p${p} hand`, s.hand), c(`p${p} dev`, s.dev), c(`p${p} knights`, s.knights), c(`p${p} awards`, s.awards, 46, 56)]
    }),
  ]
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
