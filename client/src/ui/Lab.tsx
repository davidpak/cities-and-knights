/**
 * The lab: where the bots' training shows its progress. Everything on it is real: the phases and their results
 * (from the server, which the trainer updates), the simulator itself running here in the browser, today's Expert's
 * view of a fixed board, and (once training runs) each generation's strength, what it has learned, and how it plays.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { TOPO } from '../../../shared/board.ts'
import { openingValues } from '../../../shared/bot.ts'
import { newGame, resourceOf } from '../../../shared/engine.ts'
import { TERRAIN } from '../lib/palette.ts'

type Fact = { label: string; value: string }
type PhaseInfo = { key: string; name: string; status: 'done' | 'now' | 'next'; summary: string; facts: Fact[] }
type Generation = { gen: number; at: string; games: number; winVsExpert: number; lo: number; hi: number; promoted: boolean; heat?: Record<string, number> }
type Status = { updated: string; phases: PhaseInfo[]; training: null | { generations: Generation[]; live?: { gamesPerSec: number; totalGames: number; step: string } } }

const SERVER = import.meta.env.VITE_SERVER_URL ?? (import.meta.env.DEV ? `${location.protocol}//${location.hostname}:3001` : location.origin)
const n0 = new Intl.NumberFormat('en')
const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 })
/** the fixed board the opening maps are drawn on: the same for every generation, so they can be compared */
const REFERENCE_SEED = 20261107

export function Lab() {
  const [status, setStatus] = useState<Status | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let live = true
    const get = () =>
      fetch(`${SERVER}/api/lab`)
        .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
        .then((s: Status) => live && (setStatus(s), setFailed(false)))
        .catch(() => live && setFailed(true))
    get()
    // (the trainer updates it after each generation: look again now and then)
    const t = setInterval(get, 30_000)
    return () => ((live = false), clearInterval(t))
  }, [])
  const now = status?.phases.find((p) => p.status === 'now')
  const nowIndex = status ? status.phases.findIndex((p) => p.status === 'now') : -1

  return (
    <div className="lab">
      <header className="lab-head">
        <a className="lab-back" href="/">Towns and Peasants</a>
        <h1>Lab</h1>
        <p className="lab-status">
          {status && now ? (
            <>
              Phase {nowIndex + 1} of {status.phases.length}: <b>{now.name}</b>
            </>
          ) : failed ? (
            'Status unavailable'
          ) : (
            '…'
          )}
        </p>
      </header>

      {status && (
        <ol className="lab-phases">
          {status.phases.map((p, i) => (
            <li key={p.key} className={`lab-phase ${p.status}`}>
              <span className="lab-phase-n">{i + 1}</span>
              <div>
                <b>{p.name}</b>
                <span className="lab-phase-st">{p.status === 'done' ? 'Done' : p.status === 'now' ? 'In progress' : 'Next'}</span>
              </div>
              <p>{p.summary}</p>
              {p.facts.length > 0 && (
                <dl>
                  {p.facts.map((f) => (
                    <div key={f.label}>
                      <dd>{f.value}</dd>
                      <dt>{f.label}</dt>
                    </div>
                  ))}
                </dl>
              )}
            </li>
          ))}
        </ol>
      )}

      <div className="lab-grid">
        <LiveSim />
        <OpeningMap />
      </div>

      <Training training={status?.training ?? null} />
    </div>
  )
}

