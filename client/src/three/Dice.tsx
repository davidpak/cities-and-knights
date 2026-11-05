/**
 * Two real dice in the tray beside the board. The server decides the roll; the dice then tumble into the tray along a
 * path seeded by the roll's number, so everyone at the table sees the same throw land on the same faces. They draw
 * only while they move. Clicking them rolls, when it's yours to roll.
 */
import { useFrame, type ThreeEvent } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import { CanvasTexture, Group, Quaternion, SRGBColorSpace, Vector3 } from 'three'
import { mat } from '../lib/toy.ts'
import { DIE_FACES, dieGeo } from './geometry.ts'
import { useRedraw } from './Pieces.tsx'
import { DICE } from './spec.ts'

const NORMALS = [new Vector3(1, 0, 0), new Vector3(-1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, -1, 0), new Vector3(0, 0, 1), new Vector3(0, 0, -1)]
const UP = new Vector3(0, 1, 0)

const faces = new Map<number, CanvasTexture>()
function face(v: number) {
  const hit = faces.get(v)
  if (hit) return hit
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const ctx = c.getContext('2d')!
  ctx.fillStyle = '#fbf7ef'
  ctx.fillRect(0, 0, 128, 128)
  ctx.fillStyle = v === 1 ? '#c8453c' : '#22170f'
  const spots: Record<number, [number, number][]> = {
    1: [[0.5, 0.5]],
    2: [[0.28, 0.28], [0.72, 0.72]],
    3: [[0.28, 0.28], [0.5, 0.5], [0.72, 0.72]],
    4: [[0.28, 0.28], [0.72, 0.28], [0.28, 0.72], [0.72, 0.72]],
    5: [[0.28, 0.28], [0.72, 0.28], [0.5, 0.5], [0.28, 0.72], [0.72, 0.72]],
    6: [[0.28, 0.25], [0.72, 0.25], [0.28, 0.5], [0.72, 0.5], [0.28, 0.75], [0.72, 0.75]],
  }
  for (const [x, y] of spots[v]) {
    ctx.beginPath()
    ctx.arc(x * 128, y * 128, v === 1 ? 15 : 11, 0, Math.PI * 2)
    ctx.fill()
  }
  const t = new CanvasTexture(c)
  t.colorSpace = SRGBColorSpace
  faces.set(v, t)
  return t
}

/** the turn that puts face `v` on top, then a spin about the vertical */
function restingOn(v: number, yaw: number) {
  const q = new Quaternion().setFromUnitVectors(NORMALS[DIE_FACES.indexOf(v)], UP)
  return new Quaternion().setFromAxisAngle(UP, yaw).multiply(q)
}

function seeded(n: number) {
  let t = (n * 2654435761) | 0
  return () => {
    t = (t + 0x6d2b79f5) | 0
    let x = Math.imul(t ^ (t >>> 15), t | 1)
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61)
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296
  }
}

function Die({ value, roll, index, onClick }: { value: number; roll: number; index: number; onClick?: () => void }) {
  const g = useRef<Group>(null)
  const materials = useMemo(() => DIE_FACES.map((v) => mat('#ffffff', { map: face(v) })), [])
  const shown = useRef(roll)
  const t0 = useRef<number | null>(null)
  const redraw = useRedraw()
  const T = DICE.tray

  const plan = useMemo(() => {
    const rnd = seeded(roll * 2 + index + 1)
    const rest = new Vector3(T.x + (index - 0.5) * 30 + (rnd() - 0.5) * 8, T.felt + DICE.size / 2, T.z + (rnd() - 0.5) * 12)
    const from = new Vector3(T.x - T.w / 2 - 30 - rnd() * 20, 70 + rnd() * 20, T.z - T.d / 2 - 30)
    const axis = new Vector3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).normalize()
    const spin = Math.PI * (4 + 2 * Math.floor(rnd() * 2))
    return { rest, from, axis, spin, final: restingOn(value, rnd() * Math.PI * 2) }
  }, [roll, index, value, T])

  useFrame(({ clock }) => {
    const o = g.current
    if (!o) return
    if (shown.current !== roll) {
      shown.current = roll
      t0.current = clock.elapsedTime
    }
    const { rest, from, axis, spin, final } = plan
    if (t0.current === null) {
      o.position.copy(rest)
      o.quaternion.copy(final)
      return
    }
    const t = Math.min(1, (clock.elapsedTime - t0.current) / DICE.throw)
    const e = 1 - Math.pow(1 - t, 3)
    o.position.lerpVectors(from, rest, e)
    // a drop into the tray, then two small bounces
    const fall = (1 - Math.min(1, t / 0.45)) ** 2 * (from.y - rest.y)
    const bounce = t < 0.45 ? 0 : t < 0.75 ? Math.sin(((t - 0.45) / 0.3) * Math.PI) * 9 : Math.sin(((t - 0.75) / 0.25) * Math.PI) * 3
    o.position.y = rest.y + fall + bounce
    o.quaternion.copy(final).multiply(new Quaternion().setFromAxisAngle(axis, (1 - e) * spin))
    redraw()
    if (t >= 1) t0.current = null
  })

  return (
    <group ref={g}>
      <mesh
        geometry={dieGeo()}
        material={materials}
        castShadow
        onClick={(e: ThreeEvent<MouseEvent>) => {
          if (!onClick) return
          e.stopPropagation()
          onClick()
        }}
        onPointerOver={() => onClick && (document.body.style.cursor = 'pointer')}
        onPointerOut={() => (document.body.style.cursor = '')}
      />
    </group>
  )
}

export function Dice({ dice, rolls, onRoll }: { dice: [number, number] | null; rolls: number; onRoll?: () => void }) {
  const [a, b] = dice ?? [6, 6]
  return (
    <group>
      <Die value={a} roll={rolls} index={0} onClick={onRoll} />
      <Die value={b} roll={rolls} index={1} onClick={onRoll} />
    </group>
  )
}
