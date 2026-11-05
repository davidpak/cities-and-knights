/**
 * The expansion's pieces on the table (fixed things, not bodies):
 *
 *   the voyage       a little sea board: the barbarians' route from the open sea to an island with a town, seven
 *                    buoys along it, their longship gliding buoy to buoy at each ship on the event die (and back out
 *                    once they've landed). A signpost on the shore is painted with what matters: their strength (a
 *                    city each) against the strength of the knights standing ready
 *   flip charts      your three tracks, each a desk flip chart on a wooden stand: its page shows the level reached,
 *                    the building that grows with it, and what the next step costs. Click one to take its next step;
 *                    the page goes over the top. Everyone else's stand small beside their cards
 *
 * All of it is a few draws: the charts are three instanced draws however many there are (stands, rings, pages, every
 * page out of one picture), the voyage a handful.
 */
import { useFrame, type ThreeEvent } from '@react-three/fiber'
import { useLayoutEffect, useMemo, useRef } from 'react'
import {
  BoxGeometry, CanvasTexture, Color, InstancedBufferAttribute, Matrix4, Object3D, Quaternion, SRGBColorSpace, Vector3, type InstancedMesh, type Group,
} from 'three'
import type { View } from '../../../../shared/engine.ts'
import { BARBARIAN_STEPS, MAX_LEVEL, TRACKS, TRACK_GOOD, TRACK_LEVELS, TRACK_NAME, type Track } from '../../../../shared/rules.ts'
import { ICON, SHIELD } from '../../lib/icons.ts'
import { PAL, PLAYER, TRACK_COLOR } from '../../lib/palette.ts'
import { mat } from '../../lib/toy.ts'
import { FONT } from '../atlas.ts'
import { rim } from '../geometry.ts'
import { useRedraw } from '../Pieces.tsx'
import { QUALITY } from '../quality.ts'
import { settlementGeo, cityGeo } from '../geometry.ts'
import {
  CHART, ISLAND, buoyGeo, chartGeo, chartTop, hullGeo, islandGeo, meadowGeo, pageGeo, plaqueGeo, postGeo, ringGeo, sailGeo, shieldGeo, shieldSpots, towerGeo,
} from '../voyage.ts'
import { wood } from '../wood.ts'
import { atlasMaterial } from './cardMesh.ts'
import { SEAT_TRACKS, TRACKS_BOX, VOYAGE, seatParts, type Layout } from './layout.ts'

const BOX = new BoxGeometry(1, 1, 1)
const dummy = new Object3D()
const INK = '#2a1d13'

export function ExpansionTable({ view, layout, can, onImprove }: { view: View; layout: Layout; can: Record<Track, boolean>; onImprove: (t: Track) => void }) {
  const x = view.x
  const K = layout.k
  if (!x || !K) return null
  return (
    <>
      <Voyage view={view} at={K.lane} />
      <FlipCharts view={view} layout={layout} can={can} onImprove={onImprove} />
    </>
  )
}

// ---------------------------------------------------------------- the voyage

/** the route in the board's own frame (mm, its middle at 0): stop 0 out at sea on the left, stop 7 the island's shore */
const ROUTE = Array.from({ length: BARBARIAN_STEPS + 1 }, (_, i) => {
  const t = i / BARBARIAN_STEPS
  return { x: -104 + t * 172, z: 22 * Math.sin(t * Math.PI * 1.3 + 0.35) * (1 - t * 0.35) }
})
const ISLE = { x: 94, z: -4 }
/** a point along the route, for a step that may be part-way (2.4: four tenths from buoy 2 to buoy 3) */
function along(step: number) {
  const i = Math.max(0, Math.min(BARBARIAN_STEPS - 1, Math.floor(step)))
  const f = Math.max(0, Math.min(1, step - i))
  const a = ROUTE[i]
  const b = ROUTE[i + 1]
  return { x: a.x + (b.x - a.x) * f, z: a.z + (b.z - a.z) * f, heading: Math.atan2(-(b.z - a.z), b.x - a.x) }
}

