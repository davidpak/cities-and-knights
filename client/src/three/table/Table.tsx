/**
 * The table round the board: real cards, real pieces. Your cards lie in loose stacks in front of you; your pieces
 * wait in a pile beside them; the bank's cards and its deck sit at the side; everyone else's cards lie face down at
 * their places; a wooden tray takes what you put up for trade.
 *
 * Clicking a thing is the move (see ui/Game.tsx for what each click does).
 *
 * Every card and every piece is a real body (things.ts, Physical.tsx): the game says how many of what lie where, and
 * the bodies fly there and settle; you can pick them up and toss them, and they find their own way home.
 * Cheap however many there are: all the cards are one draw, each kind of piece one more, and nothing steps or draws
 * while everything lies still.
 */
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useEffect, useState } from 'react'
import { BoxGeometry, Vector3 } from 'three'
import { Adaptive } from '../Adaptive.tsx'
import { rim } from '../geometry.ts'
import { Pulse, Robber, Settlement } from '../Pieces.tsx'
import { TOPO } from '../../../../shared/board.ts'
import type { View } from '../../../../shared/engine.ts'
import { CARDS, RESOURCES, type Card, type Hand, type Resource } from '../../../../shared/rules.ts'
import { PAL } from '../../lib/palette.ts'
import { mat } from '../../lib/toy.ts'
import { BoardContents, Fit, Lights, canvasProps, type BoardProps } from '../Board.tsx'
import { Dice } from '../Dice.tsx'
import { setProjector } from '../labels.ts'
import { CAMERA, CITY, DICE, ROAD, SEA, SETTLEMENT, TILE, TOKEN, edgeAt, hexAt, vertexAt } from '../spec.ts'
import { TestHook } from '../TestHook.tsx'
import { trayFace } from './faces.ts'
import { CARD, TRAY, seatParts, type Layout, type Spot } from './layout.ts'
import { Physical, type Static } from './Physical.tsx'
import { VANISH, seeded, type Home, type PileSpec, type Thing } from './things.ts'

const BOX = new BoxGeometry(1, 1, 1)

export type TrayContents = { mode: 'trade' | 'discard'; give: Partial<Hand>; get: Partial<Hand>; locked?: boolean }
type Build = 'road' | 'settlement' | 'city'

export type TableProps = BoardProps & {
  view: View
  layout: Layout
  /** your cards still in your hand (the ones on the tray taken out) */
  hand: Hand | null
  tray: TrayContents | null
  /** what may be clicked right now */
  can: {
    hand: boolean
    tray: boolean
    wants: boolean
    bank: boolean
    deck: boolean
    supply: Record<Build, boolean>
    supplyTap: boolean
    dev: Partial<Record<Card, boolean>>
    opponents: number[]
  }
  building: Build | null
  on: {
    hand: (r: Resource) => void
    trayGive: (r: Resource) => void
    trayGet: (r: Resource) => void
    want: (r: Resource) => void
    bank: (r: Resource) => void
    deck: () => void
    dev: (c: Card) => void
    supply: (w: Build) => void
    opponent: (p: number) => void
  }
}

// ---------------------------------------------------------------- the piles: what lies where, as the game says

type Spec = PileSpec
const CT = CARD.t
const TRAY_FLOOR = 4

/** slot i of a card pile: stacked straight up, each card a little askew */
const cardHome = (id: string, at: Spot, opts: { base?: number; faceDown?: boolean; turn?: number; loose?: number } = {}) => (i: number): Home => {
  const r = seeded(`${id}:${i}`)
  const loose = opts.loose ?? 1.4
  return {
    x: at[0] + (r() - 0.5) * 2 * loose,
    y: (opts.base ?? 0) + CT / 2 + i * CT,
    z: at[1] + (r() - 0.5) * 2 * loose,
    yaw: (opts.turn ?? 0) + (r() - 0.5) * 0.09,
    flip: opts.faceDown,
  }
}

/** your waiting pieces: roads criss-crossed in layers of three, houses and cities in little rows (slot by slot, so
 *  taking one leaves the rest where they are) */
