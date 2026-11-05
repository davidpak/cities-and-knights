/**
 * The table round the board: real cards, real pieces. Your cards lie in loose stacks in front of you; your pieces
 * wait in a pile beside them; the bank's cards and its deck sit at the side; everyone else's cards lie face down at
 * their places; a wooden tray takes what you put up for trade.
 *
 * Clicking a thing is the move (see ui/Game.tsx for what each click does).
 *
 * Cheap however many cards there are: every card is its own thin card, but all the cards that look alike draw
 * together (one instanced mesh per face), and so do your waiting pieces. Nothing moves unless something changes.
 */
import { Canvas, useThree, type ThreeEvent } from '@react-three/fiber'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { BoxGeometry, Matrix4, MeshBasicMaterial, MeshLambertMaterial, Quaternion, Vector3, BackSide, type BufferGeometry, type InstancedMesh, type Material, type Texture } from 'three'
import type { View } from '../../../../shared/engine.ts'
import { CARDS, RESOURCES, type Card, type Hand, type PlayerColor, type Resource } from '../../../../shared/rules.ts'
import { PAL, PLAYER } from '../../lib/palette.ts'
import { mat } from '../../lib/toy.ts'
import { BoardContents, Fit, Lights, canvasProps, type BoardProps } from '../Board.tsx'
import { Dice } from '../Dice.tsx'
import { cityGeo, roadGeo, settlementGeo } from '../geometry.ts'
import { setProjector } from '../labels.ts'
import { useRedraw } from '../Pieces.tsx'
import { CAMERA, OUTLINE } from '../spec.ts'
import { TestHook } from '../TestHook.tsx'
import { awardFace, devBack, devFace, resourceBack, resourceFace, trayFace } from './faces.ts'
import { CARD, TRAY, seatParts, type Layout, type Spot } from './layout.ts'

const BOX = new BoxGeometry(1, 1, 1)
const EDGE = new MeshLambertMaterial({ color: '#efe2c4' })
const INK = new MeshBasicMaterial({ color: PAL.ink, side: BackSide })
const faceMats = new Map<Texture, Material>()
const faceMat = (t: Texture) => {
  let m = faceMats.get(t)
  if (!m) faceMats.set(t, (m = new MeshLambertMaterial({ map: t })))
  return m
}

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

// ---------------------------------------------------------------- cards

/** a pile of cards somewhere on the table */
type Pile = {
  id: string
  at: Spot
  n: number
  face: Texture
  back: Texture
  faceDown?: boolean
  small?: boolean
  /** most cards drawn (the count label says the rest) */
  cap?: number
  /** turned about the vertical */
  turn?: number
  /** how loosely the cards lie (mm of jitter) */
  loose?: number
  /** raised (on the tray, or ready to play) */
  lift?: number
  enabled?: boolean
  onClick?: () => void
}

function hash(s: string) {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507)
    h = Math.imul(h ^ (h >>> 13), 3266489909)
    return ((h ^= h >>> 16) >>> 0) / 4294967296
  }
}

const UP = new Vector3(0, 1, 0)
const tmpM = new Matrix4()
const tmpQ = new Quaternion()
const tmpP = new Vector3()
const tmpS = new Vector3()

/** every card on the table, drawn as one instanced mesh per look (face up, face down) */
function Cards({ piles }: { piles: Pile[] }) {
  const [hover, setHover] = useState<string | null>(null)
  const redraw = useRedraw()
  // one instance per visible card, grouped by what its top and bottom show
  const groups = useMemo(() => {
    const out = new Map<string, { top: Texture; bottom: Texture; cards: { pile: Pile; i: number }[] }>()
    for (const pile of piles) {
      const shown = Math.min(pile.n, pile.cap ?? 12)
      if (shown <= 0) continue
      const top = pile.faceDown ? pile.back : pile.face
      const key = `${top.uuid}|${pile.back.uuid}`
      if (!out.has(key)) out.set(key, { top, bottom: pile.back, cards: [] })
      for (let i = 0; i < shown; i++) out.get(key)!.cards.push({ pile, i })
    }
    return [...out.entries()]
  }, [piles])

  return (
    <>
      {groups.map(([key, g]) => (
        <CardGroup key={key} top={g.top} bottom={g.bottom} cards={g.cards} hover={hover} setHover={setHover} redraw={redraw} />
      ))}
      <Slots piles={piles} />
    </>
  )
}