let seaPicture: CanvasTexture | null = null
/** the board's painted sea: deeper toward the open sea, waves, the route dashed in, sand round the island */
function sea() {
  if (seaPicture) return seaPicture
  const S = 4 // px per mm
  const c = document.createElement('canvas')
  c.width = VOYAGE.w * S
  c.height = VOYAGE.d * S
  const g = c.getContext('2d')!
  const X = (x: number) => (x + VOYAGE.w / 2) * S
  const Z = (z: number) => (z + VOYAGE.d / 2) * S
  const grad = g.createLinearGradient(0, 0, c.width, 0)
  grad.addColorStop(0, '#2f5f7c')
  grad.addColorStop(0.55, '#4d8aa8')
  grad.addColorStop(1, '#6eaac0')
  g.fillStyle = grad
  g.fillRect(0, 0, c.width, c.height)
  // the open sea, darker and misty where they come from
  const fog = g.createRadialGradient(X(-125), Z(0), 10, X(-125), Z(0), 360)
  fog.addColorStop(0, 'rgba(20, 30, 40, 0.45)')
  fog.addColorStop(1, 'rgba(20, 30, 40, 0)')
  g.fillStyle = fog
  g.fillRect(0, 0, c.width, c.height)
  // shallows and sand round the island
  const sand = g.createRadialGradient(X(ISLE.x), Z(ISLE.z), ISLAND.r * S * 0.8, X(ISLE.x), Z(ISLE.z), ISLAND.r * S * 1.7)
  sand.addColorStop(0, 'rgba(230, 214, 170, 0.95)')
  sand.addColorStop(0.45, 'rgba(150, 205, 200, 0.6)')
  sand.addColorStop(1, 'rgba(150, 205, 200, 0)')
  g.fillStyle = sand
  g.fillRect(0, 0, c.width, c.height)
  // waves: little arcs scattered (the same every time)
  let t = 11
  const rnd = () => ((t = (t * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
  g.strokeStyle = 'rgba(235, 245, 248, 0.35)'
  g.lineWidth = 3
  for (let i = 0; i < 70; i++) {
    const wx = rnd() * c.width
    const wz = rnd() * c.height
    if (Math.hypot(wx - X(ISLE.x), wz - Z(ISLE.z)) < ISLAND.r * S * 1.5) continue
    g.beginPath()
    g.arc(wx, wz, 10 + rnd() * 10, Math.PI * 1.15, Math.PI * 1.85)
    g.stroke()
  }
  // the route, dashed
  g.setLineDash([16, 14])
  g.strokeStyle = 'rgba(255, 246, 226, 0.75)'
  g.lineWidth = 5
  g.beginPath()
  ROUTE.forEach((p, i) => (i ? g.lineTo(X(p.x), Z(p.z)) : g.moveTo(X(p.x), Z(p.z))))
  g.stroke()
  seaPicture = new CanvasTexture(c)
  seaPicture.colorSpace = SRGBColorSpace
  seaPicture.anisotropy = QUALITY.aniso
  return seaPicture
}

/** the sail: red and cream stripes */
let sailPicture: CanvasTexture | null = null
function sailStripes() {
  if (sailPicture) return sailPicture
  const c = document.createElement('canvas')
  c.width = 128
  c.height = 96
  const g = c.getContext('2d')!
  for (let i = 0; i < 8; i++) {
    g.fillStyle = i % 2 ? '#efe4cc' : '#a8362d'
    g.fillRect(i * 16, 0, 16, 96)
  }
  sailPicture = new CanvasTexture(c)
  sailPicture.colorSpace = SRGBColorSpace
  return sailPicture
}

/** the signpost's board: their strength against the knights' (painted, so it's part of the scene) */
function usePlaque(strength: number, defense: number) {
  const tex = useMemo(() => {
    const c = document.createElement('canvas')
    c.width = 256
    c.height = 146
    const t = new CanvasTexture(c)
    t.colorSpace = SRGBColorSpace
    t.anisotropy = QUALITY.aniso
    return t
  }, [])
  useLayoutEffect(() => {
    const c = tex.image as HTMLCanvasElement
    const g = c.getContext('2d')!
    g.fillStyle = '#d9c29a'
    g.fillRect(0, 0, 256, 146)
    g.fillStyle = 'rgba(90, 60, 30, 0.18)'
    for (let y = 8; y < 146; y += 13) g.fillRect(0, y, 256, 2)
    const row = (y: number, path: string, color: string, n: number, word: string) => {
      g.save()
      g.translate(18, y - 24)
      g.scale(48 / 24, 48 / 24)
      g.fillStyle = color
      g.fill(new Path2D(path))
      g.restore()
      g.fillStyle = color
      g.font = `800 64px ${FONT}`
      g.textAlign = 'right'
      g.textBaseline = 'middle'
      g.fillText(String(n), 236, y + 3)
      void word
    }
    const safe = defense >= strength
    row(40, 'M12 2l1.6 5.2H19l-4.4 3.2 1.7 5.3L12 12.5l-4.3 3.2 1.7-5.3L5 7.2h5.4z M11 13h2v9h-2z', '#9c2f24', strength, 'raiders')
    row(106, SHIELD, safe ? '#2e7d4a' : '#9c2f24', defense, 'knights')
    tex.needsUpdate = true
  }, [tex, strength, defense])
  return tex
}

function Voyage({ view, at }: { view: View; at: [number, number] }) {
  const x = view.x!
  const step = Math.min(x.barbarian, BARBARIAN_STEPS)
  const strength = Object.values(view.buildings).filter((b) => b.kind === 'city').length
  const defense = Object.values(x.knights).filter((k) => k.active).reduce((n, k) => n + k.level, 0)
  const plaque = usePlaque(strength, defense)
  const redraw = useRedraw()
  const ship = useRef<Group>(null)
  const buoys = useRef<InstancedMesh>(null)
  const shields = useRef<InstancedMesh>(null)
  const frame = useMemo(() => rim(VOYAGE.w + 8, VOYAGE.d + 8, 5, 8, 6), [])
  const shown = useRef(step)
  const [ax, az] = at

  // the buoys: the ones they've passed go grey
  useLayoutEffect(() => {
    const m = buoys.current
    if (!m) return
    for (let i = 0; i < BARBARIAN_STEPS; i++) {
      const p = ROUTE[i + 1]
      dummy.position.set(ax + p.x, 3, az + p.z + 9)
      dummy.rotation.set(0, 0, 0)
      dummy.scale.setScalar(1)
      dummy.updateMatrix()
      m.setMatrixAt(i, dummy.matrix)
      m.setColorAt(i, new Color(i < step ? '#7d8a91' : i === BARBARIAN_STEPS - 1 ? '#e3a72c' : '#c8453c'))
    }
    m.instanceMatrix.needsUpdate = true
    if (m.instanceColor) m.instanceColor.needsUpdate = true
    m.computeBoundingSphere()
    redraw()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ax, az, step])
  // the shields down the ship's sides, red and cream
  useLayoutEffect(() => {
    const m = shields.current
    if (!m) return
    shieldSpots().forEach((s, i) => {
      dummy.position.set(s.x, s.y, s.z)
      dummy.rotation.set(0, 0, 0)
      dummy.scale.setScalar(1)
      dummy.updateMatrix()
      m.setMatrixAt(i, dummy.matrix)
      m.setColorAt(i, new Color(i % 2 ? '#efe4cc' : '#a8362d'))
    })
    m.instanceMatrix.needsUpdate = true
    if (m.instanceColor) m.instanceColor.needsUpdate = true
  }, [])

  // the ship glides on a step at a time (and, once they've landed, sails back out quickly), rocking as it goes
  useFrame((_, dt) => {
    const o = ship.current
    if (!o) return
    const want = step
    const was = shown.current
    if (Math.abs(want - was) > 0.0005) {
      shown.current = want < was ? Math.max(want, was - dt * 5) : Math.min(want, was + dt * 1.4)
      redraw()
    }
    const s = shown.current
    const p = along(s)
    const moving = Math.abs(want - s) > 0.0005
    const t = performance.now() / 1000
    o.position.set(ax + p.x, 1.2 + (moving ? Math.sin(t * 6) * 0.6 : 0), az + p.z)
    o.rotation.set(moving ? Math.sin(t * 5) * 0.06 : 0, p.heading, 0, 'YXZ')
  })

  return (
    <group>
      {/* the board: painted sea in a maple frame */}
      <mesh geometry={BOX} material={mat('#ffffff', { map: sea() })} scale={[VOYAGE.w, 2, VOYAGE.d]} position={[ax, 1, az]} receiveShadow />
      <mesh geometry={frame} material={mat(PAL.maple)} position={[ax, 0, az]} castShadow receiveShadow />
      {/* the island, its town and watchtower, the signpost on the shore */}
      <group position={[ax + ISLE.x, 2, az + ISLE.z]}>
        <mesh geometry={islandGeo()} material={mat('#d9c08a')} castShadow receiveShadow />
        <mesh geometry={meadowGeo()} material={mat('#7fb05b')} castShadow receiveShadow />
        <mesh geometry={settlementGeo()} material={wood('#efe6d4')} position={[-9, ISLAND.h + 1, 6]} scale={0.55} castShadow />
        <mesh geometry={settlementGeo()} material={wood('#e6d8bf')} position={[2, ISLAND.h + 1.2, 9]} scale={0.5} rotation={[0, 0.6, 0]} castShadow />
        <mesh geometry={cityGeo()} material={wood('#efe6d4')} position={[-4, ISLAND.h + 1.2, -7]} scale={0.45} castShadow />
        <mesh geometry={towerGeo()} material={mat('#b8a88c')} position={[10, ISLAND.h - 0.5, -6]} castShadow />
      </group>
      {/* the signpost, on a rock in the shallows before the island: their strength against the knights' */}
      <group position={[ax + ISLE.x - 40, 2, az + 35]}>
        <mesh geometry={BOX} material={mat('#8f877c')} scale={[12, 4, 9]} position={[0, 2, 0]} castShadow receiveShadow />
        <group rotation={[-0.62, 0, 0]}>
          <mesh geometry={postGeo()} material={mat('#6d4c33')} castShadow />
          <mesh geometry={plaqueGeo()} material={[mat('#8a5e3c'), mat('#8a5e3c'), mat('#8a5e3c'), mat('#8a5e3c'), mat('#ffffff', { map: plaque }), mat('#8a5e3c')]} position={[0, 18, 1]} scale={1.5} castShadow />
        </group>
      </group>
      <instancedMesh ref={buoys} args={[buoyGeo(), wood(), BARBARIAN_STEPS]} castShadow />
      {/* the longship */}
      <group ref={ship}>
        <mesh geometry={hullGeo()} material={wood('#4a3527')} castShadow />
        <mesh geometry={sailGeo()} material={mat('#ffffff', { map: sailStripes(), side: 2 })} castShadow />
        <instancedMesh ref={shields} args={[shieldGeo(), wood(), 12]} castShadow />
      </group>
    </group>
  )
}

// ---------------------------------------------------------------- flip charts

const PAGE = { w: 256, h: 280 } // px per page in the picture of all pages
const PAGE_COLS = MAX_LEVEL + 1

/** a building for a level: a hut at one, a hall with a tower at four, a palace at five (in the track's colour) */
function building(g: CanvasRenderingContext2D, level: number, color: string, cx: number, base: number) {
  g.fillStyle = color
  const house = (x: number, w: number, h: number, roof: number) => {
    g.beginPath()
    g.moveTo(x - w / 2, base)
    g.lineTo(x + w / 2, base)
    g.lineTo(x + w / 2, base - h)
    g.lineTo(x, base - h - roof)
    g.lineTo(x - w / 2, base - h)
    g.closePath()
    g.fill()
  }
  const tower = (x: number, w: number, h: number) => {
    g.fillRect(x - w / 2, base - h, w, h)
    g.beginPath()
    g.moveTo(x - w / 2 - 3, base - h)
    g.lineTo(x, base - h - w)
    g.lineTo(x + w / 2 + 3, base - h)
    g.closePath()
    g.fill()
  }
  g.fillRect(cx - 80, base, 160, 4)
  if (level === 0) {
    g.globalAlpha = 0.35
    house(cx, 40, 22, 16)
    g.globalAlpha = 1
    return
  }
  if (level >= 1) house(cx - (level >= 2 ? 26 : 0), 40, 24, 18)
  if (level >= 2) house(cx + 26, 36, 20, 16)
  if (level >= 3) tower(cx, 22, 52)
  if (level >= 4) {
    house(cx - 56, 26, 30, 14)
    house(cx + 56, 26, 30, 14)
  }
  if (level >= 5) {
    // a dome over the middle
    g.beginPath()
    g.arc(cx, base - 64, 20, Math.PI, 0)
    g.fill()
    g.fillRect(cx - 1.5, base - 98, 3, 16)
  }
}

let pagesPicture: CanvasTexture | null = null
/** every page of every track in one picture: a row per track, a column per level (0 to 5) */
function pages() {
  if (pagesPicture) return pagesPicture
  const c = document.createElement('canvas')
  c.width = PAGE.w * PAGE_COLS
  c.height = PAGE.h * TRACKS.length
  const g = c.getContext('2d')!
  TRACKS.forEach((t, r) => {
    const color = TRACK_COLOR[t]
    for (let level = 0; level <= MAX_LEVEL; level++) {
      g.save()
      g.translate(level * PAGE.w, r * PAGE.h)
      // paper, with the track's colour across the top
      g.fillStyle = '#f6ecd5'
      g.fillRect(0, 0, PAGE.w, PAGE.h)
      g.fillStyle = color
      g.fillRect(0, 0, PAGE.w, 54)
      g.fillStyle = '#fffaf0'
      g.font = `800 28px ${FONT}`
      g.textAlign = 'left'
      g.textBaseline = 'middle'
      g.fillText(TRACK_NAME[t], 16, 29)
      // the level, big, beside the building it has grown to
      g.fillStyle = INK
      g.textAlign = 'center'
      g.font = `800 112px ${FONT}`
      g.fillText(level ? String(level) : '0', 62, 132)
      g.save()
      g.translate(170, -12)
      g.scale(0.86, 0.86)
      building(g, level, color, 0, 222)
      g.restore()
      g.fillStyle = INK
      g.font = `700 24px ${FONT}`
      g.fillText(level ? TRACK_LEVELS[t][level - 1] : 'Nothing yet', PAGE.w / 2, 210)
      // what the next step costs, as commodity marks (or done)
      if (level < MAX_LEVEL) {
        const n = level + 1
        const size = 26
        const gap = 6
        const w = n * size + (n - 1) * gap
        for (let i = 0; i < n; i++) {
          g.save()
          g.translate(PAGE.w / 2 - w / 2 + i * (size + gap), 238)
          g.scale(size / 24, size / 24)
          g.fillStyle = color
          g.fill(new Path2D(ICON[TRACK_GOOD[t]]))
          g.restore()
        }
      } else {
        g.font = `700 20px ${FONT}`
        g.fillStyle = color
        g.fillText('Complete', PAGE.w / 2, 252)
      }
      // a perk from level 3: a small star by the number
      if (level >= 3) {
        g.save()
        g.translate(PAGE.w - 98, 16)
        g.scale(22 / 24, 22 / 24)
        g.fillStyle = '#fffaf0'
        g.fill(new Path2D('M12 2l2.9 6.6 7.1.6-5.4 4.7 1.6 7.1L12 17.3 5.8 21l1.6-7.1L2 9.2l7.1-.6z'))
        g.restore()
      }
      g.restore()
    }
  })
  pagesPicture = new CanvasTexture(c)
  pagesPicture.colorSpace = SRGBColorSpace
  pagesPicture.anisotropy = QUALITY.aniso
  return pagesPicture
}

type Chart = { key: string; x: number; z: number; scale: number; track: Track; level: number; mine: boolean; color: string }
const FRONT = CHART.lean
const tmpM = new Matrix4()
const tmpQ = new Quaternion()
const tmpP = new Vector3()
const tmpS = new Vector3()
const bx = new Vector3()
const by = new Vector3()
const bz = new Vector3()

/** a page hanging from the hinge at angle psi (54°: down the front; it goes over the top to 54° - 288°) */
function pageMatrix(c: Chart, psi: number, out: Matrix4) {
  const top = chartTop()
  bx.set(1, 0, 0)
  by.set(0, Math.sin(psi), -Math.cos(psi))
  bz.set(0, Math.cos(psi), Math.sin(psi))
  const basis = new Matrix4().makeBasis(bx, by, bz)
  tmpQ.setFromRotationMatrix(basis)
  // a hair off the board, on the side that faces you
  tmpP.set(0, top, 0).addScaledVector(bz, 1.7)
  tmpS.setScalar(1)
  out.compose(tmpP, tmpQ, tmpS)
  return new Matrix4().makeScale(c.scale, c.scale, c.scale).premultiply(new Matrix4().makeTranslation(c.x, 0, c.z)).multiply(out)
}

function FlipCharts({ view, layout, can, onImprove }: { view: View; layout: Layout; can: Record<Track, boolean>; onImprove: (t: Track) => void }) {
  const x = view.x!
  const K = layout.k!
  const me = view.you
  const charts: Chart[] = useMemo(() => {
    const out: Chart[] = []
    if (me >= 0)
      TRACKS.forEach((t, i) =>
        out.push({ key: `${me}:${t}`, x: K.tracks[0] + (i - 1) * TRACKS_BOX.stand, z: K.tracks[1], scale: SEAT_TRACKS.mine, track: t, level: x.levels[me][t], mine: true, color: TRACK_COLOR[t] }),
      )
    for (const { p, at } of layout.seats) {
      const [sx, sz] = seatParts(at, layout.portrait).knights
      TRACKS.forEach((t, i) =>
        out.push({ key: `${p}:${t}`, x: sx + (i - 1) * 60 * SEAT_TRACKS.scale, z: sz + 4, scale: SEAT_TRACKS.scale, track: t, level: x.levels[p][t], mine: false, color: PLAYER[view.players[p].color].ui }),
      )
    }
    return out
  }, [x.levels, me, layout, K.tracks, view.players])

  const stands = useRef<InstancedMesh>(null)
  const rings = useRef<InstancedMesh>(null)
  const pagesMesh = useRef<InstancedMesh>(null)
  const tiles = useMemo(() => new InstancedBufferAttribute(new Float32Array(64), 1), [])
  const geo = useMemo(() => {
    const g = pageGeo().clone()
    g.setAttribute('aTile', tiles)
    return g
  }, [tiles])
  const material = useMemo(() => atlasMaterial(pages(), PAGE_COLS, TRACKS.length, 'pages'), [])
  /** each chart's page turning over (from level, started at) */
  const flips = useRef(new Map<string, { from: number; t0: number; shown: number }>())
  const redraw = useRedraw()

  useLayoutEffect(() => {
    const now = performance.now() / 1000
    for (const c of charts) {
      const f = flips.current.get(c.key)
      if (!f) flips.current.set(c.key, { from: c.level, t0: -1e9, shown: c.level })
      else if (f.shown !== c.level) flips.current.set(c.key, { from: f.shown, t0: now, shown: c.level })
    }
    const sm = stands.current
    const rm = rings.current
    if (sm && rm) {
      charts.forEach((c, i) => {
        tmpM.compose(tmpP.set(c.x, 0, c.z), tmpQ.identity(), tmpS.setScalar(c.scale))
        sm.setMatrixAt(i, tmpM)
        rm.setMatrixAt(i, tmpM)
        sm.setColorAt(i, new Color(c.mine && can[c.track] ? '#c99a5e' : '#a87b50'))
      })
      sm.count = rm.count = charts.length
      sm.instanceMatrix.needsUpdate = rm.instanceMatrix.needsUpdate = true
      if (sm.instanceColor) sm.instanceColor.needsUpdate = true
      sm.computeBoundingSphere()
      rm.computeBoundingSphere()
    }
    redraw()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [charts, can])

  // pages: each chart's current page down the front, and while it turns, the old one going over the top
  useFrame(() => {
    const m = pagesMesh.current
    if (!m) return
    const now = performance.now() / 1000
    let n = 0
    let turning = false
    const owners = pageOwner.current
    owners.length = 0
    for (const [ci, c] of charts.entries()) {
      owners.push(ci)
      const f = flips.current.get(c.key)!
      const row = TRACKS.indexOf(c.track)
      m.setMatrixAt(n, pageMatrix(c, FRONT, tmpM))
      tiles.setX(n++, row * PAGE_COLS + c.level)
      const k = (now - f.t0) / 0.7
      if (k < 1 && f.from !== c.level) {
        turning = true
        const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2
        m.setMatrixAt(n, pageMatrix(c, FRONT - e * ((288 * Math.PI) / 180), tmpM))
        tiles.setX(n++, row * PAGE_COLS + f.from)
        owners.push(ci)
      }
    }
    m.count = n
    m.instanceMatrix.needsUpdate = true
    tiles.needsUpdate = true
    m.computeBoundingSphere()
    if (turning) redraw()
  })

  const pageOwner = useRef<number[]>([])
  const handlersFor = (pagesOf: boolean) => {
    const chartOf = (e: ThreeEvent<PointerEvent | MouseEvent>) => {
      if (e.instanceId === undefined) return null
      // (stands are one per chart; a turning page sits between pages, so pages map through their owners)
      const c = charts[pagesOf ? pageOwner.current[e.instanceId] : e.instanceId]
      return c?.mine ? c : null
    }
    return {
    onPointerMove: (e: ThreeEvent<PointerEvent>) => {
      const c = chartOf(e)
      if (!c || !can[c.track]) return
      e.stopPropagation()
      document.body.style.cursor = 'pointer'
    },
    onPointerOut: () => (document.body.style.cursor = ''),
    onClick: (e: ThreeEvent<MouseEvent>) => {
      const c = chartOf(e)
      if (!c) return
      e.stopPropagation()
      onImprove(c.track)
    },
    }
  }

  return (
    <>
      {/* a mat under each of your charts you can take the next step of */}
      {charts
        .filter((c) => c.mine && can[c.track])
        .map((c) => (
          <mesh key={c.key} geometry={BOX} material={mat(PAL.cream)} scale={[(CHART.w + 6) * c.scale, 0.6, 72 * c.scale]} position={[c.x, 0.3, c.z]} receiveShadow onClick={() => onImprove(c.track)} />
        ))}
      <instancedMesh ref={stands} args={[chartGeo(), wood(), 16]} castShadow receiveShadow {...handlersFor(false)} />
      <instancedMesh ref={rings} args={[ringGeo(), mat('#8f8c88'), 16]} castShadow />
      <instancedMesh ref={pagesMesh} args={[geo, material, 32]} castShadow {...handlersFor(true)} />
    </>
  )
}