function supplyHome(what: Build, at: Spot) {
  return (i: number): Home => {
    const r = seeded(`${what}${i}`)
    if (what === 'road') {
      const layer = Math.floor(i / 3)
      const k = i % 3
      const across = layer % 2 === 1
      const off = (k - 1) * 11
      return { x: at[0] + (across ? off : 0), y: layer * ROAD.h, z: at[1] + (across ? 0 : off), yaw: (across ? Math.PI / 2 : 0) + (r() - 0.5) * 0.1 }
    }
    const cols = what === 'city' ? 2 : 3
    const sx = what === 'city' ? 37 : 22
    const row = Math.floor(i / cols)
    const col = i % cols
    const inRow = Math.min(cols, (what === 'city' ? 4 : 5) - row * cols)
    return { x: at[0] + (col - (inRow - 1) / 2) * sx + (r() - 0.5) * 2, y: 0, z: at[1] + (row - 0.5) * 24 + (r() - 0.5) * 2, yaw: (r() - 0.5) * 0.3 }
  }
}

function useSpecs({ view, layout, hand, tray, can, on, building }: TableProps): Spec[] {
  const me = view.you
  const pl = me >= 0 ? view.players[me] : null
  const specs: Spec[] = []
  const card = (s: Omit<Spec, 'kind'>) => specs.push({ kind: 'card', ...s })
  const seatOf = (p: number) => layout.seats.find((x) => x.p === p)
  const homeOf = (p: number): Spot => (p === me ? layout.hand[2] : seatParts(seatOf(p)?.at ?? [0, -400], layout.portrait).hand)

  // your hand: one stack per kind
  if (hand)
    RESOURCES.forEach((r, i) => {
      const id = `hand:${r}`
      card({ id, family: 'res', look: `res:${r}`, n: hand[r], home: cardHome(id, layout.hand[i]), enabled: can.hand && hand[r] > 0, onClick: () => on.hand(r) })
    })
  // your development cards, by kind; the ones you can play now stand a little proud
  const cards = pl?.cards ?? []
  CARDS.filter((c) => cards.some((x) => x.card === c)).forEach((c, i) => {
    const id = `dev:${c}`
    card({ id, family: 'dev', look: `dev:${c}`, n: cards.filter((x) => x.card === c).length, home: cardHome(id, layout.dev(i)), lift: can.dev[c] ? 3 : 0, enabled: !!can.dev[c], onClick: () => on.dev(c) })
  })
  // the bank: five stacks and the deck, face down
  RESOURCES.forEach((r, i) => {
    const id = `bank:${r}`
    card({ id, family: 'res', look: `res:${r}`, n: view.bank[r], home: cardHome(id, layout.bank[i], { loose: 0.8 }), from: layout.bank[i], to: layout.bank[i], enabled: can.bank && view.bank[r] > 0, onClick: () => on.bank(r) })
  })
  card({ id: 'deck', family: 'dev', look: 'dev:?', n: view.pile, home: cardHome('deck', layout.deck, { faceDown: true, loose: 0.8 }), hidden: true, from: layout.deck, to: layout.deck, enabled: can.deck, onClick: on.deck })
  // everyone else: their cards face down, their development cards face down, the knights they've played
  for (const { p, at } of layout.seats) {
    const o = view.players[p]
    const parts = seatParts(at, layout.portrait)
    const small = parts.small
    card({ id: `opp:${p}`, family: 'res', look: 'res:?', n: o.handCount, small, home: cardHome(`opp:${p}`, parts.hand, { faceDown: true, loose: 3 }), hidden: true, from: parts.hand, to: parts.hand, enabled: can.opponents.includes(p), onClick: () => on.opponent(p) })
    card({ id: `odev:${p}`, family: 'dev', look: 'dev:?', n: o.cardCount, small, home: cardHome(`odev:${p}`, parts.dev, { faceDown: true, loose: 2.5 }), hidden: true, from: parts.dev, to: parts.dev })
    card({ id: `kn:${p}`, family: 'dev', look: 'dev:knight', n: o.knights, small, home: cardHome(`kn:${p}`, parts.knights, { loose: 4 }), from: parts.knights, to: parts.knights })
  }
  // the two award cards, with whoever holds them
  const award = (what: 'road' | 'army', p: number | null) => {
    if (p === null || p < 0) return
    const at: Spot = p === me ? layout.awardsMine : seatParts(seatOf(p)?.at ?? [0, -400], layout.portrait).awards
    const [x, z] = what === 'road' ? [at[0], at[1] - 6] : [at[0] + 6, at[1] + 6]
    const small = p !== me && layout.portrait
    card({ id: `${what}:${p}`, family: `award:${what}`, look: `award:${what}`, n: 1, small, home: cardHome(`${what}:${p}`, [x, z], { turn: what === 'road' ? 0.08 : -0.08, base: what === 'army' ? CT : 0, loose: 0 }) })
  }
  award('road', view.longestRoad)
  award('army', view.largestArmy)
  // the tray: what you give on the near half, what you get on the far half; behind it, one of each kind to ask for
  if (tray) {
    const [tx, tz] = layout.tray
    const row = (h: Partial<Hand>, z: number, side: 'give' | 'get') => {
      const kinds = RESOURCES.filter((r) => (h[r] ?? 0) > 0)
      kinds.forEach((r, i) => {
        const id = `tray:${side}:${r}`
        const at: Spot = [tx + (i - (kinds.length - 1) / 2) * (CARD.w * CARD.small + 6), z]
        // an offer to you: your side comes out of your hand, theirs from their cards; what you ask for, from the bank
        const src = side === 'give' ? layout.hand[RESOURCES.indexOf(r)] : view.offer && view.offer.from !== me ? homeOf(view.offer.from) : layout.bank[RESOURCES.indexOf(r)]
        card({ id, family: 'res', look: `res:${r}`, n: h[r] ?? 0, small: true, home: cardHome(id, at, { base: TRAY_FLOOR, loose: 1.8 }), from: src, to: src, enabled: can.tray && !tray.locked, onClick: () => (side === 'give' ? on.trayGive(r) : on.trayGet(r)) })
      })
    }
    row(tray.give, tz + (tray.mode === 'trade' ? TRAY.d / 4 : 0), 'give')
    if (tray.mode === 'trade') row(tray.get, tz - TRAY.d / 4, 'get')
    if (tray.mode === 'trade' && !tray.locked)
      RESOURCES.forEach((r, i) => {
        const id = `want:${r}`
        card({ id, family: 'want', look: `res:${r}`, n: 1, small: true, home: cardHome(id, layout.wants(i), { loose: 0 }), enabled: can.wants, onClick: () => on.want(r) })
      })
  }
  // your waiting pieces (the board's pieces aren't bodies: they're fixed where they're built). One you build flies
  // from here to its spot; a settlement a city replaces comes back from there
  const lastMine = (what: Build) => {
    for (let i = view.events.length - 1; i >= 0; i--) {
      const e = view.events[i]
      if (e.k === 'build' && e.p === me && e.what === what) return e.at
    }
    return null
  }
  const spot = (what: Build): Spot | undefined => {
    const at = lastMine(what)
    if (at === null) return undefined
    const [x, z] = what === 'road' ? edgeAt(at) : vertexAt(at)
    return [x, z]
  }
  const yaw = (what: Build) => {
    const at = lastMine(what)
    return what === 'road' && at !== null ? -TOPO.edges[at].angle : 0
  }
  if (pl)
    (['road', 'settlement', 'city'] as const).forEach((w) =>
      specs.push({
        id: `supply:${w}`,
        kind: w,
        family: `piece:${w}:${pl.color}`,
        look: pl.color,
        n: pl.pieces[w],
        home: supplyHome(w, layout.supply[w]),
        to: spot(w),
        toY: TILE.h,
        toYaw: yaw(w),
        from: w === 'settlement' ? spot('city') : undefined,
        lift: building === w ? 12 : 0,
        enabled: can.supply[w] || can.supplyTap || building === w,
        onClick: () => on.supply(w),
      }),
    )
  return specs
}

