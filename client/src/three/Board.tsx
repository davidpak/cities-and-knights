/**
 * The board, straight down, fitted to its box. Built to be cheap on any computer:
 *   - it draws only when something changes (a piece lands, the robber moves, you hover a spot), never on its own
 *   - the whole island is two draw calls (see island.ts); pieces are a few dozen more
 *   - shadows are worked out again only when a piece moves, not every frame
 *   - picking uses one flat plane and snaps to the nearest legal spot, so there are no tiny targets to hit
 */
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { AdditiveBlending, CircleGeometry, MeshBasicMaterial, MeshLambertMaterial, NeutralToneMapping, Object3D, PCFShadowMap, RingGeometry, type InstancedMesh, type OrthographicCamera } from 'three'
import { TOPO } from '../../../shared/board.ts'
import type { Building, GameEvent, Harbor, Tile } from '../../../shared/engine.ts'
import type { PlayerColor } from '../../../shared/rules.ts'
import { PAL, PLAYER } from '../lib/palette.ts'
import '../lib/toy.ts'
import { getAtlas } from './atlas.ts'
import { buildIsland } from './island.ts'
import { Dice } from './Dice.tsx'
import { BoardPieces, City, Pulse, Road, Robber, Settlement, boardShown, useRedraw, type BoardExtras } from './Pieces.tsx'
import { CAMERA, SEA, TILE, VIEW, edgeAt, hexAt, vertexAt } from './spec.ts'
import { TestHook } from './TestHook.tsx'
import { QUALITY } from './quality.ts'

/** what's being picked on the board: a spot to build (shown with the piece), the robber's tile, or (the expansion) a
 *  corner, a side or a tile for some other purpose (shown with a ring); 'quiet': your knights, ready to be clicked */
export type PickKind = 'settlement' | 'city' | 'road' | 'robber' | 'vertex' | 'edge' | 'hex' | 'quiet'
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
  /** the expansion's pieces on the board */
  extras?: BoardExtras | null
  /** (a finger has shown a piece somewhere: the next tap on it places it) */
  onArm?: (armed: boolean) => void
}

const islandMat = new MeshLambertMaterial({ vertexColors: true })
const MARK = new MeshLambertMaterial({ color: PAL.cream })
/** tiles to pick are ringed in gold (a cream ring would vanish against the cream tokens) */
const GOLD = new MeshLambertMaterial({ color: '#e3a72c' })
const dummy = new Object3D()
const RING_MARK = new RingGeometry(0.88, 1, 40).rotateX(-Math.PI / 2)

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

/** (for 'vertex', an id below zero is a tile's centre: -1 - tile) */
const spotAt = (kind: PickKind, id: number): [number, number] =>
  kind === 'road' || kind === 'edge' ? edgeAt(id) : kind === 'robber' || kind === 'hex' ? hexAt(id) : id < 0 ? hexAt(-1 - id) : vertexAt(id)
/**
 * How far a point is from a spot. A road counts along its length (all but its last fifth at each end, where it
 * meets the next road), not just at its middle: a click anywhere on it picks it.
 */
