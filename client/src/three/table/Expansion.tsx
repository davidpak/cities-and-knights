/**
 * The expansion's pieces on the table (fixed things, not bodies):
 *
 *   the raid         the barbarians' way in: eight big hexes zig-zagging down beside the board, from the open sea
 *                    (fog) through six numbered ones to the landing, a beach with a little town on it. Their longship
 *                    sails a hex on at each ship on the event die (and back out once they've landed); the hexes
 *                    crossed go dim. The landing is painted with what matters: their strength (a city each) against
 *                    the strength of the knights standing ready
 *   flip charts      your three tracks, each a desk flip chart on a wooden stand: its page shows the level reached,
 *                    the building that grows with it, and what the next step costs. Click one to take its next step;
 *                    the page goes over the top. Everyone else's stand small beside their cards
 *
 * All of it is a few draws: the charts are three instanced draws however many there are (stands, rings, pages, every
 * page out of one picture), the raid a handful.
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
import { PAL, PLAYER, TRACK_COLOR } from '../../lib/palette.ts'
import { mat } from '../../lib/toy.ts'
import { FONT } from '../atlas.ts'
import { useRedraw } from '../Pieces.tsx'
import { QUALITY } from '../quality.ts'
import { settlementGeo, cityGeo } from '../geometry.ts'
import { CHART, chartGeo, chartTop, hullGeo, pageGeo, ringGeo, sailGeo, shieldGeo, shieldSpots, towerGeo } from '../voyage.ts'
import { wood } from '../wood.ts'
import { atlasMaterial } from './cardMesh.ts'
import { SEAT_TRACKS, TRACKS_BOX, seatParts, type Layout } from './layout.ts'

const BOX = new BoxGeometry(1, 1, 1)
const dummy = new Object3D()
const INK = '#2a1d13'

export function ExpansionTable({ view, layout, can, onImprove, trayOut }: { view: View; layout: Layout; can: Record<Track, boolean>; onImprove: (t: Track) => void; trayOut: boolean }) {
  const x = view.x
  const K = layout.k
  if (!x || !K) return null
  return (
    <>
      <Raid view={view} path={K.raid} />
      <FlipCharts view={view} layout={layout} can={can} onImprove={onImprove} mineShown={!(K.tracksYield && trayOut)} />
    </>
  )
}

// ---------------------------------------------------------------- the raid

const CELL = 256
const RAID_COLS = 4
const STEPS = BARBARIAN_STEPS + 1 // hexes 0 (out at sea) to 7 (the landing)
/** what a hex shows from above, by step: 0 the open sea, fog; 1 to 6 sea with the step's number on a token; 7 the
 *  landing (sand and grass) with what's at stake painted on it: their strength (a city each) against the knights' */
