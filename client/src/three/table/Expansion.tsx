/**
 * The expansion's pieces on the table (fixed things, not bodies):
 *
 *   the voyage       the barbarians' way in: a painted sea board in a maple frame along the board's side, eight big
 *                    hexes laid on it zig-zagging from the fog out at sea through seven numbered ones to an island
 *                    with a town. Their longship sails a hex on at each ship on the event die (and back out once
 *                    they've landed); the hexes crossed go dark. A signpost on the island is painted with what
 *                    matters: their strength (a city each) against the strength of the knights standing ready
 *   flip charts      your three tracks, each a desk flip chart on a wooden stand: its page shows the level reached,
 *                    the building that grows with it, and what the next step costs. Click one to take its next step;
 *                    the page goes over the top. (Everyone else's levels show as numbers by their names)
 *
 * All of it is a few draws: the charts are three instanced draws however many there are (stands, rings, pages, every
 * page out of one picture), the voyage a handful.
 */
import { useFrame, type ThreeEvent } from '@react-three/fiber'
import { useLayoutEffect, useMemo, useRef } from 'react'
import {
  BoxGeometry, BufferGeometry, CanvasTexture, Color, CylinderGeometry, InstancedBufferAttribute, Matrix4, Object3D, Quaternion, SRGBColorSpace, Shape, ShapeGeometry, Vector3,
  type InstancedMesh, type Group,
} from 'three'
import type { View } from '../../../../shared/engine.ts'
import { BARBARIAN_STEPS, MAX_LEVEL, TRACKS, TRACK_GOOD, TRACK_LEVELS, TRACK_NAME, type Track } from '../../../../shared/rules.ts'
import { ICON, SHIELD } from '../../lib/icons.ts'
import { PAL, TRACK_COLOR } from '../../lib/palette.ts'
import { mat } from '../../lib/toy.ts'
import { FONT } from '../atlas.ts'
import { useRedraw } from '../Pieces.tsx'
import { QUALITY } from '../quality.ts'
import { settlementGeo, cityGeo } from '../geometry.ts'
import { CHART, ISLAND, chartGeo, chartTop, hullGeo, islandGeo, meadowGeo, pageGeo, plaqueGeo, postGeo, ringGeo, sailGeo, shieldGeo, shieldSpots, towerGeo } from '../voyage.ts'
import { rim } from '../geometry.ts'
import { wood } from '../wood.ts'
import { atlasMaterial } from './cardMesh.ts'
import { raidToTable, tracksBox, type Layout, type Raid } from './layout.ts'

const BOX = new BoxGeometry(1, 1, 1)
const dummy = new Object3D()
const INK = '#2a1d13'

export function ExpansionTable({ view, layout, can, onImprove, trayOut }: { view: View; layout: Layout; can: Record<Track, boolean>; onImprove: (t: Track) => void; trayOut: boolean }) {
  const x = view.x
  const K = layout.k
  if (!x || !K) return null
  return (
    <>
      <Voyage view={view} R={K.raid} />
      <FlipCharts view={view} layout={layout} can={can} onImprove={onImprove} mineShown={!(K.tracksYield && trayOut)} />
    </>
  )
}

// ---------------------------------------------------------------- the voyage

const CELL = 256
const RAID_COLS = 4
const STEPS = BARBARIAN_STEPS + 1 // hexes 0 (out at sea) to 7 (the last before the island)
/** what a hex shows from above, by step: 0 fog out at sea; 1 to 7 its number on a token like the board's (the last
 *  few in red). A pale rim of foam round each, so the hexes stand out from the sea they lie on */
