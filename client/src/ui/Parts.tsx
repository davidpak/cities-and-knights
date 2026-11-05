/**
 * Pages for looking at the board alone:
 *   ?part=board    a sample game a few turns in (&turns=n, &seed=n)
 *   ?part=check    the spec's checks beside the board
 */
import { useMemo } from 'react'
import { TOPO } from '../../../shared/board.ts'
import { botAction } from '../../../shared/bot.ts'
import { apply, newGame, type GameState } from '../../../shared/engine.ts'
import { Canvas } from '@react-three/fiber'
import { PLAYER_COLORS } from '../../../shared/rules.ts'
import { BoardView, Fit, Lights, canvasProps } from '../three/Board.tsx'
import { City, Road, Robber, Settlement } from '../three/Pieces.tsx'
import { checkBoard } from '../three/spec.ts'

const q = new URLSearchParams(location.search)

function sample(seed: number, turns: number): GameState {
  let s = newGame(['Ada', 'Bo', 'Cy', 'Di'].map((name, i) => ({ id: String(i), name })), seed)
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

function Board({ s }: { s: GameState }) {
  return <BoardView tiles={s.tiles} harbors={s.harbors} buildings={s.buildings} roads={s.roads} robber={s.robber} colors={s.players.map((p) => p.color)} />
}

export default function Parts({ part }: { part: string }) {
  const s = useMemo(() => sample(Number(q.get('seed') ?? 4), Number(q.get('turns') ?? 14)), [])
  if (part === 'pieces')
    return (
      <div style={{ position: 'fixed', inset: 0 }}>
        <Canvas {...canvasProps()}>
          <Lights extent={140} />
          <Fit bounds={{ minX: -95, maxX: 95, minZ: -42, maxZ: 42 }} tilt={0.75} />
          <mesh position={[0, 10, 0]} receiveShadow>
            <boxGeometry args={[400, 4, 200]} />
            <meshLambertMaterial color="#5a3d29" />
          </mesh>
          {PLAYER_COLORS.map((c, i) => (
            <group key={c} position={[(i - 1.5) * 44, 0, 0]}>
              <Settlement color={c} x={-8} z={-18} />
              <City color={c} x={4} z={10} />
              <Road color={c} x={-4} z={32} angle={0} />
            </group>
          ))}
          <Robber x={86} z={0} />
        </Canvas>
      </div>
    )
  if (part === 'board')
    return (
      <div style={{ position: 'fixed', inset: 0 }}>
        <Board s={s} />
      </div>
    )
  if (part === 'check')
    return (
      <div className="check">
        <div className="check-view">
          <Board s={s} />
        </div>
        <pre className="check-text panel">
          {`spec and its checks (${TOPO.hexes.length} tiles, ${TOPO.vertices.length} corners, ${TOPO.edges.length} sides)\n\n`}
          {checkBoard()
            .map((r) => `${r.ok ? '✓' : '✗'} ${r.what}: ${r.value}`)
            .join('\n')}
        </pre>
      </div>
    )
  return <div className="home"><div className="plate home-card">Pages: ?part=board, ?part=check</div></div>
}
