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

/** all six faces in one picture (three across, two down), so a die is one draw, not six */
let atlas: CanvasTexture | null = null
function faceAtlas() {
  if (atlas) return atlas
  const S = 128
  const c = document.createElement('canvas')
  c.width = S * 3
  c.height = S * 2
  const ctx = c.getContext('2d')!
  ctx.fillStyle = '#fbf7ef'
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
    ctx.fillStyle = v === 1 ? '#c8453c' : '#22170f'
    for (const [x, y] of spots[v]) {
      ctx.beginPath()
      ctx.arc(ox + x * S, oy + y * S, v === 1 ? 15 : 11, 0, Math.PI * 2)
      ctx.fill()
    }
  }
  atlas = new CanvasTexture(c)
  atlas.colorSpace = SRGBColorSpace
  atlas.anisotropy = QUALITY.aniso
  return atlas
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
function Pair({ values, roll, onClick, at }: { values: [number, number]; roll: number; onClick?: () => void; at: [number, number] }) {
  const R = useRapier()
  const g = [useRef<Group>(null), useRef<Group>(null)]
  const material = useMemo(() => mat('#ffffff', { map: faceAtlas() }), [])
  const redraw = useRedraw()
  const seen = useRef<number | null>(null)
  const play = useRef<{ t: Throw; t0: number } | null>(null)
  const key = `${values[0]}${values[1]}${roll}${at[0]},${at[1]}`

  // a new roll: throw it (a rejoin or a resize just shows how the last one lies)
  useLayoutEffect(() => {
    if (!R) return
    const t = throwDice(R, roll, at, values)
    play.current = { t, t0: seen.current !== null && seen.current !== roll ? performance.now() / 1000 : -1e9 }
    seen.current = roll
    redraw()
    // the next throw, worked out while nobody's waiting for it
    const idle = (window as unknown as { requestIdleCallback?: (f: () => void, o?: { timeout: number }) => number }).requestIdleCallback
    const later = () => prepareThrow(R, roll + 1, at)
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
        r.current?.position.set(at[0] + (i - 0.5) * 30, DICE.tray.felt + DICE.size / 2, at[1])
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
      const A = t.frames.subarray(i0 * 14 + i * 7, i0 * 14 + i * 7 + 7)
      const B = t.frames.subarray(i1 * 14 + i * 7, i1 * 14 + i * 7 + 7)
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
            material={material}
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
export function Dice({ dice, rolls, onRoll, at = [DICE.tray.x, DICE.tray.z] }: { dice: [number, number] | null; rolls: number; onRoll?: () => void; at?: [number, number] }) {
  const [a, b] = dice ?? [6, 6]
  return (
    <group>
      <mesh geometry={trayGeo()} material={[mat(PAL.maple), mat(PAL.mapleDeep)]} position={[at[0], 0, at[1]]} castShadow receiveShadow />
      <mesh geometry={feltGeo()} material={mat(PAL.felt)} position={[at[0], 0, at[1]]} receiveShadow onClick={onRoll} />
      <Pair values={[a, b]} roll={rolls} onClick={onRoll} at={at} />
    </group>
  )
}
