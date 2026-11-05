/**
 * The playing pieces. A new piece drops in over a fifth of a second, so you see what just changed; then it is
 * still and costs nothing (the scene only redraws when something moves). Ghosts are the same piece, see-through.
 */
import { useFrame, useThree } from '@react-three/fiber'
import { useMemo, useRef, type ReactNode } from 'react'
import { MeshBasicMaterial, RingGeometry, type Group, type Mesh } from 'three'
import type { PlayerColor } from '../../../shared/rules.ts'
import { PAL, PLAYER } from '../lib/palette.ts'
import { cityGeo, roadGeo, robberGeo, settlementGeo } from './geometry.ts'
import { TILE, TOKEN } from './spec.ts'
import { wood } from './wood.ts'

const DROP = 0.2 // seconds
const FROM = 30 // mm

/** redraw, and redraw the shadows too (they only update when asked) */
export function useRedraw() {
  const { gl, invalidate } = useThree()
  return () => {
    gl.shadowMap.needsUpdate = true
    invalidate()
  }
}

/** pieces already on the board when it first shows are simply there; later ones drop in */
let shownAt = 0
export const boardShown = () => (shownAt = performance.now())

/** a new piece drops into place (after `delay` s: one of yours waits for the one flying over from your supply) */
function Drop({ children, ghost, delay = 0 }: { children: ReactNode; ghost?: boolean; delay?: number }) {
  const g = useRef<Group>(null)
  const settled = ghost || performance.now() - shownAt < 400
  const t0 = useRef<number | null>(settled ? -1 : null)
  const redraw = useRedraw()
  useFrame(({ clock }) => {
    const o = g.current
    if (!o || t0.current === -1) return
    if (t0.current === null) t0.current = clock.elapsedTime + delay
    const t = Math.max(0, Math.min(1, (clock.elapsedTime - t0.current) / DROP))
    o.visible = clock.elapsedTime >= t0.current
    o.position.y = delay ? 0 : FROM * (1 - t) * (1 - t)
    redraw()
    if (t >= 1) t0.current = -1
  })
  return (
    <group ref={g} position={[0, settled || delay ? 0 : FROM, 0]} visible={settled || !delay}>
      {children}
    </group>
  )
}

type PieceProps = { color: PlayerColor; ghost?: boolean; x: number; z: number; delay?: number }
const body = (c: PlayerColor, ghost?: boolean) => wood(PLAYER[c].body, ghost ? 0.7 : 1)

export function Settlement({ color, ghost, x, z, delay }: PieceProps) {
  return (
    <group position={[x, TILE.h, z]}>
      <Drop ghost={ghost} delay={delay}>
        <mesh geometry={settlementGeo()} material={body(color, ghost)} castShadow={!ghost} />
      </Drop>
    </group>
  )
}

export function City({ color, ghost, x, z, delay }: PieceProps) {
  return (
    <group position={[x, TILE.h, z]}>
      <Drop ghost={ghost} delay={delay}>
        <mesh geometry={cityGeo()} material={body(color, ghost)} castShadow={!ghost} />
      </Drop>
    </group>
  )
}

export function Road({ color, ghost, x, z, angle, delay }: PieceProps & { angle: number }) {
  return (
    <group position={[x, TILE.h, z]} rotation={[0, -angle, 0]}>
      <Drop ghost={ghost} delay={delay}>
        <mesh geometry={roadGeo()} material={body(color, ghost)} castShadow={!ghost} />
      </Drop>
    </group>
  )
}

/** the robber slides to its new tile in a quarter second */
export function Robber({ x, z, ghost }: { x: number; z: number; ghost?: boolean }) {
  const g = useRef<Group>(null)
  const from = useRef<[number, number] | null>(null)
  const t0 = useRef<number | null>(null)
  const target = useRef<[number, number]>([x, z])
  const redraw = useRedraw()
  if (target.current[0] !== x || target.current[1] !== z) {
    const o = g.current
    from.current = o ? [o.position.x, o.position.z] : [x, z]
    target.current = [x, z]
    t0.current = null
  }
  useFrame(({ clock }) => {
    const o = g.current
    if (!o || !from.current) return
    if (t0.current === null) t0.current = clock.elapsedTime
    const t = Math.min(1, (clock.elapsedTime - t0.current) / 0.25)
    const e = t * (2 - t)
    o.position.x = from.current[0] + (x - from.current[0]) * e
    o.position.z = from.current[1] + (z - from.current[1]) * e
    o.position.y = TILE.h + TOKEN.h + Math.sin(t * Math.PI) * 20
    redraw()
    if (t >= 1) from.current = null
  })
  return (
    <group ref={g} position={[x, TILE.h + TOKEN.h, z]}>
      <mesh geometry={robberGeo()} material={wood(PAL.robber, ghost ? 0.55 : 1)} castShadow={!ghost} />
    </group>
  )
}

const RING = new RingGeometry(0.72, 1, 40).rotateX(-Math.PI / 2)

/** a ring that swells and fades under something just built, so you see what changed (1.6 s, then gone) */
export function Pulse({ x, z, color, size = 16, onDone }: { x: number; z: number; color: string; size?: number; onDone: () => void }) {
  const m = useRef<Mesh>(null)
  const t0 = useRef<number | null>(null)
  const material = useMemo(() => new MeshBasicMaterial({ color, transparent: true, depthWrite: false }), [color])
  const redraw = useRedraw()
  useFrame(({ clock }) => {
    const o = m.current
    if (!o) return
    if (t0.current === null) t0.current = clock.elapsedTime
    const t = (clock.elapsedTime - t0.current) / 1.6
    if (t >= 1) {
      onDone()
      redraw()
      return
    }
    const k = 1 - Math.pow(1 - (t * 3) % 1, 2) // three swells
    o.scale.setScalar(size * (0.8 + k * 0.9))
    material.opacity = (1 - k) * (1 - t * 0.5)
    redraw()
  })
  return <mesh ref={m} geometry={RING} material={material} position={[x, TILE.h + 0.6, z]} renderOrder={2} />
}
