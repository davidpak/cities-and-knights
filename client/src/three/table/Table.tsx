/**
 * The table round the board, as things you can pick up: your cards in stacks, your development cards, your pieces
 * waiting to be built, the bank's stacks and its deck of development cards, everyone else's cards face down, and a
 * wooden trade tray. Clicking a thing is the move: click a card to put it on the tray, a bank stack to ask the bank for
 * it, the deck to buy a card, a piece to build it, someone's cards to trade with them (or to steal, after the robber).
 *
 * Cheap: every stack is one box (its height is the count), the scene only redraws when something changes.
 */
import { Canvas, useThree, type ThreeEvent } from '@react-three/fiber'
import { useEffect, useState, type ReactNode } from 'react'
import { BoxGeometry, MeshLambertMaterial, Vector3, type Material, type Texture } from 'three'
import type { View } from '../../../../shared/engine.ts'
import { CARDS, RESOURCES, type Card, type Hand, type Resource } from '../../../../shared/rules.ts'
import { PLAYER } from '../../lib/palette.ts'
import { mat } from '../../lib/toy.ts'
import { BoardContents, Fit, Lights, canvasProps, type BoardProps } from '../Board.tsx'
import { Dice } from '../Dice.tsx'
import { cityGeo, roadGeo, settlementGeo } from '../geometry.ts'
import { setProjector } from '../labels.ts'
import { Outline } from '../Pieces.tsx'
import { CAMERA } from '../spec.ts'
import { TestHook } from '../TestHook.tsx'
import { awardFace, devBack, devFace, resourceBack, resourceFace, trayFace } from './faces.ts'
import { CARD, TRAY, seatParts, type Layout, type Spot } from './layout.ts'

const BOX = new BoxGeometry(1, 1, 1)
const EDGE = new MeshLambertMaterial({ color: '#efe2c4' })
const faceMats = new Map<Texture, Material>()
const faceMat = (t: Texture) => {
  let m = faceMats.get(t)
  if (!m) faceMats.set(t, (m = new MeshLambertMaterial({ map: t })))
  return m
}

export type TrayContents = { mode: 'trade' | 'discard'; give: Partial<Hand>; get: Partial<Hand>; locked?: boolean }

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
    supply: Record<'road' | 'settlement' | 'city', boolean>
    /** pieces can be tapped (to build, or to hear what they cost) */
    supplyTap: boolean
    dev: Partial<Record<Card, boolean>>
    opponents: number[]
  }
  /** which build is picked up (its pieces lift) */
  building: 'road' | 'settlement' | 'city' | null
  on: {
    hand: (r: Resource) => void
    trayGive: (r: Resource) => void
    trayGet: (r: Resource) => void
    want: (r: Resource) => void
    bank: (r: Resource) => void
    deck: () => void
    dev: (c: Card) => void
    supply: (w: 'road' | 'settlement' | 'city') => void
    opponent: (p: number) => void
  }
}

// ---------------------------------------------------------------- things you can click

/** a thing that lifts a little under the pointer, and says it can be clicked */
function Clickable({ children, onClick, enabled, at, lift = 0 }: { children: ReactNode; onClick?: () => void; enabled: boolean; at: Spot; lift?: number }) {
  const [hover, setHover] = useState(false)
  useEffect(() => {
    if (!enabled) setHover(false)
  }, [enabled])
  return (
    <group
      position={[at[0], lift + (hover && enabled ? 4 : 0), at[1]]}
      onPointerOver={(e: ThreeEvent<PointerEvent>) => {
        if (!enabled) return
        e.stopPropagation()
        setHover(true)
        document.body.style.cursor = 'pointer'
      }}
      onPointerOut={() => {
        setHover(false)
        document.body.style.cursor = ''
      }}
      onClick={(e: ThreeEvent<MouseEvent>) => {
        if (!enabled || !onClick) return
        e.stopPropagation()
        onClick()
      }}
    >
      {children}
    </group>
  )
}

/** a stack of cards lying flat: one box, as tall as the count (a single card at least, when there are any) */
function Stack({ n, face, back, small, faceDown, empty = 'hide' }: { n: number; face: Texture; back: Texture; small?: boolean; faceDown?: boolean; empty?: 'hide' | 'slot' }) {
  const k = small ? CARD.small : 1
  if (n <= 0) {
    if (empty === 'hide') return null
    // an empty place where the stack goes
    return (
      <mesh geometry={BOX} material={mat('#3b2a1d')} scale={[CARD.w * k, 0.3, CARD.d * k]} position={[0, 0.15, 0]} receiveShadow />
    )
  }
  const h = Math.min(n, 12) * CARD.t
  const top = faceMat(faceDown ? back : face)
  const bottom = faceMat(back)
  return <mesh geometry={BOX} material={[EDGE, EDGE, top, bottom, EDGE, EDGE]} scale={[CARD.w * k, h, CARD.d * k]} position={[0, h / 2, 0]} castShadow receiveShadow />
}

