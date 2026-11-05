/**
 * The expansion's boards on the table, all fixed things (not bodies):
 *   the barbarians' lane   seven steps of sea and the shore; their ship sails a step at each ship on the event die
 *   your tracks            trade, politics, science: five steps each, the steps you've reached in the track's colour;
 *                          click a track to take its next step when you can pay for it (that step stands raised)
 *   everyone's tracks      the same, small, beside each other player's cards
 * Each is one or two instanced draws.
 */
import { useFrame, type ThreeEvent } from '@react-three/fiber'
import { useLayoutEffect, useMemo, useRef } from 'react'
import { Color, Matrix4, Object3D, type InstancedMesh, type Mesh } from 'three'
import type { View } from '../../../../shared/engine.ts'
import { BARBARIAN_STEPS, TRACKS, type Track } from '../../../../shared/rules.ts'
import { TRACK_COLOR } from '../../lib/palette.ts'
import { mat } from '../../lib/toy.ts'
import { hullGeo, sailGeo } from '../geometry.ts'
import { useRedraw } from '../Pieces.tsx'
import { wood } from '../wood.ts'
import { SEAT_TRACKS, SEA_LANE, TRACKS_BOX, seatParts, type Layout } from './layout.ts'
import { BoxGeometry } from 'three'

const BOX = new BoxGeometry(1, 1, 1)
const dummy = new Object3D()
const EMPTY = new Color('#3b2a1d')
const NEXT = new Color('#f1e3c6')
const SEA = new Color('#5f93ad')
const SHORE = new Color('#d8bf8a')

export function ExpansionTable({ view, layout, can, onImprove }: { view: View; layout: Layout; can: Record<Track, boolean>; onImprove: (t: Track) => void }) {
  const x = view.x
  const K = layout.k
  if (!x || !K) return null
  return (
    <>
      <Lane at={K.lane} step={x.barbarian} />
      <MyTracks at={K.tracks} levels={view.you >= 0 ? x.levels[view.you] : null} can={can} onImprove={onImprove} />
      <SeatTracks view={view} layout={layout} />
    </>
  )
}

