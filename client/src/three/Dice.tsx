/**
 * Two real dice in the tray beside the board. The server decides the roll; the dice are then thrown for real (a
 * physics throw seeded by the roll's number, see diceSim), so everyone at the table sees the same throw land on the
 * same faces. They draw only while they move. Clicking them rolls, when it's yours to roll.
 */
import { QUALITY } from './quality.ts'
import { useFrame, type ThreeEvent } from '@react-three/fiber'
import { useLayoutEffect, useMemo, useRef } from 'react'
import { CanvasTexture, Group, Quaternion, SRGBColorSpace, Vector3, type BufferGeometry } from 'three'
import { mat } from '../lib/toy.ts'
import { PAL } from '../lib/palette.ts'
import { DIE_FACES, dieGeo, feltGeo, trayGeo } from './geometry.ts'
import { useRedraw } from './Pieces.tsx'
import { DICE } from './spec.ts'
import { FPS, prepareThrow, throwDice, type Throw } from './diceSim.ts'
import { useRapier } from './physics.ts'

const NORMALS = [new Vector3(1, 0, 0), new Vector3(-1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, -1, 0), new Vector3(0, 0, 1), new Vector3(0, 0, -1)]
const UP = new Vector3(0, 1, 0)

type DieStyle = 'plain' | 'red' | 'yellow' | 'event'
const STYLE: Record<DieStyle, { body: string; pip: string; one: string }> = {
  plain: { body: '#fbf7ef', pip: '#22170f', one: '#c8453c' },
  red: { body: '#c8453c', pip: '#fff6ea', one: '#fff6ea' },
  yellow: { body: '#f0cf62', pip: '#2a1d13', one: '#2a1d13' },
  event: { body: '#fbf7ef', pip: '#22170f', one: '#22170f' },
}
/** the event die's faces: three ships, then a gate in each track's colour */
const GATE: Record<number, string> = { 4: '#e2b33c', 5: '#3f6fc0', 6: '#4c9a4f' }
const SHIP = 'M2 14h20l-3 5H5z M11 3h1.6v10H11z M12.6 4l6 7h-6z M11 5l-5 7h5z'
const GATE_ICON = 'M5 21V9a7 7 0 0 1 14 0v12h-4v-8a3 3 0 0 0-6 0v8z'

/** all six faces in one picture (three across, two down), so a die is one draw, not six */
const atlases = new Map<DieStyle, CanvasTexture>()
function faceAtlas(style: DieStyle = 'plain') {
  const hit = atlases.get(style)
  if (hit) return hit
  const S = 128
  const c = document.createElement('canvas')
  c.width = S * 3
  c.height = S * 2
  const ctx = c.getContext('2d')!
  const st = STYLE[style]
  ctx.fillStyle = st.body
  ctx.fillRect(0, 0, c.width, c.height)
  const spots: Record<number, [number, number][]> = {
    1: [[0.5, 0.5]],
    2: [[0.28, 0.28], [0.72, 0.72]],
    3: [[0.28, 0.28], [0.5, 0.5], [0.72, 0.72]],
    4: [[0.28, 0.28], [0.72, 0.28], [0.28, 0.72], [0.72, 0.72]],
    5: [[0.28, 0.28], [0.72, 0.28], [0.5, 0.5], [0.28, 0.72], [0.72, 0.72]],
    6: [[0.28, 0.25], [0.72, 0.25], [0.28, 0.5], [0.72, 0.5], [0.28, 0.75], [0.72, 0.75]],
  }
  for (let v = 1; v <= 6; v++) {
    const ox = ((v - 1) % 3) * S
    const oy = Math.floor((v - 1) / 3) * S
    if (style === 'event') {
      ctx.save()
      ctx.translate(ox + S * 0.14, oy + S * 0.14)
      ctx.scale((S * 0.72) / 24, (S * 0.72) / 24)
      ctx.fillStyle = v <= 3 ? '#2a1d13' : GATE[v]
      ctx.fill(new Path2D(v <= 3 ? SHIP : GATE_ICON))
      ctx.restore()
      continue
    }
    ctx.fillStyle = v === 1 ? st.one : st.pip
    for (const [x, y] of spots[v]) {
      ctx.beginPath()
      ctx.arc(ox + x * S, oy + y * S, v === 1 && style === 'plain' ? 15 : 11, 0, Math.PI * 2)
      ctx.fill()
    }
  }
  const t = new CanvasTexture(c)
  t.colorSpace = SRGBColorSpace
  t.anisotropy = QUALITY.aniso
  atlases.set(style, t)
  return t
}

/** the die's shape with each face's picture taken from the atlas, all one group */
let oneDraw: BufferGeometry | null = null
function dieShape() {
  if (oneDraw) return oneDraw
  const g = dieGeo().clone()
  const uv = g.attributes.uv
  for (const group of g.groups) {
    const v = DIE_FACES[group.materialIndex ?? 0]
    const cx = (v - 1) % 3
    const cy = Math.floor((v - 1) / 3)
    for (let i = group.start; i < group.start + group.count; i++) {
      const k = g.index!.getX(i)
      if ((uv as unknown as { done?: Set<number> }).done?.has(k)) continue
      uv.setXY(k, (cx + uv.getX(k)) / 3, 1 - (cy + 1 - uv.getY(k)) / 2)
      ;((uv as unknown as { done?: Set<number> }).done ??= new Set()).add(k)
    }
  }
  g.clearGroups()
  oneDraw = g
  return g
}

