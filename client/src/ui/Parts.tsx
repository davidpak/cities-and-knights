/**
 * Pages for looking at the board alone:
 *   ?part=board    a sample game a few turns in (&turns=n, &seed=n)
 *   ?part=check    the spec's checks beside the board
 */
import { useMemo } from 'react'
import { TOPO } from '../../../shared/board.ts'
import { botAction } from '../../../shared/bot.ts'
import { apply, newGame, type GameState } from '../../../shared/engine.ts'
import { BoardView } from '../three/Board.tsx'
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
