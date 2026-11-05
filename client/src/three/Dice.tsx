/**
 * Two dice beside the board. The server decides the roll; the dice then tumble to it on a fixed path seeded by the
 * roll's number, so everyone at the table sees the same throw and the same faces. Clicking them rolls, when it's
 * yours to roll. At rest they are still.
 */
import { useFrame, type ThreeEvent } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import { Group, Quaternion, Vector3 } from 'three'
import { mat } from '../lib/toy.ts'
import { DIE_FACES, dieGeo } from './geometry.ts'
import { DICE_AT, DIE } from './spec.ts'
import { dieTexture } from './textures.ts'

const NORMALS = [new Vector3(1, 0, 0), new Vector3(-1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, -1, 0), new Vector3(0, 0, 1), new Vector3(0, 0, -1)]
const UP = new Vector3(0, 1, 0)
const THROW = 1.15 // seconds

/** the turn that puts face `v` on top, then a yaw */
function restingOn(v: number, yaw: number) {
  const q = new Quaternion().setFromUnitVectors(NORMALS[DIE_FACES.indexOf(v)], UP)
  return new Quaternion().setFromAxisAngle(UP, yaw).multiply(q)
}

function seeded(n: number) {
  let t = n * 2654435761
  return () => {
    t = (t + 0x6d2b79f5) | 0
    let x = Math.imul(t ^ (t >>> 15), t | 1)
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61)
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296
  }
}

function Die({ value, roll, index, onClick }: { value: number; roll: number; index: number; onClick?: () => void }) {
  const g = useRef<Group>(null)
  const materials = useMemo(() => DIE_FACES.map((v) => mat('#ffffff', { map: dieTexture(v) })), [])
  const shownRoll = useRef(roll)
  const start = useRef<number | null>(null)

  const plan = useMemo(() => {
    const rnd = seeded(roll * 2 + index + 1)
    const rest = new Vector3(DICE_AT.x + (index - 0.5) * DICE_AT.apart + (rnd() - 0.5) * 8, DIE.size / 2, DICE_AT.z + (rnd() - 0.5) * 10)
    const from = new Vector3(rest.x - 70 - rnd() * 30, 70, rest.z - 50 - rnd() * 30)
    const axis = new Vector3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).normalize()
    const spin = Math.PI * (5 + Math.floor(rnd() * 3) * 2)
    const final = restingOn(value, rnd() * Math.PI * 2)
    return { rest, from, axis, spin, final }
  }, [roll, index, value])

  useFrame(({ clock }) => {
    const o = g.current
    if (!o) return
    if (shownRoll.current !== roll) {
      shownRoll.current = roll
      start.current = clock.elapsedTime
    }
    const { rest, from, axis, spin, final } = plan
    if (start.current === null) {
      o.position.copy(rest)
      o.quaternion.copy(final)
      return
    }
    const t = Math.min(1, (clock.elapsedTime - start.current) / THROW)
    const e = 1 - Math.pow(1 - t, 3)
    o.position.lerpVectors(from, rest, e)
    // a hop that dies away: an arc, then two little bounces
    const hop = t < 0.55 ? Math.sin((t / 0.55) * Math.PI) * 26 : t < 0.8 ? Math.sin(((t - 0.55) / 0.25) * Math.PI) * 7 : Math.sin(((t - 0.8) / 0.2) * Math.PI) * 2
    o.position.y = rest.y + Math.max(0, hop) + (1 - e) * (from.y - rest.y) * 0.3
    o.quaternion.copy(final).multiply(new Quaternion().setFromAxisAngle(axis, (1 - e) * spin))
    if (t >= 1) start.current = null
  })

  return (
    <group ref={g}>
      <mesh
        geometry={dieGeo()}
        material={materials}
        castShadow
        receiveShadow
        onClick={(e: ThreeEvent<MouseEvent>) => {
          if (!onClick || e.delta > 6) return
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
  const [a, b] = dice ?? [6, 5]
  return (
    <group>
      <Die value={a} roll={rolls} index={0} onClick={onRoll} />
      <Die value={b} roll={rolls} index={1} onClick={onRoll} />
    </group>
  )
}

