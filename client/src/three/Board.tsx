/**
 * The island on the table: tiles, tokens, sea, harbours, and everyone's pieces, drawn from a game view.
 * Clickable spots are passed in (computed from the shared rules), so anything you can click is a legal move.
 */
import type { ThreeEvent } from '@react-three/fiber'
import { memo, useState } from 'react'
import { TOPO } from '../../../shared/board.ts'
import type { Building, Harbor, Tile } from '../../../shared/engine.ts'
import type { PlayerColor } from '../../../shared/rules.ts'
import { PAL, TERRAIN } from '../lib/palette.ts'
import { mat } from '../lib/toy.ts'
import { frameGeo, plankGeo, seaGeo, signGeo, tileGeo, tokenGeo } from './geometry.ts'
import { City, Road, Robber, Settlement } from './Pieces.tsx'
import { HARBOR, SEA, TABLE, TILE, TOKEN, edgeAt, harborSign, hexAt, toBoard, vertexAt } from './spec.ts'
import { harborTexture, tokenTexture } from './textures.ts'
import { Terrain } from '../three/Terrain.tsx'

export type Picking =
  | { kind: 'settlement'; spots: number[] }
  | { kind: 'city'; spots: number[] }
  | { kind: 'road'; spots: number[] }
  | { kind: 'robber'; spots: number[] }
  | null

export type BoardProps = {
  tiles: Tile[]
  harbors: Harbor[]
  buildings: Record<number, Building>
  roads: Record<number, number>
  robber: number
  colors: PlayerColor[]
  /** what you are placing, and where you may */
  picking?: Picking
  you?: number
  onPick?: (kind: NonNullable<Picking>['kind'], id: number) => void
}

/** a click, not the end of a drag to turn the camera */
const isClick = (e: ThreeEvent<MouseEvent>) => e.delta < 6

const TileMesh = memo(function TileMesh({ i, tile, robbed }: { i: number; tile: Tile; robbed: boolean }) {
  const [x, z] = hexAt(i)
  const c = TERRAIN[tile.terrain]
  const tok = tokenGeo()
  return (
    <group position={[x, 0, z]}>
      <mesh geometry={tileGeo()} material={[mat(c.top), mat(c.side)]} receiveShadow castShadow />
      <group position={[0, TILE.h, 0]}>
        <Terrain terrain={tile.terrain} seed={i * 31 + tile.terrain.length} />
        {tile.number !== null && (
          <group>
            <mesh geometry={tok.side} material={mat(PAL.creamDeep)} castShadow receiveShadow />
            <mesh geometry={tok.top} material={mat(robbed ? '#cfc6c0' : '#ffffff', { map: tokenTexture(tile.number) })} receiveShadow />
          </group>
        )}
      </group>
    </group>
  )
})

const HarborMesh = memo(function HarborMesh({ h }: { h: Harbor }) {
  const [sx, sz] = harborSign(h.edge)
  const e = TOPO.edges[h.edge]
  const sign = signGeo()
  return (
    <group>
      {/* two planks, one from each corner of the side out to the sign */}
      {[e.a, e.b].map((v) => {
        const [vx, vz] = vertexAt(v)
        const len = Math.hypot(sx - vx, sz - vz) - HARBOR.signR + 2
        const ang = Math.atan2(sz - vz, sx - vx)
        return (
          <mesh
            key={v}
            geometry={plankGeo()}
            material={mat(PAL.mapleDeep)}
            position={[vx + (Math.cos(ang) * len) / 2, SEA.level - 0.5, vz + (Math.sin(ang) * len) / 2]}
            rotation={[0, -ang, 0]}
            scale={[len, 1, 1]}
            castShadow
            receiveShadow
          />
        )
      })}
      <group position={[sx, SEA.level - 1, sz]}>
        <mesh geometry={sign.side} material={mat(PAL.creamDeep)} castShadow receiveShadow />
        <mesh geometry={sign.top} material={mat('#ffffff', { map: harborTexture(h.kind) })} />
      </group>
    </group>
  )
})

const Island = memo(function Island({ tiles, harbors, robber }: { tiles: Tile[]; harbors: Harbor[]; robber: number }) {
  return (
    <>
      <mesh geometry={seaGeo()} material={mat(PAL.sea)} receiveShadow />
      <mesh geometry={frameGeo()} material={[mat(PAL.maple), mat(PAL.mapleDeep)]} castShadow receiveShadow />
      <mesh position={[0, TABLE.top - TABLE.h / 2, 0]} receiveShadow>
        <cylinderGeometry args={[TABLE.r, TABLE.r, TABLE.h, 96]} />
        <meshLambertMaterial color={PAL.honey} />
      </mesh>
      {tiles.map((t, i) => (
        <TileMesh key={i} i={i} tile={t} robbed={i === robber} />
      ))}
      {harbors.map((h) => (
        <HarborMesh key={h.edge} h={h} />
      ))}
    </>
  )
})