// ---------------------------------------------------------------- your area

function MyArea({ view, layout, hand, can, on, building }: TableProps) {
  const me = view.you
  const pl = view.players[me]
  const color = pl.color
  const cards = pl.cards ?? []
  return (
    <group>
      {RESOURCES.map((r, i) => (
        <Clickable key={r} at={layout.hand[i]} enabled={can.hand && (hand?.[r] ?? 0) > 0} onClick={() => on.hand(r)}>
          <Stack n={hand?.[r] ?? 0} face={resourceFace(r)} back={resourceBack()} empty="slot" />
        </Clickable>
      ))}
      {CARDS.filter((c) => cards.some((x) => x.card === c)).map((c, i) => (
        <Clickable key={c} at={layout.dev(i)} enabled={!!can.dev[c]} onClick={() => on.dev(c)} lift={can.dev[c] ? 2 : 0}>
          <Stack n={cards.filter((x) => x.card === c).length} face={devFace(c)} back={devBack()} />
        </Clickable>
      ))}
      {(['road', 'settlement', 'city'] as const).map((w) => (
        <Supply key={w} what={w} at={layout.supply[w]} n={pl.pieces[w]} color={color} can={can.supply[w]} tap={can.supplyTap} up={building === w} onClick={() => on.supply(w)} />
      ))}
      <Awards view={view} p={me} at={layout.awardsMine} />
    </group>
  )
}

/** your pieces not yet built, standing in a little group (picked up when you choose to build one) */
function Supply({ what, at, n, color, can, tap, up, onClick }: { what: 'road' | 'settlement' | 'city'; at: Spot; n: number; color: TableProps['colors'][number]; can: boolean; tap: boolean; up: boolean; onClick: () => void }) {
  const geo = what === 'road' ? roadGeo() : what === 'city' ? cityGeo() : settlementGeo()
  const body = [mat(PLAYER[color].body), mat(PLAYER[color].roof)]
  const shown = Math.min(n, what === 'road' ? 5 : what === 'city' ? 4 : 5)
  const spots: [number, number, number][] = Array.from({ length: shown }, (_, i) => {
    if (what === 'road') return [0, i * 6.2, 0] // a neat pile
    const cols = what === 'city' ? 2 : 3
    const sx = what === 'city' ? 22 : 15
    return [((i % cols) - (cols - 1) / 2) * sx, 0, (Math.floor(i / cols) - 0.5) * 16]
  })
  return (
    <Clickable at={at} enabled={can || up || tap} onClick={onClick} lift={up ? 10 : 0}>
      {/* a coaster under the pieces you can afford, so you can see what's buildable at a glance */}
      {(can || up) && <mesh geometry={BOX} material={mat(up ? '#e3a72c' : '#f6ecd5')} scale={[what === 'road' ? 40 : 52, 0.6, what === 'road' ? 18 : 40]} position={[0, 0.3, 0]} receiveShadow />}
      {spots.map((p, i) => (
        <group key={i} position={[p[0], p[1] + 0.6, p[2]]} rotation={[0, what === 'road' ? 0.4 : 0, 0]}>
          <mesh geometry={geo} material={body} castShadow />
          <Outline geometry={geo} />
        </group>
      ))}
    </Clickable>
  )
}

function Awards({ view, p, at }: { view: View; p: number; at: Spot }) {
  const both = view.longestRoad === p && view.largestArmy === p
  return (
    <>
      {view.longestRoad === p && (
        <group position={[at[0] - (both ? 12 : 0), 0, at[1]]} rotation={[0, 0.08, 0]}>
          <Stack n={1} face={awardFace('road')} back={awardFace('road')} />
        </group>
      )}
      {view.largestArmy === p && (
        <group position={[at[0] + (both ? 12 : 0), both ? 1 : 0, at[1]]} rotation={[0, -0.08, 0]}>
          <Stack n={1} face={awardFace('army')} back={awardFace('army')} />
        </group>
      )}
    </>
  )
}

// ---------------------------------------------------------------- everyone else