/** the turn that puts face `v` on top, then a spin about the vertical */
function restingOn(v: number, yaw: number) {
  const q = new Quaternion().setFromUnitVectors(NORMALS[DIE_FACES.indexOf(v)], UP)
  return new Quaternion().setFromAxisAngle(UP, yaw).multiply(q)
}

const tmpA = new Vector3()
const tmpB = new Vector3()
const tmpQa = new Quaternion()
const tmpQb = new Quaternion()

/** both dice: a real throw (diceSim) played back each time the roll count goes up; still otherwise */
function Pair({ values, styles, roll, onClick, at }: { values: number[]; styles: DieStyle[]; roll: number; onClick?: () => void; at: [number, number] }) {
  const R = useRapier()
  const g = [useRef<Group>(null), useRef<Group>(null), useRef<Group>(null)].slice(0, values.length)
  const materials = useMemo(() => styles.map((st) => mat('#ffffff', { map: faceAtlas(st) })), [styles.join()])
  const redraw = useRedraw()
  const seen = useRef<number | null>(null)
  const play = useRef<{ t: Throw; t0: number } | null>(null)
  const key = `${values.join()}${roll}${at[0]},${at[1]}`

  // a new roll: throw it (a rejoin or a resize just shows how the last one lies)
  useLayoutEffect(() => {
    if (!R) return
    const t = throwDice(R, roll, at, values)
    play.current = { t, t0: seen.current !== null && seen.current !== roll ? performance.now() / 1000 : -1e9 }
    seen.current = roll
    redraw()
    // the next throw, worked out while nobody's waiting for it
    const idle = (window as unknown as { requestIdleCallback?: (f: () => void, o?: { timeout: number }) => number }).requestIdleCallback
    const later = () => prepareThrow(R, roll + 1, at, values.length)
    const id = idle ? idle(later, { timeout: 4000 }) : window.setTimeout(later, 1500)
    return () => {
      const cancel = (window as unknown as { cancelIdleCallback?: (n: number) => void }).cancelIdleCallback
      if (idle && cancel) cancel(id)
      else clearTimeout(id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [R, key])

  useFrame(() => {
    const pl = play.current
    if (!pl) {
      // the engine isn't here yet: the dice lie side by side, the roll on top
      g.forEach((r, i) => {
        r.current?.position.set(at[0] + (i - (values.length - 1) / 2) * 26, DICE.tray.felt + DICE.size / 2, at[1])
        r.current?.quaternion.copy(restingOn(values[i], 0.3 + i * 0.5))
      })
      return
    }
    const { t, t0 } = pl
    const f = Math.min(t.count - 1, Math.max(0, (performance.now() / 1000 - t0) * FPS))
    const i0 = Math.floor(f)
    const i1 = Math.min(t.count - 1, i0 + 1)
    const a = f - i0
    g.forEach((r, i) => {
      const o = r.current
      if (!o) return
      const st = 7 * t.n
      const A = t.frames.subarray(i0 * st + i * 7, i0 * st + i * 7 + 7)
      const B = t.frames.subarray(i1 * st + i * 7, i1 * st + i * 7 + 7)
      o.position.lerpVectors(tmpA.set(A[0], A[1], A[2]), tmpB.set(B[0], B[1], B[2]), a)
      o.quaternion.slerpQuaternions(tmpQa.set(A[3], A[4], A[5], A[6]), tmpQb.set(B[3], B[4], B[5], B[6]), a).multiply(t.fix[i])
    })
    if (f < t.count - 1) redraw()
  })

  return (
    <>
      {g.map((r, i) => (
        <group key={i} ref={r}>
          <mesh
            geometry={dieShape()}
            material={materials[i]}
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
      ))}
    </>
  )
}

/** the dice in their tray, at `at` on the table (the tray's centre) */
const EVENT_VALUE: Record<string, number> = { trade: 4, politics: 5, science: 6 }

/** the dice in their tray: two, or in the expansion a red, a yellow and the event die */
export function Dice({ dice, rolls, onRoll, at = [DICE.tray.x, DICE.tray.z], event }: { dice: [number, number] | null; rolls: number; onRoll?: () => void; at?: [number, number]; event?: string | null }) {
  const [a, b] = dice ?? [6, 6]
  const expansion = event !== undefined
  const values = expansion ? [a, b, event && event !== 'ship' ? EVENT_VALUE[event] : 1 + (rolls % 3)] : [a, b]
  const styles: DieStyle[] = expansion ? ['red', 'yellow', 'event'] : ['plain', 'plain']
  return (
    <group>
      <mesh geometry={trayGeo()} material={[mat(PAL.maple), mat(PAL.mapleDeep)]} position={[at[0], 0, at[1]]} castShadow receiveShadow />
      <mesh geometry={feltGeo()} material={mat(PAL.felt)} position={[at[0], 0, at[1]]} receiveShadow onClick={onRoll} />
      <Pair values={values} styles={styles} roll={rolls} onClick={onRoll} at={at} />
    </group>
  )
}