/** a small cream marker where you may build; hovering shows the piece there */
function Spot({ x, z, onClick, onHover, long, angle = 0 }: { x: number; z: number; onClick: () => void; onHover: (on: boolean) => void; long?: boolean; angle?: number }) {
  return (
    <group position={[x, TILE.h, z]} rotation={[0, -angle, 0]}>
      <mesh material={mat(PAL.cream)} position={[0, 0.6, 0]} scale={long ? [14, 1.6, 4] : [5.5, 1.6, 5.5]} castShadow>
        {long ? <boxGeometry args={[1, 1, 1]} /> : <cylinderGeometry args={[1, 1, 1, 20]} />}
      </mesh>
      {/* a generous invisible target, so small spots are easy to hit */}
      <mesh
        scale={long ? [26, 14, 12] : [13, 14, 13]}
        position={[0, 4, 0]}
        onPointerOver={(e) => (e.stopPropagation(), onHover(true), (document.body.style.cursor = 'pointer'))}
        onPointerOut={() => (onHover(false), (document.body.style.cursor = ''))}
        onClick={(e) => {
          e.stopPropagation()
          if (isClick(e)) onClick()
        }}
      >
        <boxGeometry args={[1, 1, 1]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} colorWrite={false} />
      </mesh>
    </group>
  )
}

function Picker({ picking, color, onPick }: { picking: NonNullable<Picking>; color: PlayerColor; onPick: BoardProps['onPick'] }) {
  const [hover, setHover] = useState<number | null>(null)
  const pick = (id: number) => () => {
    setHover(null)
    document.body.style.cursor = ''
    onPick?.(picking.kind, id)
  }
  const on = (id: number) => (v: boolean) => setHover((h) => (v ? id : h === id ? null : h))

  if (picking.kind === 'robber') {
    return (
      <>
        {picking.spots.map((h) => {
          const [x, z] = hexAt(h)
          return (
            <mesh
              key={h}
              position={[x, TILE.h + 6, z]}
              onPointerOver={(e) => (e.stopPropagation(), setHover(h), (document.body.style.cursor = 'pointer'))}
              onPointerOut={() => (setHover((c) => (c === h ? null : c)), (document.body.style.cursor = ''))}
              onClick={(e) => (e.stopPropagation(), isClick(e) && pick(h)())}
            >
              <cylinderGeometry args={[TILE.flat - 4, TILE.flat - 4, 12, 6]} />
              <meshBasicMaterial transparent opacity={0} depthWrite={false} colorWrite={false} />
            </mesh>
          )
        })}
        {hover !== null && <Robber ghost x={hexAt(hover)[0]} z={hexAt(hover)[1] - TOKEN.r * 0} />}
      </>
    )
  }
  if (picking.kind === 'road') {
    return (
      <>
        {picking.spots.map((e) => {
          const [x, z] = edgeAt(e)
          return <Spot key={e} x={x} z={z} long angle={TOPO.edges[e].angle} onClick={pick(e)} onHover={on(e)} />
        })}
        {hover !== null && <Road ghost color={color} x={edgeAt(hover)[0]} z={edgeAt(hover)[1]} angle={TOPO.edges[hover].angle} />}
      </>
    )
  }
  return (
    <>
      {picking.kind === 'settlement' &&
        picking.spots.map((v) => {
          const [x, z] = vertexAt(v)
          return <Spot key={v} x={x} z={z} onClick={pick(v)} onHover={on(v)} />
        })}
      {picking.kind === 'city' &&
        picking.spots.map((v) => {
          const [x, z] = vertexAt(v)
          return (
            <mesh
              key={v}
              position={[x, TILE.h + 9, z]}
              onPointerOver={(e) => (e.stopPropagation(), setHover(v), (document.body.style.cursor = 'pointer'))}
              onPointerOut={() => (setHover((c) => (c === v ? null : c)), (document.body.style.cursor = ''))}
              onClick={(e) => (e.stopPropagation(), isClick(e) && pick(v)())}
            >
              <boxGeometry args={[22, 22, 22]} />
              <meshBasicMaterial transparent opacity={0} depthWrite={false} colorWrite={false} />
            </mesh>
          )
        })}
      {hover !== null && picking.kind === 'settlement' && <Settlement ghost color={color} x={vertexAt(hover)[0]} z={vertexAt(hover)[1]} />}
      {hover !== null && picking.kind === 'city' && <City ghost color={color} x={vertexAt(hover)[0]} z={vertexAt(hover)[1]} />}
    </>
  )
}

export function Board({ tiles, harbors, buildings, roads, robber, colors, picking, you = -1, onPick }: BoardProps) {
  const [rx, rz] = hexAt(robber)
  return (
    <group>
      <Island tiles={tiles} harbors={harbors} robber={robber} />
      {Object.entries(roads).map(([e, owner]) => {
        const [x, z] = edgeAt(Number(e))
        return <Road key={`r${e}`} color={colors[owner]} x={x} z={z} angle={TOPO.edges[Number(e)].angle} />
      })}
      {Object.entries(buildings).map(([v, b]) => {
        const [x, z] = vertexAt(Number(v))
        // hide the settlement you're about to upgrade while its ghost city shows
        return b.kind === 'city' ? (
          <City key={`c${v}`} color={colors[b.owner]} x={x} z={z} />
        ) : (
          <Settlement key={`s${v}`} color={colors[b.owner]} x={x} z={z} />
        )
      })}
      <Robber x={rx} z={rz} />
      {picking && you >= 0 && <Picker picking={picking} color={colors[you]} onPick={onPick} />}
    </group>
  )
}

export { toBoard }