function paintHex(g: CanvasRenderingContext2D, i: number, strength: number, defense: number) {
  const cx = (i % RAID_COLS) * CELL + CELL / 2
  const cy = Math.floor(i / RAID_COLS) * CELL + CELL / 2
  const R = CELL / 2
  g.save()
  g.beginPath()
  for (let k = 0; k < 6; k++) g[k ? 'lineTo' : 'moveTo'](cx + R * Math.cos((k * Math.PI) / 3), cy + R * Math.sin((k * Math.PI) / 3))
  g.closePath()
  g.clip()
  const land = i === STEPS - 1
  if (!land) {
    // deeper and darker out at sea, lighter toward the shore
    const t = i / (STEPS - 2)
    const mix = (a: number[], b: number[]) => `rgb(${a.map((v, k) => Math.round(v + (b[k] - v) * t)).join(',')})`
    const grad = g.createLinearGradient(cx, cy - R, cx, cy + R)
    grad.addColorStop(0, mix([34, 62, 84], [74, 140, 168]))
    grad.addColorStop(1, mix([46, 82, 106], [98, 164, 186]))
    g.fillStyle = grad
    g.fillRect(cx - R, cy - R, CELL, CELL)
    // waves (the same on every hex, turned a little each)
    g.strokeStyle = 'rgba(235, 245, 248, 0.32)'
    g.lineWidth = 5
    let seed = 7 + i * 13
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
    for (let k = 0; k < 9; k++) {
      const wx = cx + (rnd() - 0.5) * CELL * 0.9
      const wy = cy + (rnd() - 0.5) * CELL * 0.8
      if (i > 0 && Math.hypot(wx - cx, wy - cy) < 70) continue
      g.beginPath()
      g.arc(wx, wy, 14 + rnd() * 10, Math.PI * 1.15, Math.PI * 1.85)
      g.stroke()
    }
    if (i === 0) {
      // out at sea: fog
      const fog = g.createRadialGradient(cx, cy, 10, cx, cy, R)
      fog.addColorStop(0, 'rgba(220, 228, 232, 0.55)')
      fog.addColorStop(1, 'rgba(220, 228, 232, 0.05)')
      g.fillStyle = fog
      g.fillRect(cx - R, cy - R, CELL, CELL)
    } else {
      // the step, on a token like the board's
      g.fillStyle = PAL.cream
      g.beginPath()
      g.arc(cx, cy, 62, 0, Math.PI * 2)
      g.fill()
      g.fillStyle = i >= STEPS - 3 ? PAL.red : PAL.plum
      g.font = `800 92px ${FONT}`
      g.textAlign = 'center'
      g.textBaseline = 'middle'
      g.fillText(String(i), cx, cy + 6)
    }
  } else {
    // the landing: a beach in front of grass, and the two strengths
    g.fillStyle = '#86b860'
    g.fillRect(cx - R, cy - R, CELL, CELL)
    g.fillStyle = '#e6d29c'
    g.beginPath()
    g.ellipse(cx, cy + R * 0.55, R * 1.2, R * 0.75, 0, 0, Math.PI * 2)
    g.fill()
    const safe = defense >= strength
    // two numbers on cream, big: theirs (red, under a sail) and the knights' (under a shield: green while it holds)
    g.fillStyle = PAL.cream
    g.beginPath()
    g.roundRect(cx - 104, cy - 6, 208, 92, 22)
    g.fill()
    const side = (x: number, path: string, color: string, n: number) => {
      g.save()
      g.translate(x - 20, cy - 52)
      g.scale(40 / 24, 40 / 24)
      g.fillStyle = color
      g.fill(new Path2D(path))
      g.restore()
      g.fillStyle = color
      g.font = `800 82px ${FONT}`
      g.textAlign = 'center'
      g.textBaseline = 'middle'
      g.fillText(String(n), x, cy + 44)
    }
    side(cx - 52, 'M4 15h16l-3 5H7z M11 2h2v12h-2z M13 3l7 9h-7z', '#9c2f24', strength)
    side(cx + 52, SHIELD, safe ? '#2e7d4a' : '#9c2f24', defense)
    g.fillStyle = 'rgba(42, 29, 19, 0.55)'
    g.font = `800 40px ${FONT}`
    g.textAlign = 'center'
    g.fillText('vs', cx, cy + 44)
  }
  g.restore()
}

/** the hexes' tops, all in one picture (the landing's repainted when what's at stake changes) */
function useRaidPicture(strength: number, defense: number) {
  const tex = useMemo(() => {
    const c = document.createElement('canvas')
    c.width = CELL * RAID_COLS
    c.height = CELL * Math.ceil(STEPS / RAID_COLS)
    const g = c.getContext('2d')!
    for (let i = 0; i < STEPS - 1; i++) paintHex(g, i, 0, 0)
    const t = new CanvasTexture(c)
    t.colorSpace = SRGBColorSpace
    t.anisotropy = QUALITY.aniso
    return t
  }, [])
  useLayoutEffect(() => {
    const g = (tex.image as HTMLCanvasElement).getContext('2d')!
    paintHex(g, STEPS - 1, strength, defense)
    tex.needsUpdate = true
  }, [tex, strength, defense])
  return tex
}

const HEX_H = 7 // [D] each hex: a thick wooden tile like the board's
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