function CardGroup({ top, bottom, cards, hover, setHover, redraw }: { top: Texture; bottom: Texture; cards: { pile: Pile; i: number }[]; hover: string | null; setHover: (id: string | null) => void; redraw: () => void }) {
  const ref = useRef<InstancedMesh>(null)
  const materials = useMemo(() => [EDGE, EDGE, faceMat(top), faceMat(bottom), EDGE, EDGE], [top, bottom])
  const capacity = Math.max(8, 2 ** Math.ceil(Math.log2(cards.length)))
  useLayoutEffect(() => {
    const m = ref.current
    if (!m) return
    cards.forEach(({ pile, i }, k) => {
      const rnd = hash(`${pile.id}:${i}`)
      const s = pile.small ? CARD.small : 1
      const loose = pile.loose ?? 1.4
      const lift = (pile.lift ?? 0) + (hover === pile.id && pile.enabled ? 6 : 0)
      tmpP.set(pile.at[0] + (rnd() - 0.5) * loose * 2, lift + i * (CARD.t + 0.12) + CARD.t / 2, pile.at[1] + (rnd() - 0.5) * loose * 2)
      tmpQ.setFromAxisAngle(UP, (pile.turn ?? 0) + (rnd() - 0.5) * 0.09)
      tmpS.set(CARD.w * s, CARD.t, CARD.d * s)
      m.setMatrixAt(k, tmpM.compose(tmpP, tmpQ, tmpS))
    })
    m.count = cards.length
    m.instanceMatrix.needsUpdate = true
    m.computeBoundingSphere()
    redraw()
  })
  const pileOf = (e: ThreeEvent<PointerEvent | MouseEvent>) => (e.instanceId !== undefined ? cards[e.instanceId]?.pile : undefined)
  return (
    <instancedMesh
      key={capacity}
      ref={ref}
      args={[BOX, materials, capacity]}
      castShadow
      receiveShadow
      onPointerMove={(e) => {
        const p = pileOf(e)
        if (!p?.enabled) return
        e.stopPropagation()
        if (hover !== p.id) setHover(p.id)
        document.body.style.cursor = 'pointer'
      }}
      onPointerOut={() => {
        setHover(null)
        document.body.style.cursor = ''
      }}
      onClick={(e) => {
        const p = pileOf(e)
        if (!p?.enabled || !p.onClick) return
        e.stopPropagation()
        p.onClick()
      }}
    />
  )
}

/** a dark place on the table where an empty pile goes (your hand, someone's cards), still clickable */
function Slots({ piles }: { piles: Pile[] }) {
  return (
    <>
      {piles
        .filter((p) => p.n <= 0 && p.id.startsWith('slot:'))
        .map((p) => (
          <mesh
            key={p.id}
            geometry={BOX}
            material={mat('#3b2a1d')}
            scale={[CARD.w, 0.3, CARD.d]}
            position={[p.at[0], 0.15, p.at[1]]}
            receiveShadow
            onClick={(e) => {
              if (!p.enabled || !p.onClick) return
              e.stopPropagation()
              p.onClick()
            }}
          />
        ))}
    </>
  )
}

// ---------------------------------------------------------------- your pieces waiting to be built

const PIECE_GEO: Record<Build, () => BufferGeometry> = { road: roadGeo, settlement: settlementGeo, city: cityGeo }

/** where each waiting piece sits in its pile: roads criss-crossed in layers, houses and cities in little groups */
function supplySpots(what: Build, n: number): { x: number; y: number; z: number; turn: number }[] {
  return Array.from({ length: n }, (_, i) => {
    const rnd = hash(`${what}${i}`)
    if (what === 'road') {
      const layer = Math.floor(i / 3)
      const k = i % 3
      const across = layer % 2 === 1
      const off = (k - 1) * 10
      return { x: across ? off : 0, y: layer * 6.1, z: across ? 0 : off, turn: (across ? Math.PI / 2 : 0) + (rnd() - 0.5) * 0.12 }
    }
    const cols = what === 'city' ? 2 : 3
    const sx = what === 'city' ? 32 : 21
    const row = Math.floor(i / cols)
    const col = i % cols
    const inRow = Math.min(cols, n - row * cols)
    return { x: (col - (inRow - 1) / 2) * sx + (rnd() - 0.5) * 2, y: 0, z: (row - 0.5) * 20 + (rnd() - 0.5) * 2, turn: (rnd() - 0.5) * 0.5 }
  })
}

