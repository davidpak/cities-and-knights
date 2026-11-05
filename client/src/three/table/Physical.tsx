/**
 * The table's loose things on screen: every card in one draw, every piece of a kind in one draw (things.ts keeps the
 * bodies). Pointing:
 *   - a click on a thing is its pile's move (ui/Game.tsx says what), wherever the thing happens to lie
 *   - a drag picks it up: carry it, drop it, toss it into the others; it settles, and goes home if it isn't there
 * Draws only while something moves.
 */
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { Color, InstancedMesh, Matrix4, Plane, Quaternion, Raycaster, Sphere, Vector2, Vector3, type BufferGeometry } from 'three'
import type { PlayerColor } from '../../../../shared/rules.ts'
import { PAL, PLAYER } from '../../lib/palette.ts'
import { CITY_OUTLINE, KNIGHT_PROFILE, ROBBER_PROFILE, SETTLEMENT_OUTLINE, cityGeo, knight1Geo, knight2Geo, knight3Geo, roadGeo, robberGeo, settlementGeo, wallGeo } from '../geometry.ts'
import { useRapier } from '../physics.ts'
import { CITY, ROAD, SETTLEMENT, WALL } from '../spec.ts'
import { wood } from '../wood.ts'
import { cardGeometry, cardMaterial, cardTiles } from './cardMesh.ts'
import { TILE, backOf } from './faces.ts'
import { CARD } from './layout.ts'
import { Table, type PileSpec, type Pose, type Shapes, type StaticPart, type Thing, type ThingKind } from './things.ts'

export type Static = StaticPart

// ---------------------------------------------------------------- the bodies' shapes (from the same outlines as the models)

function prism(outline: [number, number][], depth: number) {
  const pts: number[] = []
  for (const [x, y] of outline) pts.push(x, y, -depth / 2, x, y, depth / 2)
  return new Float32Array(pts)
}
function box(w: number, h: number, d: number, x = 0) {
  return prism(
    [
      [x - w / 2, 0],
      [x + w / 2, 0],
      [x + w / 2, h],
      [x - w / 2, h],
    ],
    d,
  )
}
const SHAPES: Shapes = {
  card: { w: CARD.w, d: CARD.d, t: CARD.t, small: CARD.small },
  hull: {
    settlement: [prism(SETTLEMENT_OUTLINE(), SETTLEMENT.d)],
    // a city isn't convex: its hall and its wing, each a hull
    city: (() => {
      const [x0] = CITY_OUTLINE()[0]
      const x1 = x0 + CITY.hall
      const hall = prism([[x0, 0], [x1, 0], [x1, CITY.wall], [x0 + CITY.hall / 2, CITY.peak], [x0, CITY.wall]], CITY.d)
      return [hall, box(CITY.w - CITY.hall, CITY.wing, CITY.d, x1 + (CITY.w - CITY.hall) / 2)]
    })(),
    // the bar lies along x, its width across z
    road: [box(ROAD.len, ROAD.h, ROAD.w)],
    robber: [turned(ROBBER_PROFILE())],
    knight1: [turned(KNIGHT_PROFILE(1))],
    knight2: [turned(KNIGHT_PROFILE(2))],
    knight3: [turned(KNIGHT_PROFILE(3))],
    // a ring isn't convex: its four sides
    wall: (() => {
      const { w, d, rim, h } = WALL
      return [box(w, h, rim, 0).map((v, i) => (i % 3 === 2 ? v - (d - rim) / 2 : v)), box(w, h, rim, 0).map((v, i) => (i % 3 === 2 ? v + (d - rim) / 2 : v)), box(rim, h, d - 2 * rim, -(w - rim) / 2), box(rim, h, d - 2 * rim, (w - rim) / 2)].map((a) => new Float32Array(a))
    })(),
  },
}
/** a turned profile as a hull: its points round the axis */
function turned(profile: [number, number][]) {
  return new Float32Array(profile.flatMap(([r, y]) => Array.from({ length: 10 }, (_, i) => [r * Math.cos((i / 10) * Math.PI * 2), y, r * Math.sin((i / 10) * Math.PI * 2)]).flat()))
}

// ---------------------------------------------------------------- drawing

