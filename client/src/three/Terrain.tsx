/**
 * What stands on each tile, so a tile reads at a glance: pines for forest, sheep for pasture, wheat for fields,
 * brick stacks for hills, peaks for mountains, dunes for desert. Laid out from a seed per tile (stable between
 * loads), in the ring between the token and the pieces (spec DIORAMA). Trees and wheat sway a few degrees, slowly.
 */
import { useFrame } from '@react-three/fiber'
import { memo, useMemo, useRef } from 'react'
import { BoxGeometry, ConeGeometry, CylinderGeometry, Group, SphereGeometry } from 'three'
import type { Terrain as T } from '../../../shared/rules.ts'
import { TERRAIN } from '../lib/palette.ts'
import { mat } from '../lib/toy.ts'
import { DIORAMA } from './spec.ts'

const G = {
  cone: new ConeGeometry(1, 1, 9, 1),
  peak: new ConeGeometry(1, 1, 7, 1),
  cyl: new CylinderGeometry(1, 1, 1, 10),
  ball: new SphereGeometry(1, 16, 12),
  brick: new BoxGeometry(1, 1, 1),
}
// unit cones and cylinders stand on y 0
G.cone.translate(0, 0.5, 0)
G.peak.translate(0, 0.5, 0)
G.cyl.translate(0, 0.5, 0)

function seeded(seed: number) {
  let t = seed * 7919 + 13
  return () => {
    t = (t + 0x6d2b79f5) | 0
    let x = Math.imul(t ^ (t >>> 15), t | 1)
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61)
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296
  }
}

/** n spots in the ring, spread round it, each nudged by the seed */
function ring(n: number, rnd: () => number, rIn = DIORAMA.clearIn + 4, rOut = DIORAMA.clearOut - 6) {
  const start = rnd() * Math.PI * 2
  return Array.from({ length: n }, (_, i) => {
    const a = start + (i / n) * Math.PI * 2 + (rnd() - 0.5) * 0.5
    const r = rIn + rnd() * (rOut - rIn)
    return { x: Math.cos(a) * r, z: Math.sin(a) * r, a, s: 0.85 + rnd() * 0.3, phase: rnd() * 6.28 }
  })
}

function Sway({ children, phase, amount = 0.035, x, z }: { children: React.ReactNode; phase: number; amount?: number; x: number; z: number }) {
  const g = useRef<Group>(null)
  useFrame(({ clock }) => {
    if (!g.current) return
    const t = clock.elapsedTime
    g.current.rotation.z = Math.sin(t * 0.8 + phase) * amount
    g.current.rotation.x = Math.sin(t * 0.6 + phase * 1.3) * amount * 0.6
  })
  return (
    <group ref={g} position={[x, 0, z]}>
      {children}
    </group>
  )
}

function Forest({ seed }: { seed: number }) {
  const c = TERRAIN.forest
  const spots = useMemo(() => ring(7, seeded(seed)), [seed])
  return (
    <>
      {spots.map((p, i) => (
        <Sway key={i} phase={p.phase} x={p.x} z={p.z}>
          <group scale={p.s}>
            <mesh geometry={G.cyl} material={mat(c.c)} scale={[2, 6, 2]} castShadow />
            <mesh geometry={G.cone} material={mat(i % 2 ? c.a : c.b)} position={[0, 4.5, 0]} scale={[9, 13, 9]} castShadow receiveShadow />
            <mesh geometry={G.cone} material={mat(i % 2 ? c.a : c.b)} position={[0, 11, 0]} scale={[6.6, 11, 6.6]} castShadow receiveShadow />
          </group>
        </Sway>
      ))}
    </>
  )
}

function Sheep({ x, z, a, s, phase }: { x: number; z: number; a: number; s: number; phase: number }) {
  const c = TERRAIN.pasture
  const head = useRef<Group>(null)
  useFrame(({ clock }) => {
    if (head.current) head.current.rotation.x = 0.25 + Math.max(0, Math.sin(clock.elapsedTime * 0.35 + phase)) * 0.35
  })
  return (
    <group position={[x, 0, z]} rotation={[0, a, 0]} scale={s}>
      {[[-3, -2], [-3, 2], [3, -2], [3, 2]].map(([lx, lz], i) => (
        <mesh key={i} geometry={G.cyl} material={mat(c.b)} position={[lx, 0, lz]} scale={[1.1, 4.5, 1.1]} castShadow />
      ))}
      <mesh geometry={G.ball} material={mat(c.a)} position={[0, 7.5, 0]} scale={[7.2, 5, 5.2]} castShadow receiveShadow />
      <group ref={head} position={[6.2, 9, 0]}>
        <mesh geometry={G.ball} material={mat(c.b)} position={[1.8, -0.6, 0]} scale={[3.2, 2.5, 2.3]} castShadow />
      </group>
    </group>
  )
}

function Pasture({ seed }: { seed: number }) {
  const c = TERRAIN.pasture
  const rnd = useMemo(() => seeded(seed), [seed])
  const sheep = useMemo(() => ring(3, rnd), [rnd])
  const tufts = useMemo(() => ring(6, rnd), [rnd])
  return (
    <>
      {sheep.map((p, i) => (
        <Sheep key={i} {...p} a={p.a + Math.PI / 2 + (p.phase - 3) * 0.3} />
      ))}
      {tufts.map((p, i) => (
        <group key={i} position={[p.x, 0, p.z]} scale={p.s}>
          {[[-1.6, 0], [1.4, 0.6], [0, -1.5]].map(([dx, dz], j) => (
            <mesh key={j} geometry={G.cone} material={mat(c.c)} position={[dx, 0, dz]} scale={[1.6, 5 + j, 1.6]} castShadow />
          ))}
        </group>
      ))}
    </>
  )
}