/** the simulator, running here: real games of the base game, played with random legal moves */
function LiveSim() {
  const [on, setOn] = useState(true)
  const [t, setT] = useState({ games: 0, moves: 0, turns: 0, won: 0, ms: 0, rate: 0 })
  const [error, setError] = useState<string | null>(null)
  const worker = useRef<Worker | null>(null)
  useEffect(() => {
    const w = new Worker('/lab/sim-worker.js')
    worker.current = w
    const recent: { games: number; ms: number }[] = []
    w.onmessage = (e) => {
      if (e.data.error) return setError(e.data.error)
      const d = e.data as { games: number; won: number; moves: number; turns: number; ms: number }
      recent.push({ games: d.games, ms: d.ms })
      if (recent.length > 20) recent.shift()
      const rate = (recent.reduce((a, r) => a + r.games, 0) / recent.reduce((a, r) => a + r.ms, 0)) * 1000
      setT((p) => ({ games: p.games + d.games, moves: p.moves + d.moves, turns: p.turns + d.turns, won: p.won + d.won, ms: p.ms + d.ms, rate }))
    }
    return () => w.terminate()
  }, [])
  // runs while on and the page is in view (a hidden tab rests)
  useEffect(() => {
    const go = () => worker.current?.postMessage(on && !document.hidden ? 'start' : 'stop')
    go()
    document.addEventListener('visibilitychange', go)
    return () => document.removeEventListener('visibilitychange', go)
  }, [on])
  return (
    <section className="lab-card">
      <h2>The simulator, running in this browser</h2>
      <p className="lab-note">Whole base games, every move a random legal one, on the same rules as the real game. On your PC, 16 threads of this feed the training.</p>
      {error ? (
        <p className="lab-note">Couldn't start: {error}</p>
      ) : (
        <>
          <div className="lab-big">
            <b>{n0.format(t.games)}</b>
            <span>games played here</span>
          </div>
          <div className="lab-row">
            <div><b>{n0.format(Math.round(t.rate))}</b><span>games a second</span></div>
            <div><b>{compact.format(t.moves)}</b><span>moves</span></div>
            <div><b>{t.games ? Math.round(t.turns / t.games) : '–'}</b><span>turns a game</span></div>
          </div>
          <button className="lab-btn" type="button" onClick={() => setOn((x) => !x)}>
            {on ? 'Pause' : 'Run'}
          </button>
        </>
      )}
    </section>
  )
}

/** today's Expert, on a fixed board: how much it values each starting corner (the network's map will sit beside it) */
function OpeningMap() {
  const { s, values, top } = useMemo(() => {
    const s = newGame(['a', 'b', 'c', 'd'].map((id) => ({ id, name: id })), REFERENCE_SEED)
    const values = openingValues(s, 0)
    const top = [...values.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([v]) => v)
    return { s, values, top }
  }, [])
  const vs = [...values.values()]
  const lo = Math.min(...vs), hi = Math.max(...vs)
  const xs = TOPO.vertices.map((v) => v.x), ys = TOPO.vertices.map((v) => v.y)
  const pad = 0.6
  const box = [Math.min(...xs) - pad, Math.min(...ys) - pad, Math.max(...xs) - Math.min(...xs) + 2 * pad, Math.max(...ys) - Math.min(...ys) + 2 * pad]
  const [hover, setHover] = useState<number | null>(null)
  const pips: Record<number, number> = { 2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 8: 5, 9: 4, 10: 3, 11: 2, 12: 1 }
  return (
    <section className="lab-card">
      <h2>Where today's Expert would settle first</h2>
      <p className="lab-note">A fixed board. Each corner's dot is how much Expert values it as a first settlement, its own scoring with its look-ahead to the second. The trained network's map will be drawn on this same board, generation by generation.</p>
      <svg className="lab-board" viewBox={box.join(' ')} role="img" aria-label="The reference board with Expert's value of each corner">
        {TOPO.hexes.map((h, i) => {
          const t = s.tiles[i]
          const pts = h.vertices.map((v) => `${h.x + (TOPO.vertices[v].x - h.x) * 0.96},${h.y + (TOPO.vertices[v].y - h.y) * 0.96}`).join(' ')
          return (
            <g key={i}>
              <polygon points={pts} fill={TERRAIN[t.terrain].top} stroke="#2a1d13" strokeWidth={0.03} opacity={0.82} />
              {t.number && (
                <>
                  <circle cx={h.x} cy={h.y} r={0.24} fill="#f6ecd5" />
                  <text x={h.x} y={h.y + 0.08} textAnchor="middle" fontSize={0.22} fontWeight={700} fill={t.number === 6 || t.number === 8 ? '#c8453c' : '#2a1d13'}>
                    {t.number}
                  </text>
                  {Array.from({ length: pips[t.number] }, (_, k) => (
                    <circle key={k} cx={h.x + (k - (pips[t.number!] - 1) / 2) * 0.045} cy={h.y + 0.14} r={0.014} fill={t.number === 6 || t.number === 8 ? '#c8453c' : '#2a1d13'} />
                  ))}
                </>
              )}
            </g>
          )
        })}
        {[...values.entries()].map(([v, val]) => {
          // (squared, so the few corners Expert really wants stand out from the many it merely accepts)
          const k = ((val - lo) / (hi - lo || 1)) ** 2
          const { x, y } = TOPO.vertices[v]
          return (
            <circle key={v} cx={x} cy={y} r={0.05 + 0.19 * k} fill="#e3a72c" fillOpacity={0.2 + 0.8 * k} stroke="#2a1d13" strokeWidth={0.02}
              onPointerEnter={() => setHover(v)} onPointerLeave={() => setHover((h) => (h === v ? null : h))} />
          )
        })}
        {top.map((v, i) => (
          <g key={v} pointerEvents="none">
            <circle cx={TOPO.vertices[v].x} cy={TOPO.vertices[v].y} r={0.3} fill="none" stroke="#fff4e6" strokeWidth={0.04} />
            <text x={TOPO.vertices[v].x + 0.34} y={TOPO.vertices[v].y - 0.22} fontSize={0.24} fontWeight={700} fill="#fff4e6">{i + 1}</text>
          </g>
        ))}
      </svg>
      <p className="lab-note lab-hover">
        {hover !== null ? (
          <>
            {TOPO.vertices[hover].hexes.map((h) => s.tiles[h]).filter((t) => resourceOf(t)).map((t) => `${resourceOf(t)} ${t.number}`).join(' · ')}: value {values.get(hover)!.toFixed(1)}
            {top.includes(hover) ? ` (Expert's #${top.indexOf(hover) + 1})` : ''}
          </>
        ) : (
          'Point at a corner for what it touches. Ringed: Expert’s top three.'
        )}
      </p>
    </section>
  )
}

