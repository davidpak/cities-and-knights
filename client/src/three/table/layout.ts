/**
 * Where everything sits on the table, in millimetres, in the board's frame (+x right, +z toward you). The board is in
 * the middle; your area is the near edge; the other players sit along the far edge; the bank, the dice and the trade
 * tray take the sides (or, on a tall screen, stack above and below the board).
 *
 * Every object's footprint is listed in `boxes`, so a check can prove nothing overlaps.
 */
export type Spot = [number, number]
export type Box = { what: string; x: number; z: number; w: number; d: number }

export const CARD = { w: 54, d: 76, t: 0.9, small: 0.62 } // [D] a card lying flat; small ones (on the tray) are 62%
export const TRAY = { w: 200, d: 150, rim: 6, h: 7 } // [D] the trade tray: near half is what you give, far half what you get
export const DICE_TRAY = { w: 92, d: 62 } // [D] (matches spec DICE.tray)
/** your pieces waiting to be built: a pile of roads, a cluster of houses, a group of cities */
export const SUPPLY = { road: { w: 46, d: 46 }, settlement: { w: 62, d: 42 }, city: { w: 66, d: 46 } } // [D]

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
  hand: [at[0] - 34, at[1]] as Spot,
  dev: [at[0] + 34, at[1]] as Spot,
  knights: [at[0] + (portrait ? 92 : 102), at[1]] as Spot,
  awards: [at[0] - (portrait ? 92 : 102), at[1]] as Spot,
  // their name and points, just below their cards (toward the board)
  label: [at[0], at[1] + (portrait ? 64 : 68)] as Spot,
})

export function layoutFor(players: number, you: number, aspect: number): Layout {
  const portrait = aspect < 0.95
  const others = Array.from({ length: players }, (_, i) => i).filter((i) => i !== you)
  const spread = (n: number, w: number) => (n === 1 ? [0] : Array.from({ length: n }, (_, i) => -w + (2 * w * i) / (n - 1)))

  let L: Omit<Layout, 'boxes'>
  if (!portrait) {
    const xs = spread(others.length, others.length === 2 ? 240 : 440)
    L = {
      portrait,
      hand: Array.from({ length: 5 }, (_, i): Spot => [-150 + i * 75, 420]),
      dev: (i) => [210 + i * 62, 420],
      supply: { road: [-450, 420], settlement: [-372, 420], city: [-285, 420] },
      awardsMine: [-562, 420],
      meLabel: [0, 352],
      tray: [-525, 190],
      wants: (i) => [-525 + (i - 2) * 38, 190 - TRAY.d / 2 - 30],
      bank: Array.from({ length: 5 }, (_, i): Spot => [450 + (i % 3) * 68, -62 + Math.floor(i / 3) * 90]),
      deck: [586, 28],
      dice: [528, 232],
      seats: others.map((p, i) => ({ p, at: [xs[i], -425] as Spot })),
      bounds: { minX: -640, maxX: 640, minZ: -568, maxZ: 498 },
    }
  } else {
    const xs = spread(others.length, others.length === 2 ? 180 : 272)
    L = {
      portrait,
      hand: Array.from({ length: 5 }, (_, i): Spot => [-150 + i * 75, 620]),
      dev: (i) => [40 + i * 64, 724],
      supply: { road: [-335, 724], settlement: [-258, 724], city: [-170, 724] },
      awardsMine: [-300, 620],
      meLabel: [0, 556],
      tray: [0, 450],
      wants: (i) => [(i - 2) * 38, 450 - TRAY.d / 2 - 30],
      bank: Array.from({ length: 5 }, (_, i): Spot => [-175 + i * 70, -430]),
      deck: [175, -430],
      dice: [300, -430],
      seats: others.map((p, i) => ({ p, at: [xs[i], -565] as Spot })),
      bounds: { minX: -392, maxX: 392, minZ: -720, maxZ: 852 },
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
      return [c(`p${p} hand`, s.hand), c(`p${p} dev`, s.dev), c(`p${p} knights`, s.knights), c(`p${p} awards`, s.awards)]
    }),
  ]
  // where the few things drawn over the table sit (sizes at the labels' usual scale; they scale with the table):
  // the two lines at the top, the History button, the turn button, the tray's check and cross, the name tags
  const { maxX, minZ, maxZ } = L.bounds
  const ui = (what: string, x0: number, x1: number, z0: number, z1: number): Box => ({ what: `[${what}]`, x: (x0 + x1) / 2, z: (z0 + z1) / 2, w: x1 - x0, d: z1 - z0 })
  boxes.push(
    ui('top lines', -230, 230, minZ, minZ + 92),
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