/** the fixed things the loose ones rest on and bump into */
function staticsFor(layout: Layout, tray: boolean, { tiles, buildings, roads }: TableProps): Record<string, Static[]> {
  const out: Static[] = [{ box: [5000, 50, 5000], at: [0, -50, 0] }]
  const trayParts: Static[] = []
  // the board, flat at the tiles' tops (pieces never tip into the gaps), its frame, and the number tokens
  const hex = (r: number, y0: number, y1: number) => new Float32Array(Array.from({ length: 6 }, (_, i) => [r * Math.cos((i * Math.PI) / 3), 0, r * Math.sin((i * Math.PI) / 3)]).flatMap(([x, , z]) => [x, y0, z, x, y1, z]))
  out.push({ hull: hex(SEA.inner, 0, TILE.h) })
  const ap = SEA.inner * Math.cos(Math.PI / 6)
  for (let i = 0; i < 6; i++) {
    const a = (i * Math.PI) / 3 + Math.PI / 6
    const d = ap + SEA.rim / 2
    out.push({ box: [SEA.inner / 2 + SEA.rim, SEA.rimH / 2, SEA.rim / 2], at: [d * Math.cos(a), SEA.rimH / 2, d * Math.sin(a)], yaw: -(a + Math.PI / 2) })
  }
  tiles.forEach((t, i) => {
    if (t.number === null) return
    const [x, z] = hexAt(i)
    out.push({ cyl: [TOKEN.h / 2, TOKEN.r], at: [x, TILE.h + TOKEN.h / 2, z] })
  })
  // the trade tray
  if (tray) {
    const [tx, tz] = layout.tray
    trayParts.push({ box: [TRAY.w / 2, TRAY_FLOOR / 2, TRAY.d / 2], at: [tx, TRAY_FLOOR / 2, tz] })
    trayParts.push({ box: [TRAY.w / 2, TRAY.h / 2, TRAY.rim / 2], at: [tx, TRAY.h / 2, tz - TRAY.d / 2] })
    trayParts.push({ box: [TRAY.w / 2, TRAY.h / 2, TRAY.rim / 2], at: [tx, TRAY.h / 2, tz + TRAY.d / 2] })
    trayParts.push({ box: [TRAY.rim / 2, TRAY.h / 2, TRAY.d / 2], at: [tx - TRAY.w / 2, TRAY.h / 2, tz] })
    trayParts.push({ box: [TRAY.rim / 2, TRAY.h / 2, TRAY.d / 2], at: [tx + TRAY.w / 2, TRAY.h / 2, tz] })
  }
  // the dice tray
  const D = DICE.tray
  const [dx, dz] = layout.dice
  out.push({ box: [D.w / 2, D.felt / 2, D.d / 2], at: [dx, D.felt / 2, dz] })
  for (const [ox, oz, hx, hz] of [
    [0, -(D.d - D.rim) / 2, D.w / 2, D.rim / 2],
    [0, (D.d - D.rim) / 2, D.w / 2, D.rim / 2],
    [-(D.w - D.rim) / 2, 0, D.rim / 2, D.d / 2],
    [(D.w - D.rim) / 2, 0, D.rim / 2, D.d / 2],
  ])
    out.push({ box: [hx, D.h / 2, hz], at: [dx + ox, D.h / 2, dz + oz] })
  // the pieces on the board: fixed, but solid (a card tossed onto the board lands on them, not through them)
  const pieces: Static[] = []
  for (const [v, b] of Object.entries(buildings)) {
    const [x, z] = vertexAt(Number(v))
    const [w, h, d] = b.kind === 'city' ? [CITY.w, CITY.peak, CITY.d] : [SETTLEMENT.w, SETTLEMENT.peak, SETTLEMENT.d]
    pieces.push({ box: [w / 2, h / 2, d / 2], at: [x, TILE.h + h / 2, z] })
  }
  for (const [e] of Object.entries(roads)) {
    const [x, z] = edgeAt(Number(e))
    pieces.push({ box: [ROAD.len / 2, ROAD.h / 2, ROAD.w / 2], at: [x, TILE.h + ROAD.h / 2, z], yaw: -TOPO.edges[Number(e)].angle })
  }
  return { base: out, tray: trayParts, pieces }
}