function distTo(kind: PickKind, id: number, px: number, pz: number) {
  if (kind === 'road' || kind === 'edge') {
    const e = TOPO.edges[id]
    const [ax, az] = vertexAt(e.a)
    const [bx, bz] = vertexAt(e.b)
    const dx = bx - ax
    const dz = bz - az
    const t = Math.min(0.8, Math.max(0.2, ((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz)))
    return Math.hypot(px - (ax + t * dx), pz - (az + t * dz))
  }
  const [x, z] = spotAt(kind, id)
  return Math.hypot(px - x, pz - z)
}
/** how close (mm) the pointer must be to a spot to pick it */
const REACH: Record<PickKind, number> = { settlement: 26, city: 26, road: 24, robber: 52, vertex: 24, edge: 22, hex: 52, quiet: 20 }

/** cream markers on every legal spot, all one draw call */
function Markers({ kind, spots }: { kind: PickKind; spots: number[] }) {
  const ref = useRef<InstancedMesh>(null)
  useLayoutEffect(() => {
    const m = ref.current
    if (!m) return
    spots.forEach((id, i) => {
      const [x, z] = spotAt(kind, id)
      const edge = kind === 'road' || kind === 'edge'
      const tile = kind === 'hex' || (kind === 'vertex' && id < 0)
      dummy.position.set(x, TILE.h + (tile ? 5.2 : 0.8), z)
      dummy.rotation.set(0, edge ? -TOPO.edges[id].angle : 0, 0)
      dummy.scale.set(edge ? 16 : tile ? 24 : 6.5, tile ? 0.8 : 1.6, edge ? 4.5 : tile ? 24 : 6.5)
      dummy.updateMatrix()
      m.setMatrixAt(i, dummy.matrix)
    })
    m.instanceMatrix.needsUpdate = true
  }, [kind, spots])
  if (kind === 'robber' || kind === 'city' || kind === 'quiet' || spots.length === 0) return null
  // a tile to pick gets a ring round its number
  if (kind === 'hex')
    return (
      <instancedMesh key={`${kind}${spots.length}`} ref={ref} args={[RING_MARK, GOLD, spots.length]} />
    )
  return (
    <instancedMesh key={`${kind}${spots.length}`} ref={ref} args={[undefined, MARK, spots.length]}>
      {kind === 'road' || kind === 'edge' ? <boxGeometry args={[1, 1, 1]} /> : <cylinderGeometry args={[1, 1, 1, 16]} />}
    </instancedMesh>
  )
}

/**
 * Picking a spot: the nearest legal one to the pointer, within reach (at least a fingertip's width on screen).
 * With a mouse, hovering shows the piece and a click places it; with a finger there's no hover, so the first tap
 * shows it there and a second tap on it places it (a tap elsewhere moves it).
 */
function Picker({ picking, color, onPick, onArm }: { picking: NonNullable<Picking>; color: PlayerColor; onPick?: BoardProps['onPick']; onArm?: BoardProps['onArm'] }) {
  const [hover, setHover] = useState<number | null>(null)
  const { kind, spots } = picking
  const { camera } = useThree()
  const touch = useRef(false)
  useEffect(() => setHover(null), [kind, spots])
  useEffect(() => onArm?.(touch.current && hover !== null), [hover, onArm])
  useEffect(() => () => onArm?.(false), [onArm])
  const nearest = (e: ThreeEvent<PointerEvent | MouseEvent>) => {
    let best: number | null = null
    // (an orthographic camera's zoom is pixels per millimetre)
    let bestD = Math.max(REACH[kind], (touch.current ? 26 : 12) / Math.max(0.05, camera.zoom))
    for (const id of spots) {
      const d = distTo(kind, id, e.point.x, e.point.z)
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
        onPointerDown={(e) => {
          touch.current = e.nativeEvent.pointerType === 'touch'
        }}
        onPointerMove={(e) => {
          if (e.nativeEvent.pointerType === 'touch') return
          touch.current = false
          const n = nearest(e)
          if (n !== hover) setHover(n)
          document.body.style.cursor = n !== null ? 'pointer' : ''
        }}
        onPointerLeave={(e) => {
          if (e.nativeEvent.pointerType === 'touch') return
          setHover(null)
          document.body.style.cursor = ''
        }}
        onClick={(e) => {
          const n = nearest(e)
          if (touch.current && n !== hover) {
            // a finger: show it here first
            setHover(n)
            return
          }
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
      {hover !== null && (kind === 'vertex' || kind === 'edge' || kind === 'hex' || kind === 'quiet') && (
        <mesh geometry={RING_MARK} material={kind === 'hex' || hover < 0 ? GOLD : MARK} position={[hx, TILE.h + (kind === 'hex' || hover < 0 ? 5.6 : 1.2), hz]} scale={kind === 'hex' || hover < 0 ? 27 : 11} renderOrder={2} />
      )}
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

/** after a roll, once the dice have landed: the tiles with that number light up for a moment (a tile the robber
 *  sits on, ringed red instead: it gives nothing) */
export const GLOW_AT = 0.5
const GLOW_FOR = 1.9
const GLOW_FILL = new CircleGeometry(1, 6, Math.PI / 2).rotateX(-Math.PI / 2)
const GLOW_RING = new RingGeometry(0.84, 1, 6, 1, Math.PI / 2).rotateX(-Math.PI / 2)
function RollGlow({ events, tiles, robber }: { events: GameEvent[]; tiles: Tile[]; robber: number }) {
  const last = [...events].reverse().find((e) => e.k === 'roll')
  const seen = useRef(last?.n ?? -1)
  const [lit, setLit] = useState<{ n: number; t0: number; good: number[]; blocked: number[] } | null>(null)
  const mats = useMemo(
    () => ({
      fill: new MeshBasicMaterial({ color: '#fff2c2', transparent: true, opacity: 0, depthWrite: false, blending: AdditiveBlending }),
      ring: new MeshBasicMaterial({ color: '#ffcf40', transparent: true, opacity: 0, depthWrite: false }),
      shade: new MeshBasicMaterial({ color: '#2a1410', transparent: true, opacity: 0, depthWrite: false }),
      red: new MeshBasicMaterial({ color: '#d8473b', transparent: true, opacity: 0, depthWrite: false }),
    }),
    [],
  )
  const redraw = useRedraw()
  useEffect(() => {
    if (!last || last.k !== 'roll' || last.n <= seen.current) return
    seen.current = last.n
    const total = last.dice[0] + last.dice[1]
    const all = tiles.flatMap((t, i) => (t.number === total ? [i] : []))
    setLit({ n: last.n, t0: performance.now() / 1000 + GLOW_AT, good: all.filter((i) => i !== robber), blocked: all.filter((i) => i === robber) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [last?.n])
  useFrame(() => {
    if (!lit) return
    const t = performance.now() / 1000 - lit.t0
    if (t > GLOW_FOR) {
      setLit(null)
      redraw()
      return
    }
    const k = t < 0 ? 0 : t < 0.15 ? t / 0.15 : t > GLOW_FOR - 0.5 ? (GLOW_FOR - t) / 0.5 : 1
    const beat = 0.85 + 0.15 * Math.cos(Math.max(0, t) * 7)
    mats.fill.opacity = 0.42 * k * beat
    mats.ring.opacity = k
    mats.shade.opacity = 0.35 * k
    mats.red.opacity = k
    redraw()
  })
  if (!lit) return null
  return (
    <>
      {lit.good.map((i) => {
        const [x, z] = hexAt(i)
        return (
          <group key={i} position={[x, TILE.h + 0.4, z]}>
            <mesh geometry={GLOW_FILL} material={mats.fill} scale={TILE.r - 3} renderOrder={2} />
            <mesh geometry={GLOW_RING} material={mats.ring} scale={TILE.r - 1} renderOrder={2} />
          </group>
        )
      })}
      {lit.blocked.map((i) => {
        const [x, z] = hexAt(i)
        return (
          <group key={i} position={[x, TILE.h + 0.4, z]}>
            <mesh geometry={GLOW_FILL} material={mats.shade} scale={TILE.r - 3} renderOrder={2} />
            <mesh geometry={GLOW_RING} material={mats.red} scale={TILE.r - 1} renderOrder={2} />
          </group>
        )
      })}
    </>
  )
}

/** the board and everything on it (not the dice: they sit wherever the table puts them) */
export function BoardContents({ tiles, harbors, buildings, roads, robber, colors, picking, you = -1, onPick, onArm, events = [], arrive = 0, extras = null }: BoardProps & { arrive?: number }) {
  const [rx, rz] = hexAt(robber)
  useState(boardShown)
  return (
    <>
      <Island tiles={tiles} harbors={harbors} />
      <BoardPieces buildings={buildings} roads={roads} colors={colors} you={you} arrive={arrive} extras={extras} />
      <Robber x={rx} z={rz} />
      <Pulses events={events} colors={colors} />
      <RollGlow events={events} tiles={tiles} robber={robber} />
      {picking && you >= 0 && <Picker picking={picking} color={colors[you]} onPick={onPick} onArm={onArm} />}
      <ShadowsOnChange deps={[JSON.stringify(buildings), JSON.stringify(roads), robber, tiles, JSON.stringify(extras)]} />
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
        shadow-mapSize={[QUALITY.shadowSize, QUALITY.shadowSize]}
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
    dpr: QUALITY.startDpr,
    shadows: QUALITY.shadows ? { type: PCFShadowMap } : false,
    camera: { near: 100, far: 4000, position: [0, 1500, 0] as [number, number, number], zoom: 1 },
    // an opaque canvas (the table covers it all; the page needn't blend it), the faster GPU on laptops with two
    gl: { antialias: QUALITY.antialias, alpha: false, toneMapping: NeutralToneMapping, powerPreference: 'high-performance' as const, stencil: false },
    onCreated: ({ gl }: { gl: { shadowMap: { autoUpdate: boolean; needsUpdate: boolean }; setClearColor: (c: string) => void } }) => {
      gl.shadowMap.autoUpdate = false
      gl.shadowMap.needsUpdate = true
      gl.setClearColor('#4a3324')
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
