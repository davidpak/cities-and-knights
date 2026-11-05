/**
 * Pages for looking at things alone (the playbook's ?part= pages):
 *   ?part=pieces   one tile of each kind, every piece in every colour, signs and dice
 *   ?part=board    a sample game a few turns in (&turns=n, &seed=n)
 *   ?part=check    the spec's checks, beside a straight-down view of the board
 */
import { OrthographicCamera } from '@react-three/drei'
import { Canvas } from '@react-three/fiber'
import { useMemo } from 'react'
import { NeutralToneMapping } from 'three'
import { TOPO } from '../../../shared/board.ts'
import { botAction } from '../../../shared/bot.ts'
import { apply, newGame, type GameState } from '../../../shared/engine.ts'
import { HARBOR_SET, PLAYER_COLORS, TERRAINS } from '../../../shared/rules.ts'
import { PAL } from '../lib/palette.ts'
import { mat } from '../lib/toy.ts'
import { Board } from '../three/Board.tsx'
import { Dice } from '../three/Dice.tsx'
import { signGeo, tileGeo, tokenGeo } from '../three/geometry.ts'
import { City, Road, Robber, Settlement } from '../three/Pieces.tsx'
import { Scene } from '../three/Scene.tsx'
import { checkBoard, TILE } from '../three/spec.ts'
import { Terrain } from '../three/Terrain.tsx'
import { harborTexture, tokenTexture } from '../three/textures.ts'
import { TERRAIN } from '../lib/palette.ts'

const q = new URLSearchParams(location.search)

function sample(seed: number, turns: number): GameState {
  let s = newGame(
    [
      { id: 'a', name: 'Ada' },
      { id: 'b', name: 'Bo' },
      { id: 'c', name: 'Cy' },
      { id: 'd', name: 'Di' },
    ],
    seed,
  )
  let t = seed
  const rnd = () => {
    t = (t * 1103515245 + 12345) & 0x7fffffff
    return t / 0x7fffffff
  }
  for (let i = 0; i < 4000 && s.turn < turns && s.phase.kind !== 'over'; i++) {
    for (let p = 0; p < 4; p++) {
      const a = botAction(s, p, rnd)
      if (!a) continue
      const r = apply(s, p, a)
      if (r.ok) s = r.state
      break
    }
  }
  return s
}

function Pieces() {
  const tok = tokenGeo()
  const sign = signGeo()
  return (
    <Scene focus={[0, 0, 40]}>
      {TERRAINS.map((t, i) => (
        <group key={t} position={[(i - 2.5) * 110, 0, -60]}>
          <mesh geometry={tileGeo()} material={[mat(TERRAIN[t].top), mat(TERRAIN[t].side)]} castShadow receiveShadow />
          <group position={[0, TILE.h, 0]}>
            <Terrain terrain={t} seed={i * 7} />
            {t !== 'desert' && (
              <>
                <mesh geometry={tok.side} material={mat(PAL.creamDeep)} castShadow />
                <mesh geometry={tok.top} material={mat('#ffffff', { map: tokenTexture([6, 8, 5, 9, 11][i] ?? 3) })} />
              </>
            )}
          </group>
          {t === 'desert' && <Robber x={0} z={0} />}
        </group>
      ))}
      <mesh position={[0, -1, 120]} receiveShadow>
        <boxGeometry args={[760, 2, 260]} />
        <meshLambertMaterial color={PAL.honey} />
      </mesh>
      {PLAYER_COLORS.map((c, i) => (
        <group key={c} position={[(i - 1.5) * 120 - 60, -TILE.h, 70]}>
          <Settlement color={c} x={-30} z={0} />
          <City color={c} x={10} z={0} />
          <Road color={c} x={-10} z={35} angle={0} />
        </group>
      ))}
      {HARBOR_SET.slice(3).map((k, i) => (
        <group key={i} position={[(i - 2.5) * 40 + 200, 0, 190]}>
          <mesh geometry={sign.side} material={mat(PAL.creamDeep)} castShadow />
          <mesh geometry={sign.top} material={mat('#ffffff', { map: harborTexture(k) })} />
        </group>
      ))}
      <group position={[-560, 0, -40]}>
        <Dice dice={[3, 6]} rolls={0} />
      </group>
    </Scene>
  )
}

function BoardPage() {
  const s = useMemo(() => sample(Number(q.get('seed') ?? 4), Number(q.get('turns') ?? 14)), [])
  return (
    <div className="game">
      <div className="canvas-wrap">
        <Scene>
          <Board tiles={s.tiles} harbors={s.harbors} buildings={s.buildings} roads={s.roads} robber={s.robber} colors={s.players.map((p) => p.color)} />
          <Dice dice={s.dice} rolls={0} />
        </Scene>
      </div>
    </div>
  )
}

function CheckPage() {
  const s = useMemo(() => sample(4, 14), [])
  const results = checkBoard()
  return (
    <div className="check">
      <div className="check-view">
        <Canvas shadows gl={{ toneMapping: NeutralToneMapping, preserveDrawingBuffer: true }}>
          <OrthographicCamera makeDefault position={[0, 2000, 0]} zoom={1.25} near={10} far={5000} onUpdate={(c) => c.lookAt(0, 0, 0)} />
          <color attach="background" args={[PAL.bg]} />
          <hemisphereLight args={['#d6cff5', '#f1d0b4', 1.4]} />
          <directionalLight position={[-300, 1000, 400]} intensity={1.8} />
          <Board tiles={s.tiles} harbors={s.harbors} buildings={s.buildings} roads={s.roads} robber={s.robber} colors={s.players.map((p) => p.color)} />
        </Canvas>
        <div className="check-label">straight down (orthographic): tiles, gaps, pieces at corners and sides, harbours</div>
      </div>
      <pre className="check-text plate">
        {`spec and its checks (${TOPO.hexes.length} tiles, ${TOPO.vertices.length} corners, ${TOPO.edges.length} sides)\n\n`}
        {results.map((r) => `${r.ok ? '✓' : '✗'} ${r.what}: ${r.value}`).join('\n')}
      </pre>
    </div>
  )
}

export default function Parts({ part }: { part: string }) {
  if (part === 'pieces') return <div className="game"><div className="canvas-wrap"><Pieces /></div></div>
  if (part === 'board') return <BoardPage />
  if (part === 'check') return <CheckPage />
  return <div className="home"><div className="plate home-card">Pages: ?part=pieces, ?part=board, ?part=check</div></div>
}