/** training: each generation's strength against today's Expert, once it runs */
function Training({ training }: { training: Status['training'] }) {
  const gens = training?.generations ?? []
  return (
    <section className="lab-card lab-training">
      <h2>Strength by generation</h2>
      <p className="lab-note">Each generation plays 400 games against today's Expert, seats rotated and dice paired. A fair share is 25%; above it, the network is stronger. A generation is kept only if it beats the one before.</p>
      {gens.length === 0 ? (
        <div className="lab-empty">
          <StrengthFrame gens={[]} />
          <p>Starts when training runs on your PC. The first point is generation 0: the network trained to play like today's Expert.</p>
        </div>
      ) : (
        <StrengthFrame gens={gens} />
      )}
    </section>
  )
}

function StrengthFrame({ gens }: { gens: Generation[] }) {
  const W = 1000, H = 300, m = { l: 44, r: 16, t: 14, b: 30 }
  const maxGen = Math.max(10, ...gens.map((g) => g.gen))
  const x = (g: number) => m.l + (g / maxGen) * (W - m.l - m.r)
  const y = (p: number) => m.t + (1 - p / 0.6) * (H - m.t - m.b)
  const ticks = [0, 0.15, 0.25, 0.45, 0.6]
  return (
    <svg className="lab-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Win rate against today's Expert by generation">
      {ticks.map((t) => (
        <g key={t}>
          <line x1={m.l} x2={W - m.r} y1={y(t)} y2={y(t)} className={t === 0.25 ? 'lab-fair' : 'lab-gridline'} />
          <text x={m.l - 6} y={y(t) + 4} textAnchor="end" className="lab-tick">{Math.round(t * 100)}%</text>
        </g>
      ))}
      {Array.from({ length: 6 }, (_, i) => Math.round((i * maxGen) / 5)).map((g) => (
        <text key={g} x={x(g)} y={H - 8} textAnchor="middle" className="lab-tick">{g}</text>
      ))}
      <text x={W - m.r} y={y(0.25) - 6} textAnchor="end" className="lab-tick">fair share</text>
      {gens.length > 0 && (
        <>
          <path d={`M${gens.map((g) => `${x(g.gen)},${y(g.hi)}`).join('L')}L${[...gens].reverse().map((g) => `${x(g.gen)},${y(g.lo)}`).join('L')}Z`} className="lab-band" />
          <polyline points={gens.map((g) => `${x(g.gen)},${y(g.winVsExpert)}`).join(' ')} className="lab-line" />
          {gens.map((g) => (
            <circle key={g.gen} cx={x(g.gen)} cy={y(g.winVsExpert)} r={g.promoted ? 5 : 3.5} className={g.promoted ? 'lab-dot kept' : 'lab-dot'} />
          ))}
        </>
      )}
    </svg>
  )
}
