/**
 * The board, straight down, fitted to its box. Built to be cheap on any computer:
 *   - it draws only when something changes (a piece lands, the robber moves, you hover a spot), never on its own
 *   - the whole island is two draw calls (see island.ts); pieces are a few dozen more
 *   - shadows are worked out again only when a piece moves, not every frame
 *   - picking uses one flat plane and snaps to the nearest legal spot, so there are no tiny targets to hit
 */
import { Canvas, useThree, type ThreeEvent } from '@react-three/fiber'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { MeshLambertMaterial, NeutralToneMapping, Object3D, PCFShadowMap, PCFSoftShadowMap, type InstancedMesh, type OrthographicCamera } from 'three'
import { TOPO } from '../../../shared/board.ts'
import type { Building, GameEvent, Harbor, Tile } from '../../../shared/engine.ts'
import type { PlayerColor } from '../../../shared/rules.ts'
import { PAL, PLAYER } from '../lib/palette.ts'
import '../lib/toy.ts'
import { getAtlas } from './atlas.ts'
import { buildIsland } from './island.ts'
import { Dice } from './Dice.tsx'
import { City, Pulse, Road, Robber, Settlement, boardShown, useRedraw } from './Pieces.tsx'
import { CAMERA, SEA, TILE, VIEW, edgeAt, hexAt, vertexAt } from './spec.ts'
import { TestHook } from './TestHook.tsx'

export type PickKind = 'settlement' | 'city' | 'road' | 'robber'
export type Picking = { kind: PickKind; spots: number[] } | null

export type BoardProps = {
  tiles: Tile[]
  harbors: Harbor[]
  buildings: Record<number, Building>
  roads: Record<number, number>
  robber: number
  colors: PlayerColor[]
  picking?: Picking
  you?: number
  onPick?: (kind: PickKind, id: number) => void
  /** the last roll and how many there have been (the dice throw when this counts up) */
  dice?: [number, number] | null
  rolls?: number
  onRoll?: () => void
  /** what happened, so new builds can pulse */
  events?: GameEvent[]
}

const islandMat = new MeshLambertMaterial({ vertexColors: true })
const MARK = new MeshLambertMaterial({ color: PAL.cream })
const dummy = new Object3D()

export type Bounds = { minX: number; maxX: number; minZ: number; maxZ: number }
const BOARD_BOUNDS: Bounds = { minX: -VIEW.w / 2, maxX: VIEW.w / 2, minZ: -(SEA.inner + SEA.rim) * 0.9, maxZ: (SEA.inner + SEA.rim) * 0.9 }

/** the camera looks down, tipped toward you (spec CAMERA), zoomed so everything in `bounds` fits the box */
export function Fit({ bounds = BOARD_BOUNDS, tilt = CAMERA.tilt }: { bounds?: Bounds; tilt?: number }) {
  const { camera, size, invalidate } = useThree()
  const key = `${bounds.minX},${bounds.maxX},${bounds.minZ},${bounds.maxZ},${tilt}`
  useLayoutEffect(() => {
    const cam = camera as OrthographicCamera
    const d = 2000
    const cx = (bounds.minX + bounds.maxX) / 2
    const cz = (bounds.minZ + bounds.maxZ) / 2
    const w = bounds.maxX - bounds.minX
    const h = (bounds.maxZ - bounds.minZ) * Math.cos(tilt) + 40 * Math.sin(tilt)
    cam.zoom = Math.min(size.width / w, size.height / h)
    cam.position.set(cx, d * Math.cos(tilt), cz + d * Math.sin(tilt))
    cam.up.set(0, 1, 0)
    cam.lookAt(cx, 6, cz)
    cam.updateProjectionMatrix()
    invalidate()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera, size.width, size.height, invalidate, key])
  return null
}

function Island({ tiles, harbors }: { tiles: Tile[]; harbors: Harbor[] }) {
  const key = JSON.stringify([tiles, harbors])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const { colored, painted } = useMemo(() => buildIsland(tiles, harbors), [key])
  const paintedMat = useMemo(() => new MeshLambertMaterial({ map: getAtlas() }), [])
  useEffect(() => () => (colored.dispose(), painted.dispose()), [colored, painted])
  return (
    <>
      <mesh geometry={colored} material={islandMat} receiveShadow castShadow />
      <mesh geometry={painted} material={paintedMat} receiveShadow />
    </>
  )
}

const spotAt = (kind: PickKind, id: number): [number, number] => (kind === 'road' ? edgeAt(id) : kind === 'robber' ? hexAt(id) : vertexAt(id))
/** how close (mm) the pointer must be to a spot to pick it */
const REACH: Record<PickKind, number> = { settlement: 26, city: 26, road: 24, robber: 52 }