function Fields({ seed }: { seed: number }) {
  const c = TERRAIN.fields
  const rnd = useMemo(() => seeded(seed), [seed])
  const sheaves = useMemo(() => ring(12, rnd, DIORAMA.clearIn + 3, DIORAMA.clearOut - 3), [rnd])
  return (
    <>
      {sheaves.map((p, i) => (
        <Sway key={i} phase={p.phase} amount={0.05} x={p.x} z={p.z}>
          <group scale={p.s}>
            <mesh geometry={G.cyl} material={mat(i % 2 ? c.a : c.b)} scale={[2.6, 9, 2.6]} castShadow receiveShadow />
            <mesh geometry={G.cyl} material={mat(c.c)} position={[0, 4, 0]} scale={[2.75, 1.2, 2.75]} />
            <mesh geometry={G.cone} material={mat(i % 2 ? c.a : c.b)} position={[0, 9, 0]} scale={[3.4, 6, 3.4]} castShadow />
          </group>
        </Sway>
      ))}
    </>
  )
}

function Hills({ seed }: { seed: number }) {
  const c = TERRAIN.hills
  const rnd = useMemo(() => seeded(seed), [seed])
  const mounds = useMemo(() => ring(3, rnd), [rnd])
  const stacks = useMemo(() => ring(2, rnd), [rnd])
  return (
    <>
      {mounds.map((p, i) => (
        <mesh key={i} geometry={G.ball} material={mat(c.b)} position={[p.x, 0, p.z]} scale={[11 * p.s, 7 * p.s, 9 * p.s]} castShadow receiveShadow />
      ))}
      {stacks.map((p, i) => (
        <group key={i} position={[(p.x + mounds[i].x) / 2, 0, (p.z + mounds[i].z) / 2]} rotation={[0, p.a, 0]}>
          {[[-3.3, 0], [3.3, 0], [0, 1]].map(([bx, row], j) => (
            <mesh key={j} geometry={G.brick} material={mat(j === 2 ? c.c : c.a)} position={[bx, 1.8 + row * 3.6, 0]} scale={[6.2, 3.4, 3.6]} castShadow receiveShadow />
          ))}
        </group>
      ))}
    </>
  )
}

function Mountains({ seed }: { seed: number }) {
  const c = TERRAIN.mountains
  const rnd = useMemo(() => seeded(seed), [seed])
  const peaks = useMemo(() => ring(3, rnd, DIORAMA.clearIn + 7, DIORAMA.clearOut - 9), [rnd])
  const rocks = useMemo(() => ring(4, rnd), [rnd])
  const sizes = [
    [13, 28],
    [10.5, 21],
    [9, 17],
  ]
  return (
    <>
      {peaks.map((p, i) => {
        const [r, h] = sizes[i]
        return (
          <group key={i} position={[p.x, 0, p.z]} rotation={[0, p.a, 0]}>
            <mesh geometry={G.peak} material={mat(i % 2 ? c.b : c.a)} scale={[r, h, r]} castShadow receiveShadow />
            {/* snow: the same cone's top third, a hair larger so it sits just outside the rock */}
            <mesh geometry={G.peak} material={mat(c.c)} position={[0, h * 0.64, 0]} scale={[r * 0.38, h * 0.37, r * 0.38]} castShadow />
          </group>
        )
      })}
      {rocks.map((p, i) => (
        <mesh key={i} geometry={G.ball} material={mat(c.a)} position={[p.x, 0, p.z]} scale={[3.2 * p.s, 2.4 * p.s, 2.8 * p.s]} castShadow receiveShadow />
      ))}
    </>
  )
}

function Desert({ seed }: { seed: number }) {
  const c = TERRAIN.desert
  const rnd = useMemo(() => seeded(seed), [seed])
  const dunes = useMemo(() => ring(3, rnd), [rnd])
  const cactus = useMemo(() => ring(1, rnd)[0], [rnd])
  return (
    <>
      {dunes.map((p, i) => (
        <mesh key={i} geometry={G.ball} material={mat(c.a)} position={[p.x, 0, p.z]} rotation={[0, p.a, 0]} scale={[13 * p.s, 4.5 * p.s, 7 * p.s]} receiveShadow castShadow />
      ))}
      <group position={[(cactus.x + dunes[0].x) / 2, 0, (cactus.z + dunes[0].z) / 2]}>
        <mesh geometry={G.cyl} material={mat(c.b)} scale={[2.4, 14, 2.4]} castShadow />
        <mesh geometry={G.ball} material={mat(c.b)} position={[0, 14, 0]} scale={2.4} castShadow />
        <mesh geometry={G.cyl} material={mat(c.b)} position={[3.6, 6, 0]} scale={[1.7, 5, 1.7]} castShadow />
        <mesh geometry={G.ball} material={mat(c.b)} position={[3.6, 11, 0]} scale={1.7} castShadow />
        <mesh geometry={G.cyl} material={mat(c.b)} position={[1.5, 6, 0]} rotation={[0, 0, Math.PI / 2]} scale={[1.7, 3.4, 1.7]} />
      </group>
    </>
  )
}

export const Terrain = memo(function Terrain({ terrain, seed }: { terrain: T; seed: number }) {
  switch (terrain) {
    case 'forest':
      return <Forest seed={seed} />
    case 'pasture':
      return <Pasture seed={seed} />
    case 'fields':
      return <Fields seed={seed} />
    case 'hills':
      return <Hills seed={seed} />
    case 'mountains':
      return <Mountains seed={seed} />
    case 'desert':
      return <Desert seed={seed} />
  }
})