function Raid({ view, path }: { view: View; path: { r: number; at: [number, number][] } }) {
  const x = view.x!
  const step = Math.min(x.barbarian, BARBARIAN_STEPS)
  const strength = Object.values(view.buildings).filter((b) => b.kind === 'city').length
  const defense = Object.values(x.knights).filter((k) => k.active).reduce((n, k) => n + k.level, 0)
  const picture = useRaidPicture(strength, defense)
  const redraw = useRedraw()
  const ship = useRef<Group>(null)
  const tops = useRef<InstancedMesh>(null)
  const bodies = useRef<InstancedMesh>(null)
  const shields = useRef<InstancedMesh>(null)
  const shown = useRef(step)
  const { r, at } = path
  const tiles = useMemo(() => new InstancedBufferAttribute(new Float32Array(STEPS), 1), [])
  const topGeo = useMemo(() => {
    const g = hexTop().clone()
    g.setAttribute('aTile', tiles)
    return g
  }, [tiles])
  const topMat = useMemo(() => atlasMaterial(picture, RAID_COLS, Math.ceil(STEPS / RAID_COLS), 'raid'), [picture])
  const k = r / 36 // the ship and the town grow with the hexes

  // the hexes: the ones they've crossed go dim; the landing's edge is red
  useLayoutEffect(() => {
    const t = tops.current
    const b = bodies.current
    if (!t || !b) return
    for (let i = 0; i < STEPS; i++) {
      const [hx, hz] = at[i]
      dummy.position.set(hx, 0, hz)
      dummy.rotation.set(0, 0, 0)
      dummy.scale.set(r - 1.5, HEX_H, r - 1.5)
      dummy.updateMatrix()
      b.setMatrixAt(i, dummy.matrix)
      b.setColorAt(i, new Color(i === STEPS - 1 ? '#b5463a' : i < step ? '#6e6259' : PAL.maple))
      dummy.position.set(hx, HEX_H + 0.05, hz)
      dummy.scale.set(r - 4, 1, r - 4)
      dummy.updateMatrix()
      t.setMatrixAt(i, dummy.matrix)
      // (crossed: grey and dark, so the way still to go stands out)
      t.setColorAt(i, new Color(i < step && i !== STEPS - 1 ? '#5d6164' : '#ffffff'))
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
  }, [at, r, step])
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

  /** a point along the hexes, for a step that may be part-way */
  const along = (s: number) => {
    const i = Math.max(0, Math.min(STEPS - 2, Math.floor(s)))
    const f = Math.max(0, Math.min(1, s - i))
    const [ax, az] = at[i]
    const [bx, bz] = at[i + 1]
    return { x: ax + (bx - ax) * f, z: az + (bz - az) * f, heading: Math.atan2(-(bz - az), bx - ax) }
  }
  // the ship glides on a hex at a time (and, once they've landed, sails back out quickly), rocking as it goes
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
    o.position.set(p.x, HEX_H + 0.4 + (moving ? Math.sin(t * 6) * 0.6 : 0), p.z)
    o.rotation.set(moving ? Math.sin(t * 5) * 0.06 : 0, p.heading, 0, 'YXZ')
    o.scale.setScalar(k)
  })

  const [lx, lz] = at[STEPS - 1]
  return (
    <group>
      <instancedMesh ref={bodies} args={[hexBody(), wood(), STEPS]} castShadow receiveShadow />
      <instancedMesh ref={tops} args={[topGeo, topMat, STEPS]} receiveShadow />
      {/* the town at the landing, along its far edge (what's at stake is painted in front of it) */}
      <group position={[lx, HEX_H, lz - r * 0.62]} scale={k}>
        <mesh geometry={settlementGeo()} material={wood('#efe6d4')} position={[-9, 0, 0]} scale={0.42} castShadow />
        <mesh geometry={cityGeo()} material={wood('#efe6d4')} position={[2, 0, -1]} scale={0.34} castShadow />
        <mesh geometry={towerGeo()} material={mat('#b8a88c')} position={[11, 0, 1]} scale={0.55} castShadow />
      </group>
      {/* the longship */}
      <group ref={ship}>
        <mesh geometry={hullGeo()} material={wood('#4a3527')} castShadow />
        <mesh geometry={sailGeo()} material={mat('#ffffff', { map: sailStripes(), side: 2 })} castShadow />
        <instancedMesh ref={shields} args={[shieldGeo(), wood(), 12]} castShadow />
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
    if (me >= 0 && mineShown)
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
  }, [x.levels, me, layout, K.tracks, view.players, mineShown])

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