/** cream markers on every legal spot, all one draw call */
function Markers({ kind, spots }: { kind: PickKind; spots: number[] }) {
  const ref = useRef<InstancedMesh>(null)
  useLayoutEffect(() => {
    const m = ref.current
    if (!m) return
    spots.forEach((id, i) => {
      const [x, z] = spotAt(kind, id)
      dummy.position.set(x, TILE.h + 0.8, z)
      dummy.rotation.set(0, kind === 'road' ? -TOPO.edges[id].angle : 0, 0)
      dummy.scale.set(kind === 'road' ? 16 : 6.5, 1.6, kind === 'road' ? 4.5 : 6.5)
      dummy.updateMatrix()
      m.setMatrixAt(i, dummy.matrix)
    })
    m.instanceMatrix.needsUpdate = true
  }, [kind, spots])
  if (kind === 'robber' || kind === 'city' || spots.length === 0) return null
  return (
    <instancedMesh key={`${kind}${spots.length}`} ref={ref} args={[undefined, MARK, spots.length]}>
      {kind === 'road' ? <boxGeometry args={[1, 1, 1]} /> : <cylinderGeometry args={[1, 1, 1, 16]} />}
    </instancedMesh>
  )
}

function Picker({ picking, color, onPick }: { picking: NonNullable<Picking>; color: PlayerColor; onPick?: BoardProps['onPick'] }) {
  const [hover, setHover] = useState<number | null>(null)
  const { kind, spots } = picking
  useEffect(() => setHover(null), [kind, spots])
  const nearest = (e: ThreeEvent<PointerEvent | MouseEvent>) => {
    let best: number | null = null
    let bestD = REACH[kind]
    for (const id of spots) {
      const [x, z] = spotAt(kind, id)
      const d = Math.hypot(e.point.x - x, e.point.z - z)
      if (d < bestD) {
        best = id
        bestD = d
      }
    }
    return best
  }
  const [hx, hz] = hover !== null ? spotAt(kind, hover) : [0, 0]
  return (
    <>
      <Markers kind={kind} spots={spots} />
      <mesh
        position={[0, TILE.h + 1, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        onPointerMove={(e) => {
          const n = nearest(e)
          if (n !== hover) setHover(n)
          document.body.style.cursor = n !== null ? 'pointer' : ''
        }}
        onPointerLeave={() => (setHover(null), (document.body.style.cursor = ''))}
        onClick={(e) => {
          const n = nearest(e)
          if (n === null) return
          setHover(null)
          document.body.style.cursor = ''
          onPick?.(kind, n)
        }}
      >
        <circleGeometry args={[SEA.inner * 0.95, 48]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} colorWrite={false} />
      </mesh>
      {hover !== null && kind === 'settlement' && <Settlement ghost color={color} x={hx} z={hz} />}
      {hover !== null && kind === 'city' && <City ghost color={color} x={hx} z={hz} />}
      {hover !== null && kind === 'road' && <Road ghost color={color} x={hx} z={hz} angle={TOPO.edges[hover].angle} />}
      {hover !== null && kind === 'robber' && <Robber ghost x={hx} z={hz} />}
    </>
  )
}

/** shadows are recomputed when the pieces change, and otherwise left alone */
function ShadowsOnChange({ deps }: { deps: unknown[] }) {
  const redraw = useRedraw()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => redraw(), deps)
  return null
}

/** a pulse under each piece built since you arrived, so you see what just changed */
function Pulses({ events, colors }: { events: GameEvent[]; colors: PlayerColor[] }) {
  const seen = useRef<number>(events.length ? events[events.length - 1].n : -1)
  const [live, setLive] = useState<{ n: number; x: number; z: number; color: string; size: number }[]>([])
  useEffect(() => {
    const fresh = events.filter((e) => e.n > seen.current)
    if (!fresh.length) return
    seen.current = fresh[fresh.length - 1].n
    const add = fresh.flatMap((e) => {
      if (e.k === 'build') {
        const [x, z] = e.what === 'road' ? edgeAt(e.at) : vertexAt(e.at)
        return [{ n: e.n, x, z, color: PLAYER[colors[e.p]].ui, size: e.what === 'city' ? 22 : e.what === 'road' ? 20 : 16 }]
      }
      if (e.k === 'robber') {
        const [x, z] = hexAt(e.hex)
        return [{ n: e.n, x, z, color: PAL.plum, size: 26 }]
      }
      return []
    })
    if (add.length) setLive((l) => [...l, ...add])
  }, [events, colors])
  return (
    <>
      {live.map((p) => (
        <Pulse key={p.n} x={p.x} z={p.z} color={p.color} size={p.size} onDone={() => setLive((l) => l.filter((q) => q.n !== p.n))} />
      ))}
    </>
  )
}

/** the board and everything on it (not the dice: they sit wherever the table puts them) */
export function BoardContents({ tiles, harbors, buildings, roads, robber, colors, picking, you = -1, onPick, events = [], arrive = 0 }: BoardProps & { arrive?: number }) {
  const [rx, rz] = hexAt(robber)
  useState(boardShown)
  // yours wait for the piece flying over from your supply (on the table; `arrive` s)
  const wait = (owner: number) => (owner === you ? arrive : 0)
  return (
    <>
      <Island tiles={tiles} harbors={harbors} />
      {Object.entries(roads).map(([e, owner]) => {
        const [x, z] = edgeAt(Number(e))
        return <Road key={`r${e}`} color={colors[owner]} x={x} z={z} angle={TOPO.edges[Number(e)].angle} delay={wait(owner)} />
      })}
      {Object.entries(buildings).map(([v, b]) => {
        const [x, z] = vertexAt(Number(v))
        return b.kind === 'city' ? <City key={`c${v}`} color={colors[b.owner]} x={x} z={z} delay={wait(b.owner)} /> : <Settlement key={`s${v}`} color={colors[b.owner]} x={x} z={z} delay={wait(b.owner)} />
      })}
      <Robber x={rx} z={rz} />
      <Pulses events={events} colors={colors} />
      {picking && you >= 0 && <Picker picking={picking} color={colors[you]} onPick={onPick} />}
      <ShadowsOnChange deps={[JSON.stringify(buildings), JSON.stringify(roads), robber, tiles]} />
    </>
  )
}

/** one soft key light (its shadows only redrawn when asked) and a warm sky light */
export function Lights({ extent = 380 }: { extent?: number }) {
  return (
    <>
      <hemisphereLight args={['#e4e0f5', '#c9b49c', 1.8]} />
      <directionalLight
        castShadow
        position={[-260, 900, 380]}
        intensity={1.35}
        color="#fff4e8"
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0005}
        shadow-normalBias={0.8}
        shadow-camera-left={-extent}
        shadow-camera-right={extent}
        shadow-camera-top={extent}
        shadow-camera-bottom={-extent}
        shadow-camera-near={200}
        shadow-camera-far={2000}
      />
    </>
  )
}