/** a dark place on the table where an empty pile goes (your hand, someone's cards), still clickable */
function Slots({ view, layout, hand, can, on }: TableProps) {
  const slots: { id: string; at: Spot; k: number; onClick?: () => void }[] = []
  if (hand) RESOURCES.forEach((r, i) => hand[r] <= 0 && slots.push({ id: `h${r}`, at: layout.hand[i], k: 1 }))
  for (const { p, at } of layout.seats)
    if (view.players[p].handCount <= 0) slots.push({ id: `o${p}`, at: seatParts(at, layout.portrait).hand, k: layout.portrait ? CARD.small : 1, onClick: can.opponents.includes(p) ? () => on.opponent(p) : undefined })
  return (
    <>
      {slots.map((p) => (
        <mesh
          key={p.id}
          geometry={BOX}
          material={mat('#3b2a1d')}
          scale={[CARD.w * p.k, 0.3, CARD.d * p.k]}
          position={[p.at[0], 0.15, p.at[1]]}
          receiveShadow
          onClick={(e) => {
            if (!p.onClick) return
            e.stopPropagation()
            p.onClick()
          }}
        />
      ))}
    </>
  )
}

/** a mat under the pieces you can build right now */
function SupplyMats({ layout, can, building }: TableProps) {
  return (
    <>
      {(['road', 'settlement', 'city'] as const)
        .filter((w) => can.supply[w] || building === w)
        .map((w) => (
          <mesh key={w} geometry={BOX} material={mat(building === w ? '#e3a72c' : PAL.cream)} scale={[w === 'road' ? 44 : w === 'city' ? 70 : 64, 0.6, 50]} position={[layout.supply[w][0], 0.3, layout.supply[w][1]]} receiveShadow />
        ))}
    </>
  )
}