function Supply({ what, at, n, color, enabled, up, ready, onClick }: { what: Build; at: Spot; n: number; color: PlayerColor; enabled: boolean; up: boolean; ready: boolean; onClick: () => void }) {
  const body = useRef<InstancedMesh>(null)
  const line = useRef<InstancedMesh>(null)
  const [hover, setHover] = useState(false)
  const geo = PIECE_GEO[what]()
  const materials = useMemo(() => [mat(PLAYER[color].body), mat(PLAYER[color].roof)], [color])
  const redraw = useRedraw()
  const outline = useMemo(() => {
    geo.computeBoundingBox()
    const b = geo.boundingBox!
    const t = OUTLINE.mm
    const size = new Vector3().subVectors(b.max, b.min)
    const s = new Vector3((size.x + 2 * t) / size.x, (size.y + 2 * t) / size.y, (size.z + 2 * t) / size.z)
    const c = new Vector3().addVectors(b.max, b.min).multiplyScalar(0.5)
    return new Matrix4().compose(new Vector3(c.x * (1 - s.x), c.y * (1 - s.y), c.z * (1 - s.z)), new Quaternion(), s)
  }, [geo])
  useLayoutEffect(() => {
    const lift = up ? 12 : hover && enabled ? 5 : 0
    supplySpots(what, n).forEach((p, i) => {
      tmpM.compose(tmpP.set(at[0] + p.x, p.y + lift, at[1] + p.z), tmpQ.setFromAxisAngle(UP, p.turn), tmpS.set(1, 1, 1))
      body.current?.setMatrixAt(i, tmpM)
      line.current?.setMatrixAt(i, tmpM.clone().multiply(outline))
    })
    for (const m of [body.current, line.current]) {
      if (!m) continue
      m.count = n
      m.instanceMatrix.needsUpdate = true
      m.computeBoundingSphere()
    }
    redraw()
  })
  const handlers = {
    onPointerOver: (e: ThreeEvent<PointerEvent>) => {
      if (!enabled) return
      e.stopPropagation()
      setHover(true)
      document.body.style.cursor = 'pointer'
    },
    onPointerOut: () => {
      setHover(false)
      document.body.style.cursor = ''
    },
    onClick: (e: ThreeEvent<MouseEvent>) => {
      if (!enabled) return
      e.stopPropagation()
      onClick()
    },
  }
  return (
    <group>
      {/* a mat under the pieces you can build right now */}
      {(ready || up) && <mesh geometry={BOX} material={mat(up ? '#e3a72c' : PAL.cream)} scale={[what === 'road' ? 44 : what === 'city' ? 66 : 62, 0.6, 44]} position={[at[0], 0.3, at[1]]} receiveShadow {...handlers} />}
      <instancedMesh ref={body} args={[geo, materials, 16]} castShadow receiveShadow {...handlers} />
      <instancedMesh ref={line} args={[geo, INK, 16]} />
    </group>
  )
}

// ---------------------------------------------------------------- the trade tray

function Tray({ at, mode }: { at: Spot; mode: 'trade' | 'discard' }) {
  const [tx, tz] = at
  return (
    <group>
      <mesh geometry={BOX} material={[mat('#a87b50'), mat('#a87b50'), faceMat(trayFace(mode)), mat('#8a5e3c'), mat('#a87b50'), mat('#a87b50')]} scale={[TRAY.w, 4, TRAY.d]} position={[tx, 2, tz]} receiveShadow castShadow />
      {[
        [0, -TRAY.d / 2, TRAY.w, TRAY.rim],
        [0, TRAY.d / 2, TRAY.w, TRAY.rim],
        [-TRAY.w / 2, 0, TRAY.rim, TRAY.d],
        [TRAY.w / 2, 0, TRAY.rim, TRAY.d],
      ].map(([x, z, w, d], i) => (
        <mesh key={i} geometry={BOX} material={mat('#8a5e3c')} scale={[w, TRAY.h, d]} position={[tx + x, TRAY.h / 2, tz + z]} castShadow receiveShadow />
      ))}
    </group>
  )
}

// ---------------------------------------------------------------- everything, as piles