function paintHex(g: CanvasRenderingContext2D, i: number) {
  const cx = (i % RAID_COLS) * CELL + CELL / 2
  const cy = Math.floor(i / RAID_COLS) * CELL + CELL / 2
  const R = CELL / 2
  const hex = (r: number) => {
    g.beginPath()
    for (let k = 0; k < 6; k++) g[k ? 'lineTo' : 'moveTo'](cx + r * Math.cos((k * Math.PI) / 3), cy + r * Math.sin((k * Math.PI) / 3))
    g.closePath()
  }
  g.save()
  hex(R)
  g.clip()
  // deeper and darker out at sea, lighter toward the island
  const t = i / (STEPS - 1)
  const mix = (a: number[], b: number[]) => `rgb(${a.map((v, k) => Math.round(v + (b[k] - v) * t)).join(',')})`
  const grad = g.createLinearGradient(cx, cy - R, cx, cy + R)
  grad.addColorStop(0, mix([40, 74, 98], [92, 160, 184]))
  grad.addColorStop(1, mix([52, 92, 118], [112, 178, 198]))
  g.fillStyle = grad
  g.fillRect(cx - R, cy - R, CELL, CELL)
  g.strokeStyle = 'rgba(235, 245, 248, 0.3)'
  g.lineWidth = 5
  let seed = 7 + i * 13
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
  for (let k = 0; k < 9; k++) {
    const wx = cx + (rnd() - 0.5) * CELL * 0.9
    const wy = cy + (rnd() - 0.5) * CELL * 0.8
    if (i > 0 && Math.hypot(wx - cx, wy - cy) < 72) continue
    g.beginPath()
    g.arc(wx, wy, 14 + rnd() * 10, Math.PI * 1.15, Math.PI * 1.85)
    g.stroke()
  }
  if (i === 0) {
    const fog = g.createRadialGradient(cx, cy, 10, cx, cy, R)
    fog.addColorStop(0, 'rgba(220, 228, 232, 0.6)')
    fog.addColorStop(1, 'rgba(220, 228, 232, 0.08)')
    g.fillStyle = fog
    g.fillRect(cx - R, cy - R, CELL, CELL)
  } else {
    g.fillStyle = PAL.cream
    g.beginPath()
    g.arc(cx, cy, 66, 0, Math.PI * 2)
    g.fill()
    g.fillStyle = i >= STEPS - 3 ? PAL.red : PAL.plum
    g.font = `800 98px ${FONT}`
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.fillText(String(i), cx, cy + 6)
  }
  hex(R - 6)
  g.strokeStyle = 'rgba(240, 248, 250, 0.75)'
  g.lineWidth = 10
  g.stroke()
  g.restore()
}

let raidPicture: CanvasTexture | null = null
function raidTops() {
  if (raidPicture) return raidPicture
  const c = document.createElement('canvas')
  c.width = CELL * RAID_COLS
  c.height = CELL * Math.ceil(STEPS / RAID_COLS)
  const g = c.getContext('2d')!
  for (let i = 0; i < STEPS; i++) paintHex(g, i)
  raidPicture = new CanvasTexture(c)
  raidPicture.colorSpace = SRGBColorSpace
  raidPicture.anisotropy = QUALITY.aniso
  return raidPicture
}

/** the sea board's painting, in its own frame (x along it): darker and misty where they come from, sand round the
 *  island at the far end, waves */