// ---------------------------------------------------------------- the trade tray

let trayRim: ReturnType<typeof rim> | null = null
/** the trade tray: a wooden floor (its markings painted on) inside one solid rim; two draws */
function Tray({ at, mode }: { at: Spot; mode: 'trade' | 'discard' }) {
  const [tx, tz] = at
  trayRim ??= rim(TRAY.w + TRAY.rim, TRAY.d + TRAY.rim, TRAY.rim, TRAY.h)
  return (
    <group>
      <mesh geometry={BOX} material={mat('#ffffff', { map: trayFace(mode) })} scale={[TRAY.w, TRAY_FLOOR, TRAY.d]} position={[tx, TRAY_FLOOR / 2, tz]} receiveShadow castShadow />
      <mesh geometry={trayRim} material={mat('#8a5e3c')} position={[tx, 0, tz]} castShadow receiveShadow />
    </group>
  )
}

// ---------------------------------------------------------------- the scene

/** tells the HTML labels where things are on screen (when the window changes size) */
function Projector() {
  const { camera, size, gl } = useThree()
  useEffect(() => {
    const v = new Vector3()
    const id = requestAnimationFrame(() => {
      const rect = gl.domElement.getBoundingClientRect()
      setProjector((x, y, z) => {
        v.set(x, y, z).project(camera)
        return [((v.x + 1) / 2) * rect.width, ((1 - v.y) / 2) * rect.height]
      })
    })
    return () => cancelAnimationFrame(id)
  }, [camera, size.width, size.height, gl])
  return null
}

/** the table top fills the screen, so it's drawn last: wherever something covers it, the GPU skips it */
function TableTop() {
  return <mesh geometry={BOX} material={mat('#5a3d29')} scale={[8000, 2, 8000]} position={[0, -1, 0]} receiveShadow renderOrder={1} />
}

/**
 * Everything that only appears later (the tray, a ghost piece, the build markers, a pulse), drawn once, tiny and
 * out of sight, as the table opens: its shaders are built now, while the table loads, not in the middle of a move.
 */
function Warmup() {
  const [frames, setFrames] = useState(0)
  useFrame(() => {
    if (frames < 3) setFrames((f) => f + 1)
  })
  if (frames >= 3) return null
  return (
    <group position={[0, -40, 0]} scale={0.001}>
      <Tray at={[0, 0]} mode="trade" />
      <Tray at={[0, 0]} mode="discard" />
      <Settlement ghost color="red" x={0} z={0} />
      <Robber ghost x={0} z={0} />
      <Pulse x={0} z={0} color="#ffffff" onDone={() => {}} />
      <mesh geometry={BOX} material={mat('#3b2a1d')} />
      <mesh geometry={BOX} material={mat('#e3a72c')} />
      <mesh geometry={BOX} material={mat(PAL.cream)} />
    </group>
  )
}

export function TableView(props: TableProps) {
  const { layout, tray, on, can } = props
  const specs = useSpecs(props)
  const statics = staticsFor(layout, !!tray, props)
  const reach = Math.max(-layout.bounds.minX, layout.bounds.maxX, -layout.bounds.minZ, layout.bounds.maxZ) + 40
  // a card from your hand dropped on the tray goes on the tray
  const onDrop = (t: Thing, at: Vector3) => {
    if (!tray || !can.hand || !t.pile?.startsWith('hand:')) return
    if (Math.abs(at.x - layout.tray[0]) < TRAY.w / 2 && Math.abs(at.z - layout.tray[1]) < TRAY.d / 2) on.hand(t.pile.slice(5) as Resource)
  }
  return (
    <Canvas {...canvasProps()}>
      <Lights extent={reach} />
      <Fit bounds={layout.bounds} tilt={layout.portrait ? CAMERA.tilt + 0.08 : CAMERA.tilt + 0.14} />
      <TableTop />
      <BoardContents {...props} arrive={VANISH} />
      <Dice dice={props.dice ?? null} rolls={props.rolls ?? 0} onRoll={props.onRoll} at={layout.dice} />
      {tray && <Tray at={layout.tray} mode={tray.mode} />}
      <Slots {...props} />
      <SupplyMats {...props} />
      <Physical specs={specs} statics={statics} onDrop={onDrop} />
      <Warmup />
      <Adaptive />
      <Projector />
      <TestHook />
    </Canvas>
  )
}