/** the lane and the barbarians' ship, which slides a step at a time */
function Lane({ at, step }: { at: [number, number]; step: number }) {
  const tiles = useRef<InstancedMesh>(null)
  const ship = useRef<Mesh>(null)
  const sail = useRef<Mesh>(null)
  const redraw = useRedraw()
  const xOf = (i: number) => at[0] + (i - (SEA_LANE.steps - 1) / 2) * SEA_LANE.step
  useLayoutEffect(() => {
    const m = tiles.current
    if (!m) return
    for (let i = 0; i < SEA_LANE.steps; i++) {
      dummy.position.set(xOf(i), 1.5, at[1])
      dummy.scale.set(SEA_LANE.step - 3, 3, SEA_LANE.d - 4)
      dummy.updateMatrix()
      m.setMatrixAt(i, dummy.matrix)
      m.setColorAt(i, i === BARBARIAN_STEPS ? SHORE : SEA)
    }
    m.instanceMatrix.needsUpdate = true
    if (m.instanceColor) m.instanceColor.needsUpdate = true
    redraw()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [at[0], at[1]])
  const shown = useRef(step)
  useFrame((_, dt) => {
    const want = Math.min(step, BARBARIAN_STEPS)
    const was = shown.current
    if (Math.abs(want - was) > 0.001) {
      // sailing on, or (after landing) back out to the start
      shown.current = want < was ? Math.max(want, was - dt * 6) : Math.min(want, was + dt * 2.2)
      redraw()
    }
    const px = xOf(shown.current)
    ship.current?.position.set(px, 3, at[1])
    sail.current?.position.set(px, 3, at[1])
  })
  return (
    <>
      <instancedMesh ref={tiles} args={[BOX, wood(), SEA_LANE.steps]} receiveShadow />
      <mesh ref={ship} geometry={hullGeo()} material={mat('#3a2c24')} scale={1.25} castShadow />
      <mesh ref={sail} geometry={sailGeo()} material={mat('#d9cdb4')} scale={1.25} castShadow />
    </>
  )
}

/** your three tracks: click one to take its next step */
function MyTracks({ at, levels, can, onImprove }: { at: [number, number]; levels: Record<Track, number> | null; can: Record<Track, boolean>; onImprove: (t: Track) => void }) {
  const ref = useRef<InstancedMesh>(null)
  const redraw = useRedraw()
  const key = JSON.stringify([levels, can, at])
  useLayoutEffect(() => {
    const m = ref.current
    if (!m || !levels) return
    TRACKS.forEach((t, r) => {
      for (let i = 0; i < 5; i++) {
        const k = r * 5 + i
        const next = i === levels[t] && can[t]
        const h = i < levels[t] ? 6 : next ? 8 : 3
        dummy.position.set(at[0] + (i - 2) * TRACKS_BOX.step, h / 2, at[1] + (r - 1) * TRACKS_BOX.row)
        dummy.scale.set(TRACKS_BOX.step - 5, h, TRACKS_BOX.row - 6)
        dummy.updateMatrix()
        m.setMatrixAt(k, dummy.matrix)
        m.setColorAt(k, i < levels[t] ? new Color(TRACK_COLOR[t]) : next ? NEXT : EMPTY)
      }
    })
    m.instanceMatrix.needsUpdate = true
    if (m.instanceColor) m.instanceColor.needsUpdate = true
    m.computeBoundingSphere()
    redraw()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  if (!levels) return null
  const trackOf = (e: ThreeEvent<PointerEvent | MouseEvent>) => (e.instanceId !== undefined ? TRACKS[Math.floor(e.instanceId / 5)] : null)
  return (
    <instancedMesh
      ref={ref}
      args={[BOX, wood(), 15]}
      castShadow
      receiveShadow
      onPointerMove={(e) => {
        const t = trackOf(e)
        if (!t || !can[t]) return
        e.stopPropagation()
        document.body.style.cursor = 'pointer'
      }}
      onPointerOut={() => (document.body.style.cursor = '')}
      onClick={(e) => {
        const t = trackOf(e)
        if (!t) return
        e.stopPropagation()
        onImprove(t)
      }}
    />
  )
}

/** everyone else's tracks, small, beside their cards */
function SeatTracks({ view, layout }: { view: View; layout: Layout }) {
  const ref = useRef<InstancedMesh>(null)
  const redraw = useRedraw()
  const count = layout.seats.length * 15
  const key = JSON.stringify([view.x?.levels, layout.seats])
  const m4 = useMemo(() => new Matrix4(), [])
  useLayoutEffect(() => {
    const m = ref.current
    const x = view.x
    if (!m || !x) return
    let k = 0
    for (const { p, at } of layout.seats) {
      const [sx, sz] = seatParts(at, layout.portrait).knights
      TRACKS.forEach((t, r) => {
        for (let i = 0; i < 5; i++) {
          const on = i < x.levels[p][t]
          dummy.position.set(sx + (i - 2) * SEAT_TRACKS.step, on ? 2.5 : 1, sz + (r - 1) * SEAT_TRACKS.row)
          dummy.scale.set(SEAT_TRACKS.step - 2, on ? 5 : 2, SEAT_TRACKS.row - 3)
          dummy.updateMatrix()
          m.setMatrixAt(k, m4.copy(dummy.matrix))
          m.setColorAt(k, on ? new Color(TRACK_COLOR[t]) : EMPTY)
          k++
        }
      })
    }
    m.count = k
    m.instanceMatrix.needsUpdate = true
    if (m.instanceColor) m.instanceColor.needsUpdate = true
    m.computeBoundingSphere()
    redraw()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return <instancedMesh key={count} ref={ref} args={[BOX, wood(), Math.max(1, count)]} receiveShadow castShadow />
}