const seaPictures = new Map<string, CanvasTexture>()
function sea(R: Raid) {
  const key = `${R.len.toFixed(1)}x${R.wid.toFixed(1)}`
  const hit = seaPictures.get(key)
  if (hit) return hit
  const S = 4 // px per mm
  const c = document.createElement('canvas')
  c.width = Math.round(R.len * S)
  c.height = Math.round(R.wid * S)
  const g = c.getContext('2d')!
  const X = (x: number) => (x + R.len / 2) * S
  const Z = (z: number) => (z + R.wid / 2) * S
  const grad = g.createLinearGradient(0, 0, c.width, 0)
  grad.addColorStop(0, '#2f5f7c')
  grad.addColorStop(0.55, '#4d8aa8')
  grad.addColorStop(1, '#6eaac0')
  g.fillStyle = grad
  g.fillRect(0, 0, c.width, c.height)
  const fog = g.createRadialGradient(X(-R.len / 2), Z(0), 10, X(-R.len / 2), Z(0), 300)
  fog.addColorStop(0, 'rgba(20, 30, 40, 0.45)')
  fog.addColorStop(1, 'rgba(20, 30, 40, 0)')
  g.fillStyle = fog
  g.fillRect(0, 0, c.width, c.height)
  const [ix, iz] = R.island
  const isle = 0.95 * R.r
  const sand = g.createRadialGradient(X(ix), Z(iz), isle * S * 0.8, X(ix), Z(iz), isle * S * 1.7)
  sand.addColorStop(0, 'rgba(230, 214, 170, 0.95)')
  sand.addColorStop(0.45, 'rgba(150, 205, 200, 0.6)')
  sand.addColorStop(1, 'rgba(150, 205, 200, 0)')
  g.fillStyle = sand
  g.fillRect(0, 0, c.width, c.height)
  let t = 11
  const rnd = () => ((t = (t * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
  g.strokeStyle = 'rgba(235, 245, 248, 0.35)'
  g.lineWidth = 3
  for (let i = 0; i < 90; i++) {
    const wx = rnd() * c.width
    const wz = rnd() * c.height
    if (Math.hypot(wx - X(ix), wz - Z(iz)) < isle * S * 1.5) continue
    g.beginPath()
    g.arc(wx, wz, 10 + rnd() * 10, Math.PI * 1.15, Math.PI * 1.85)
    g.stroke()
  }
  const tex = new CanvasTexture(c)
  tex.colorSpace = SRGBColorSpace
  tex.anisotropy = QUALITY.aniso
  seaPictures.set(key, tex)
  return tex
}

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

const HEX_H = 4 // [D] each hex: a wooden tile laid on the sea board
const SEA_TOP = 2
const hexTop = (() => {
  let g: BufferGeometry | null = null
  return () => {
    if (g) return g
    const sh = new Shape()
    for (let k = 0; k < 6; k++) sh[k ? 'lineTo' : 'moveTo'](Math.cos((k * Math.PI) / 3), Math.sin((k * Math.PI) / 3))
    g = new ShapeGeometry(sh)
    // uv straight from the shape (its picture's square round it); laid flat, the picture's top lies away from you
    const pos = g.attributes.position
    const uv = g.attributes.uv
    for (let k = 0; k < pos.count; k++) uv.setXY(k, pos.getX(k) / 2 + 0.5, pos.getY(k) / 2 + 0.5)
    return g.rotateX(-Math.PI / 2)
  }
})()
const hexBody = (() => {
  let g: BufferGeometry | null = null
  return () => (g ??= new CylinderGeometry(1, 1, 1, 6).rotateY(Math.PI / 6).translate(0, 0.5, 0))
})()

/**
 * The voyage: the sea board in its maple frame, along the board's side, the hexes laid on it, the longship on the
 * hex it has reached, the island at the far end with its town and the signpost (their strength against the knights').
 * The board and everything on it lie in the board's own frame (turned onto the table); the island, its town and the
 * signpost stand square to you.
 */
function Voyage({ view, R }: { view: View; R: Raid }) {
  const x = view.x!
  const step = Math.min(x.barbarian, BARBARIAN_STEPS)
  const strength = Object.values(view.buildings).filter((b) => b.kind === 'city').length
  const defense = Object.values(x.knights).filter((k) => k.active).reduce((n, k) => n + k.level, 0)
  const plaque = usePlaque(strength, defense)
  const redraw = useRedraw()
  const ship = useRef<Group>(null)
  const tops = useRef<InstancedMesh>(null)
  const bodies = useRef<InstancedMesh>(null)
  const shields = useRef<InstancedMesh>(null)
  const shown = useRef(step)
  const { r, hexes } = R
  const frame = useMemo(() => rim(R.len + 8, R.wid + 8, 5, 8, 6), [R.len, R.wid])
  const tiles = useMemo(() => new InstancedBufferAttribute(new Float32Array(STEPS), 1), [])
  const topGeo = useMemo(() => {
    const g = hexTop().clone()
    g.setAttribute('aTile', tiles)
    return g
  }, [tiles])
  const topMat = useMemo(() => atlasMaterial(raidTops(), RAID_COLS, Math.ceil(STEPS / RAID_COLS), 'raid'), [])
  const k = r / 34 // the ship and the island grow with the hexes
  const [ix, iz] = raidToTable(R, R.island)
  // (beside the last hex, on the side away from the board, where the zig-zag leaves room)
  const [sx, sz] = raidToTable(R, [hexes[STEPS - 1][0] + 0.2 * r, R.wid / 2 - 0.5 * r])

  // the hexes: the ones they've crossed go dark (their pictures turned back square to you)
  useLayoutEffect(() => {
    const t = tops.current
    const b = bodies.current
    if (!t || !b) return
    for (let i = 0; i < STEPS; i++) {
      const [hx, hz] = hexes[i]
      dummy.position.set(hx, SEA_TOP, hz)
      dummy.rotation.set(0, 0, 0)
      dummy.scale.set(r - 1.2, HEX_H, r - 1.2)
      dummy.updateMatrix()
      b.setMatrixAt(i, dummy.matrix)
      b.setColorAt(i, new Color(i < step ? '#6e6259' : PAL.maple))
      dummy.position.set(hx, SEA_TOP + HEX_H + 0.05, hz)
      dummy.rotation.set(0, -R.yaw, 0)
      dummy.scale.set(r - 2.6, 1, r - 2.6)
      dummy.updateMatrix()
      t.setMatrixAt(i, dummy.matrix)
      t.setColorAt(i, new Color(i < step ? '#5d6164' : '#ffffff'))
      tiles.setX(i, i)
    }
    tiles.needsUpdate = true
    for (const m of [t, b]) {
      m.instanceMatrix.needsUpdate = true
      if (m.instanceColor) m.instanceColor.needsUpdate = true
      m.computeBoundingSphere()
    }
    redraw()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hexes, r, step, R.yaw])
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

  /** a point along the hexes, for a step that may be part-way */
  const along = (s: number) => {
    const i = Math.max(0, Math.min(STEPS - 2, Math.floor(s)))
    const f = Math.max(0, Math.min(1, s - i))
    const [ax, az] = hexes[i]
    const [bx, bz] = hexes[i + 1]
    return { x: ax + (bx - ax) * f, z: az + (bz - az) * f, heading: Math.atan2(-(bz - az), bx - ax) * 0.5 }
  }
  // the ship sails on a hex at a time (and, once they've landed, sails back out quickly), rocking as it goes
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
    o.position.set(p.x, SEA_TOP + HEX_H + 0.4 + (moving ? Math.sin(t * 6) * 0.6 : 0), p.z)
    o.rotation.set(moving ? Math.sin(t * 5) * 0.06 : 0, p.heading, 0, 'YXZ')
    o.scale.setScalar(k)
  })

  return (
    <group>
      <group position={[R.x, 0, R.z]} rotation={[0, R.yaw, 0]}>
        {/* the board: painted sea in a maple frame */}
        <mesh geometry={BOX} material={mat('#ffffff', { map: sea(R) })} scale={[R.len, SEA_TOP, R.wid]} position={[0, SEA_TOP / 2, 0]} receiveShadow />
        <mesh geometry={frame} material={mat(PAL.maple)} castShadow receiveShadow />
        <instancedMesh ref={bodies} args={[hexBody(), wood(), STEPS]} castShadow receiveShadow />
        <instancedMesh ref={tops} args={[topGeo, topMat, STEPS]} receiveShadow />
        {/* the longship */}
        <group ref={ship}>
          <mesh geometry={hullGeo()} material={wood('#4a3527')} castShadow />
          <mesh geometry={sailGeo()} material={mat('#ffffff', { map: sailStripes(), side: 2 })} castShadow />
          <instancedMesh ref={shields} args={[shieldGeo(), wood(), 12]} castShadow />
        </group>
      </group>
      {/* the island, its town and watchtower */}
      <group position={[ix, SEA_TOP, iz]} scale={k * 1.2}>
        <mesh geometry={islandGeo()} material={mat('#d9c08a')} castShadow receiveShadow />
        <mesh geometry={meadowGeo()} material={mat('#7fb05b')} castShadow receiveShadow />
        <mesh geometry={settlementGeo()} material={wood('#efe6d4')} position={[-10, ISLAND.h + 1, 3]} scale={0.55} castShadow />
        <mesh geometry={settlementGeo()} material={wood('#e6d8bf')} position={[2, ISLAND.h + 1.2, 8]} scale={0.5} rotation={[0, 0.6, 0]} castShadow />
        <mesh geometry={cityGeo()} material={wood('#efe6d4')} position={[-3, ISLAND.h + 1.2, -8]} scale={0.45} castShadow />
        <mesh geometry={towerGeo()} material={mat('#b8a88c')} position={[11, ISLAND.h - 0.5, -4]} castShadow />
      </group>
      {/* the signpost, on a rock in the shallows beside the last hex: their strength against the knights' */}
      <group position={[sx, SEA_TOP, sz]} scale={k}>
        <mesh geometry={BOX} material={mat('#8f877c')} scale={[12, 4, 9]} position={[0, 2, 0]} castShadow receiveShadow />
        <group rotation={[-0.62, 0, 0]}>
          <mesh geometry={postGeo()} material={mat('#6d4c33')} castShadow />
          <mesh geometry={plaqueGeo()} material={[mat('#8a5e3c'), mat('#8a5e3c'), mat('#8a5e3c'), mat('#8a5e3c'), mat('#ffffff', { map: plaque }), mat('#8a5e3c')]} position={[0, 17, 1]} scale={1.15} castShadow />
        </group>
      </group>
    </group>
  )
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

/** (on a phone your charts make way for the tray while it's out: `mineShown` false) */
function FlipCharts({ view, layout, can, onImprove, mineShown }: { view: View; layout: Layout; can: Record<Track, boolean>; onImprove: (t: Track) => void; mineShown: boolean }) {
  const x = view.x!
  const K = layout.k!
  const me = view.you
  const charts: Chart[] = useMemo(() => {
    const out: Chart[] = []
    if (me >= 0 && mineShown) {
      const scale = K.tracksScale
      const { stand } = tracksBox(scale)
      TRACKS.forEach((t, i) =>
        out.push({ key: `${me}:${t}`, x: K.tracks[0] + (i - 1) * stand, z: K.tracks[1], scale, track: t, level: x.levels[me][t], mine: true, color: TRACK_COLOR[t] }),
      )
    }
    return out
  }, [x.levels, me, K.tracks, K.tracksScale, mineShown])

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