function Seats({ view, layout, can, on }: TableProps) {
  return (
    <>
      {layout.seats.map(({ p, at }) => {
        const pl = view.players[p]
        const parts = seatParts(at)
        return (
          <group key={p}>
            <Clickable at={parts.hand} enabled={can.opponents.includes(p)} onClick={() => on.opponent(p)}>
              <Stack n={pl.handCount} face={resourceBack()} back={resourceBack()} faceDown empty="slot" />
            </Clickable>
            <group position={[parts.dev[0], 0, parts.dev[1]]}>
              <Stack n={pl.cardCount} face={devBack()} back={devBack()} faceDown empty="slot" />
            </group>
            {pl.knights > 0 && (
              <group position={[parts.knights[0], 0, parts.knights[1]]}>
                <Stack n={pl.knights} face={devFace('knight')} back={devBack()} />
              </group>
            )}
            <Awards view={view} p={p} at={parts.awards} />
          </group>
        )
      })}
    </>
  )
}

// ---------------------------------------------------------------- the bank

function Bank({ view, layout, can, on }: TableProps) {
  return (
    <>
      {RESOURCES.map((r, i) => (
        <Clickable key={r} at={layout.bank[i]} enabled={can.bank && view.bank[r] > 0} onClick={() => on.bank(r)}>
          <Stack n={view.bank[r]} face={resourceFace(r)} back={resourceBack()} empty="slot" />
        </Clickable>
      ))}
      <Clickable at={layout.deck} enabled={can.deck} onClick={on.deck}>
        <Stack n={view.pile} face={devBack()} back={devBack()} faceDown empty="slot" />
      </Clickable>
    </>
  )
}

// ---------------------------------------------------------------- the trade tray

function Tray({ layout, tray, can, on }: TableProps) {
  const [tx, tz] = layout.tray
  if (!tray) return null
  const k = CARD.small
  const row = (h: Partial<Hand>, z: number, click: (r: Resource) => void, enabled: boolean) => {
    const kinds = RESOURCES.filter((r) => (h[r] ?? 0) > 0)
    return kinds.map((r, i) => (
      <Clickable key={r} at={[tx + (i - (kinds.length - 1) / 2) * (CARD.w * k + 6), z]} enabled={enabled} onClick={() => click(r)} lift={TRAY.h - 3}>
        <Stack n={h[r] ?? 0} face={resourceFace(r)} back={resourceBack()} small />
      </Clickable>
    ))
  }
  return (
    <group>
      {/* the tray: a floor with its two halves marked, and a rim */}
      <mesh geometry={BOX} material={[mat('#a87b50'), mat('#a87b50'), faceMat(trayFace(tray.mode)), mat('#8a5e3c'), mat('#a87b50'), mat('#a87b50')]} scale={[TRAY.w, 4, TRAY.d]} position={[tx, 2, tz]} receiveShadow castShadow />
      {[
        [0, -TRAY.d / 2, TRAY.w, TRAY.rim],
        [0, TRAY.d / 2, TRAY.w, TRAY.rim],
        [-TRAY.w / 2, 0, TRAY.rim, TRAY.d],
        [TRAY.w / 2, 0, TRAY.rim, TRAY.d],
      ].map(([x, z, w, d], i) => (
        <mesh key={i} geometry={BOX} material={mat('#8a5e3c')} scale={[w, TRAY.h, d]} position={[tx + x, TRAY.h / 2, tz + z]} castShadow receiveShadow />
      ))}
      {row(tray.give, tz + (tray.mode === 'trade' ? TRAY.d / 4 : 0), on.trayGive, can.tray && !tray.locked)}
      {tray.mode === 'trade' && row(tray.get, tz - TRAY.d / 4, on.trayGet, can.tray && !tray.locked)}
      {/* behind the tray: one of each card, to ask for */}
      {tray.mode === 'trade' &&
        !tray.locked &&
        RESOURCES.map((r, i) => (
          <Clickable key={r} at={layout.wants(i)} enabled={can.wants} onClick={() => on.want(r)}>
            <Stack n={1} face={resourceFace(r)} back={resourceBack()} small />
          </Clickable>
        ))}
    </group>
  )
}

// ---------------------------------------------------------------- the scene

/** tells the HTML labels where things are on screen (when the window changes size) */
function Projector() {
  const { camera, size, gl } = useThree()
  useEffect(() => {
    const v = new Vector3()
    // wait a frame so the camera fit has run
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
  const { layout } = props
  const reach = Math.max(-layout.bounds.minX, layout.bounds.maxX, -layout.bounds.minZ, layout.bounds.maxZ) + 40
  return (
    <Canvas {...canvasProps()}>
      <Lights extent={reach} />
      <Fit bounds={layout.bounds} tilt={layout.portrait ? CAMERA.tilt + 0.08 : CAMERA.tilt + 0.14} />
      <TableTop />
      <BoardContents {...props} />
      <Dice dice={props.dice ?? null} rolls={props.rolls ?? 0} onRoll={props.onRoll} at={layout.dice} />
      <MyArea {...props} />
      <Seats {...props} />
      <Bank {...props} />
      <Tray {...props} />
      <Projector />
      <TestHook />
    </Canvas>
  )
}