function usePiles({ view, layout, hand, tray, can, on }: TableProps): Pile[] {
  const me = view.you
  const pl = me >= 0 ? view.players[me] : null
  const piles: Pile[] = []
  // your hand: one pile per kind; an empty kind leaves its place on the table
  RESOURCES.forEach((r, i) => {
    const n = hand?.[r] ?? 0
    piles.push({ id: n ? `hand:${r}` : `slot:hand:${r}`, at: layout.hand[i], n, face: resourceFace(r), back: resourceBack(), enabled: can.hand && n > 0, onClick: () => on.hand(r) })
  })
  // your development cards, by kind; ones you can play now stand a little proud
  const cards = pl?.cards ?? []
  CARDS.filter((c) => cards.some((x) => x.card === c)).forEach((c, i) => {
    piles.push({ id: `dev:${c}`, at: layout.dev(i), n: cards.filter((x) => x.card === c).length, face: devFace(c), back: devBack(), lift: can.dev[c] ? 3 : 0, enabled: !!can.dev[c], onClick: () => on.dev(c) })
  })
  // the bank: its five stacks (19 each to start) and its deck, face down
  RESOURCES.forEach((r, i) => {
    piles.push({ id: `bank:${r}`, at: layout.bank[i], n: view.bank[r], face: resourceFace(r), back: resourceBack(), cap: 19, loose: 0.8, enabled: can.bank && view.bank[r] > 0, onClick: () => on.bank(r) })
  })
  piles.push({ id: 'deck', at: layout.deck, n: view.pile, face: devBack(), back: devBack(), faceDown: true, cap: 25, loose: 0.8, enabled: can.deck, onClick: on.deck })
  // everyone else: their cards face down (fanned a little), their development cards, knights they've played
  for (const { p, at } of layout.seats) {
    const o = view.players[p]
    const parts = seatParts(at, layout.portrait)
    piles.push({ id: o.handCount ? `opp:${p}` : `slot:opp:${p}`, at: parts.hand, n: o.handCount, face: resourceBack(), back: resourceBack(), faceDown: true, loose: 3, enabled: can.opponents.includes(p), onClick: () => on.opponent(p) })
    piles.push({ id: `odev:${p}`, at: parts.dev, n: o.cardCount, face: devBack(), back: devBack(), faceDown: true, loose: 2.5 })
    piles.push({ id: `kn:${p}`, at: parts.knights, n: o.knights, face: devFace('knight'), back: devBack(), loose: 4 })
    if (view.longestRoad === p) piles.push({ id: `lr:${p}`, at: [parts.awards[0], parts.awards[1] - 6], n: 1, face: awardFace('road'), back: awardFace('road'), turn: 0.08 })
    if (view.largestArmy === p) piles.push({ id: `la:${p}`, at: [parts.awards[0] + 6, parts.awards[1] + 6], n: 1, face: awardFace('army'), back: awardFace('army'), turn: -0.08, lift: 1 })
  }
  if (pl && view.longestRoad === me) piles.push({ id: 'lr:me', at: [layout.awardsMine[0], layout.awardsMine[1] - 6], n: 1, face: awardFace('road'), back: awardFace('road'), turn: 0.08 })
  if (pl && view.largestArmy === me) piles.push({ id: 'la:me', at: [layout.awardsMine[0] + 6, layout.awardsMine[1] + 6], n: 1, face: awardFace('army'), back: awardFace('army'), turn: -0.08, lift: 1 })
  // the tray: what you give on the near half, what you get on the far half; behind it, one of each kind to ask for
  if (tray) {
    const [tx, tz] = layout.tray
    const row = (h: Partial<Hand>, z: number, side: 'give' | 'get') => {
      const kinds = RESOURCES.filter((r) => (h[r] ?? 0) > 0)
      kinds.forEach((r, i) =>
        piles.push({
          id: `tray:${side}:${r}`,
          at: [tx + (i - (kinds.length - 1) / 2) * (CARD.w * CARD.small + 6), z],
          n: h[r] ?? 0,
          face: resourceFace(r),
          back: resourceBack(),
          small: true,
          lift: 4,
          loose: 1.8,
          enabled: can.tray && !tray.locked,
          onClick: () => (side === 'give' ? on.trayGive(r) : on.trayGet(r)),
        }),
      )
    }
    row(tray.give, tz + (tray.mode === 'trade' ? TRAY.d / 4 : 0), 'give')
    if (tray.mode === 'trade') row(tray.get, tz - TRAY.d / 4, 'get')
    if (tray.mode === 'trade' && !tray.locked)
      RESOURCES.forEach((r, i) => piles.push({ id: `want:${r}`, at: layout.wants(i), n: 1, face: resourceFace(r), back: resourceBack(), small: true, loose: 0, enabled: can.wants, onClick: () => on.want(r) }))
  }
  return piles
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

function TableTop() {
  return <mesh geometry={BOX} material={mat('#5a3d29')} scale={[8000, 2, 8000]} position={[0, -1.2, 0]} receiveShadow />
}

export function TableView(props: TableProps) {
  const { layout, view, can, on, building, tray } = props
  const piles = usePiles(props)
  const reach = Math.max(-layout.bounds.minX, layout.bounds.maxX, -layout.bounds.minZ, layout.bounds.maxZ) + 40
  const me = view.you
  const pl = me >= 0 ? view.players[me] : null
  return (
    <Canvas {...canvasProps()}>
      <Lights extent={reach} />
      <Fit bounds={layout.bounds} tilt={layout.portrait ? CAMERA.tilt + 0.08 : CAMERA.tilt + 0.14} />
      <TableTop />
      <BoardContents {...props} />
      <Dice dice={props.dice ?? null} rolls={props.rolls ?? 0} onRoll={props.onRoll} at={layout.dice} />
      {tray && <Tray at={layout.tray} mode={tray.mode} />}
      <Cards piles={piles} />
      {pl &&
        (['road', 'settlement', 'city'] as const).map((w) => (
          <Supply key={w} what={w} at={layout.supply[w]} n={pl.pieces[w]} color={pl.color} enabled={can.supply[w] || can.supplyTap || building === w} ready={can.supply[w]} up={building === w} onClick={() => on.supply(w)} />
        ))}
      <Projector />
      <TestHook />
    </Canvas>
  )
}
