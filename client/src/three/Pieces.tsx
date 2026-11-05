/**
 * The playing pieces. Each lands softly when it first appears (a short eased drop, so you see what just changed),
 * then is perfectly still. Ghosts are the same piece, see-through, shown where a click would put it.
 */
import { useFrame, type ThreeElements } from '@react-three/fiber'
import { easing } from 'maath'
import { useRef } from 'react'
import type { Group } from 'three'
import type { PlayerColor } from '../../../shared/rules.ts'
import { PAL, PLAYER } from '../lib/palette.ts'
import { mat } from '../lib/toy.ts'
import { cityGeo, roadGeo, robberGeo, settlementGeo } from './geometry.ts'
import { TILE } from './spec.ts'

/** drops in from `from` mm above on mount; `instant` skips it (things already there when you arrive) */
function Landing({ children, instant, from = 45, ...rest }: { children: React.ReactNode; instant?: boolean; from?: number } & ThreeElements['group']) {
  const g = useRef<Group>(null)
  const settled = useRef(!!instant)
  useFrame((_, dt) => {
    const o = g.current
    if (!o || settled.current) return
    easing.damp(o.position, 'y', 0, 0.12, dt)
    if (o.position.y < 0.05) {
      o.position.y = 0
      settled.current = true
    }
  })
  return (
    <group {...rest}>
      <group ref={g} position={[0, instant ? 0 : from, 0]}>
        {children}
      </group>
    </group>
  )
}

type PieceProps = { color: PlayerColor; ghost?: boolean; instant?: boolean; x: number; z: number }

const body = (c: PlayerColor, ghost?: boolean) => [mat(PLAYER[c].body, { opacity: ghost ? 0.72 : 1 }), mat(PLAYER[c].roof, { opacity: ghost ? 0.72 : 1 })]

export function Settlement({ color, ghost, instant, x, z }: PieceProps) {
  return (
    <Landing instant={instant || ghost} position={[x, TILE.h, z]}>
      <mesh geometry={settlementGeo()} material={body(color, ghost)} castShadow={!ghost} receiveShadow />
    </Landing>
  )
}

export function City({ color, ghost, instant, x, z }: PieceProps) {
  return (
    <Landing instant={instant || ghost} position={[x, TILE.h, z]}>
      <mesh geometry={cityGeo()} material={body(color, ghost)} castShadow={!ghost} receiveShadow />
    </Landing>
  )
}

export function Road({ color, ghost, instant, x, z, angle }: PieceProps & { angle: number }) {
  return (
    <Landing instant={instant || ghost} position={[x, TILE.h - 1.5, z]} rotation={[0, -angle, 0]} from={30}>
      <mesh geometry={roadGeo()} material={body(color, ghost)} castShadow={!ghost} receiveShadow />
    </Landing>
  )
}

/** the robber glides from tile to tile in a little hop */
export function Robber({ x, z, ghost }: { x: number; z: number; ghost?: boolean }) {
  const g = useRef<Group>(null)
  const first = useRef(true)
  useFrame((_, dt) => {
    const o = g.current
    if (!o) return
    if (first.current || ghost) {
      o.position.set(x, o.position.y, z)
      first.current = false
    }
    easing.damp(o.position, 'x', x, 0.22, dt)
    easing.damp(o.position, 'z', z, 0.22, dt)
    const far = Math.hypot(o.position.x - x, o.position.z - z)
    easing.damp(o.position, 'y', TILE.h + 4.5 + Math.min(40, far * 0.4), 0.1, dt)
  })
  return (
    <group ref={g} position={[x, TILE.h + 4.5, z]}>
      <mesh geometry={robberGeo()} material={mat(PAL.plum, { opacity: ghost ? 0.5 : 1 })} castShadow={!ghost} />
    </group>
  )
}