const CAP: Record<ThingKind, number> = { card: 512, road: 128, settlement: 48, city: 40, robber: 2, knight1: 24, knight2: 24, knight3: 24, wall: 16 }
const GEO: Record<Exclude<ThingKind, 'card'>, () => BufferGeometry> = { road: roadGeo, settlement: settlementGeo, city: cityGeo, robber: robberGeo, knight1: knight1Geo, knight2: knight2Geo, knight3: knight3Geo, wall: wallGeo }
const KINDS: ThingKind[] = ['card', 'road', 'settlement', 'city', 'robber', 'knight1', 'knight2', 'knight3', 'wall']
const tmpM = new Matrix4()
const tmpS = new Vector3()
const tmpPose: Pose = { p: new Vector3(), q: new Quaternion() }
const colors = new Map<string, Color>()
const colorOf = (look: string) => {
  let c = colors.get(look)
  if (!c) colors.set(look, (c = new Color(look === 'robber' ? PAL.robber : (PLAYER[look as PlayerColor]?.body ?? '#cccccc'))))
  return c
}
/** one sphere round the whole table: pointing tests instances against it, and it never needs working out again */
const TABLE_SPHERE = new Sphere(new Vector3(), 4000)

export function Physical({ specs, statics, onDrop, onHolding }: { specs: PileSpec[]; statics: Record<string, Static[]>; onDrop?: (t: Thing, at: Vector3) => void; onHolding?: (t: Thing | null) => void }) {
  const table = useMemo(() => new Table(SHAPES), [])
  if (location.search.includes('test')) (window as unknown as { __table: Table }).__table = table
  const R = useRapier()
  const { camera, gl, invalidate, size } = useThree()
  const meshes = useRef<Partial<Record<ThingKind, InstancedMesh>>>({})
  const lists = useRef<Record<ThingKind, Thing[]>>({ card: [], road: [], settlement: [], city: [], robber: [], knight1: [], knight2: [], knight3: [], wall: [] })
  const tiles = useMemo(() => cardTiles(CAP.card), [])
  const cardGeo = useMemo(() => {
    const g = cardGeometry()
    g.setAttribute('aTiles', tiles)
    return g
  }, [tiles])
  const kick = () => {
    gl.shadowMap.needsUpdate = true
    invalidate()
  }

  // the world arrives; the fixed things in it follow the layout
  useEffect(() => {
    if (!R) return
    table.attach(R)
    kick()
    return () => table.dispose()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [R])
  // the base first (nothing is made before what it rests on), then the rest, each only when it changes
  const keys = useRef(new Map<string, string>())
  useEffect(() => {
    if (!R) return
    keys.current.clear()
  }, [R])
  useEffect(() => {
    if (!R) return
    const names = ['base', ...Object.keys(statics).filter((k) => k !== 'base')]
    for (const name of names) {
      const key = JSON.stringify(statics[name] ?? [])
      if (keys.current.get(name) === key) continue
      keys.current.set(name, key)
      table.setStatics(name, statics[name] ?? [])
    }
    kick()
  })
  useLayoutEffect(() => {
    table.setPiles(specs, performance.now() / 1000)
    kick()
  })

  // ---- each frame something moves: step, and draw everything where it is (nothing at all when nothing moved)
  const order = useRef<{ t: Thing; y: number }[]>([])
  useFrame((_, dt) => {
    const moving = table.update(performance.now() / 1000, dt)
    if (!moving) return
    const L = lists.current
    for (const k of KINDS) L[k].length = 0
    for (const t of table.things) L[t.kind].push(t)
    // cards top first: on the GPU each card hides the ones under it before they're shaded (a stack of nineteen
    // costs about one card, not nineteen)
    const ord = order.current
    ord.length = 0
    for (const t of L.card) {
      table.drawn(t, tmpPose)
      ord.push({ t, y: tmpPose.p.y })
    }
    ord.sort((a, b) => b.y - a.y)
    ord.forEach((o, i) => (L.card[i] = o.t))
    for (const k of KINDS) {
      const m = meshes.current[k]
      if (!m) continue
      const list = L[k]
      let tilesChanged = false
      list.forEach((t, i) => {
        table.drawn(t, tmpPose)
        if (k === 'card') {
          const s = t.small ? CARD.small : 1
          tmpS.set(CARD.w * s, CARD.t, CARD.d * s)
          const a = TILE[t.look] ?? 5
          const b = backOf(t.family, t.look)
          if (tiles.getX(i) !== a || tiles.getY(i) !== b) {
            tiles.setXY(i, a, b)
            tilesChanged = true
          }
        } else {
          tmpS.set(1, 1, 1)
          m.setColorAt(i, colorOf(t.look))
        }
        m.setMatrixAt(i, tmpM.compose(tmpPose.p, tmpPose.q, tmpS))
      })
      if (m.count !== list.length) tilesChanged = true
      m.count = list.length
      m.visible = list.length > 0
      // send only the instances in use
      m.instanceMatrix.clearUpdateRanges()
      m.instanceMatrix.addUpdateRange(0, list.length * 16)
      m.instanceMatrix.needsUpdate = true
      if (m.instanceColor) {
        m.instanceColor.clearUpdateRanges()
        m.instanceColor.addUpdateRange(0, list.length * 3)
        m.instanceColor.needsUpdate = true
      }
      if (k === 'card' && tilesChanged) {
        tiles.clearUpdateRanges()
        tiles.addUpdateRange(0, list.length * 2)
        tiles.needsUpdate = true
      }
    }
    kick()
  })

  // ---- pointing: hover, click, carry
  const down = useRef<{ thing: Thing; x: number; y: number; held: boolean } | null>(null)
  const ray = useMemo(() => new Raycaster(), [])
  const plane = useMemo(() => new Plane(new Vector3(0, 1, 0), 0), [])
  const hit = useMemo(() => new Vector3(), [])
  const ndc = useMemo(() => new Vector2(), [])
  const pointAt = (cx: number, cy: number, y: number) => {
    // (the canvas's place on the page as react-three-fiber already knows it: asking the page would force a layout)
    const r = size
    ray.setFromCamera(ndc.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1), camera)
    plane.constant = -y
    return ray.ray.intersectPlane(plane, hit)
  }
  const thingOf = (k: ThingKind, e: ThreeEvent<PointerEvent>) => (e.instanceId !== undefined ? lists.current[k][e.instanceId] : undefined)
  const specOf = (t: Thing | undefined) => (t?.pile ? table.specs.get(t.pile) : undefined)
  const grabbable = (t: Thing) => !!R && specOf(t)?.grab !== false && !t.fly?.vanish

  useEffect(() => {
    const move = (e: PointerEvent) => {
      const d = down.current
      if (!d) return
      if (!d.held && Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6 && grabbable(d.thing)) {
        const t = table.grab(d.thing)
        d.held = !!t
        if (t) {
          d.thing = t
          onHolding?.(t)
          document.body.style.cursor = 'grabbing'
        }
      }
      if (d.held) {
        const lift = d.thing.kind === 'card' ? 34 : 46
        const p = pointAt(e.clientX, e.clientY, lift)
        if (p) table.carry(p.x, lift, p.z)
        kick()
      }
    }
    const up = (e: PointerEvent) => {
      const d = down.current
      down.current = null
      if (!d) return
      if (d.held) {
        const t = table.release()
        document.body.style.cursor = ''
        onHolding?.(null)
        const p = pointAt(e.clientX, e.clientY, 0)
        if (t && p) onDrop?.(t, p.clone())
        kick()
        return
      }
      const spec = specOf(d.thing)
      if (spec?.enabled && spec.onClick) spec.onClick()
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
    }
  })

  const handlers = (k: ThingKind) => ({
    onPointerMove: (e: ThreeEvent<PointerEvent>) => {
      if (down.current) return
      const t = thingOf(k, e)
      const spec = specOf(t)
      if (!t || (!spec?.enabled && !grabbable(t))) return
      e.stopPropagation()
      document.body.style.cursor = spec?.enabled ? 'pointer' : 'grab'
      const id = spec?.enabled ? spec.id : null
      if (table.hover !== id) {
        table.hover = id
        table.dirty = true
        kick()
      }
    },
    onPointerOut: () => {
      if (down.current) return
      document.body.style.cursor = ''
      if (table.hover !== null) {
        table.hover = null
        table.dirty = true
        kick()
      }
    },
    onPointerDown: (e: ThreeEvent<PointerEvent>) => {
      const t = thingOf(k, e)
      const spec = specOf(t)
      if (!t || (!spec?.enabled && !grabbable(t))) return
      e.stopPropagation()
      down.current = { thing: t, x: e.nativeEvent.clientX, y: e.nativeEvent.clientY, held: false }
    },
  })

  return (
    <>
      <instancedMesh
        ref={(m) => {
          if (m && meshes.current.card !== m) (meshes.current.card = m), (m.boundingSphere = TABLE_SPHERE), (m.count = 0)
        }}
        args={[cardGeo, cardMaterial(), CAP.card]}
        castShadow
        receiveShadow
        frustumCulled={false}
        {...handlers('card')}
      />
      {(['road', 'settlement', 'city', 'knight1', 'knight2', 'knight3', 'wall'] as const).map((k) => (
        <instancedMesh
          key={k}
          ref={(m) => {
            if (m && meshes.current[k] !== m) (meshes.current[k] = m), (m.boundingSphere = TABLE_SPHERE), (m.count = 0)
          }}
          args={[GEO[k](), wood(), CAP[k]]}
          castShadow
          receiveShadow
          frustumCulled={false}
          {...handlers(k)}
        />
      ))}
    </>
  )
}