export function canvasProps() {
  return {
    orthographic: true,
    frameloop: 'demand' as const,
    dpr: [1, 2] as [number, number],
    shadows: { type: PCFSoftShadowMap },
    camera: { near: 100, far: 4000, position: [0, 1500, 0] as [number, number, number], zoom: 1 },
    gl: { antialias: true, alpha: true, toneMapping: NeutralToneMapping, powerPreference: 'low-power' as const },
    onCreated: ({ gl }: { gl: { shadowMap: { autoUpdate: boolean; needsUpdate: boolean } } }) => {
      gl.shadowMap.autoUpdate = false
      gl.shadowMap.needsUpdate = true
    },
  }
}

/** the board alone (for the ?part= pages) */
export function BoardView(props: BoardProps) {
  const { dice = null, rolls = 0, onRoll } = props
  return (
    <Canvas
      orthographic
      frameloop="demand"
      dpr={[1, 2]}
      shadows={{ type: PCFShadowMap }}
      camera={{ near: 100, far: 3000, position: [0, 1500, 0], zoom: 1 }}
      gl={{ antialias: true, alpha: true, toneMapping: NeutralToneMapping, powerPreference: 'low-power' }}
      onCreated={({ gl }) => {
        gl.shadowMap.autoUpdate = false
        gl.shadowMap.needsUpdate = true
      }}
    >
      <hemisphereLight args={['#e4e0f5', '#c9b49c', 1.8]} />
      <directionalLight
        castShadow
        position={[-260, 900, 380]}
        intensity={1.35}
        color="#fff4e8"
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0005}
        shadow-normalBias={0.8}
        shadow-camera-left={-380}
        shadow-camera-right={380}
        shadow-camera-top={380}
        shadow-camera-bottom={-380}
        shadow-camera-near={200}
        shadow-camera-far={1600}
      />
      <Fit />
      <BoardContents {...props} />
      <Dice dice={dice} rolls={rolls} onRoll={onRoll} />
      <TestHook />
    </Canvas>
  )
}
