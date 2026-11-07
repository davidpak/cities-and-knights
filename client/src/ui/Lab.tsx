/**
 * The lab: where the bots' training shows its progress. Everything on it is real: the phases and their results
 * (from the server, which the trainer updates), what the trainer is doing right now, today's Expert's view of a
 * fixed board, and (once training runs) each generation's strength, what it has learned, and how it plays.
 */
import { useEffect, useMemo, useState } from 'react'
import { TOPO } from '../../../shared/board.ts'
import { openingValues } from '../../../shared/bot.ts'
import { newGame, resourceOf } from '../../../shared/engine.ts'
import { TERRAIN } from '../lib/palette.ts'

type Fact = { label: string; value: string }
type PhaseInfo = { key: string; name: string; status: 'done' | 'now' | 'next'; summary: string; facts: Fact[] }
type Habits = { settlements: number; cities: number; roads: number; cards: number; knights: number; bankTrades: number; longestRoad: number; largestArmy: number; points: number }
type Generation = {
  gen: number; at: string; games: number; positions: number; holdout: number; turns: number
  vsChampion: number; lo: number; hi: number; promoted: boolean; rating: number; ratingLo: number; ratingHi: number; vsRandom: number
  habits: Habits; heat: Record<string, number>; winVsExpert?: number; winVsExpertLo?: number; winVsExpertHi?: number
}
type Live = { step: string; gamesPerSec: number; totalGames: number; positions?: number; generation?: number }
type Status = { updated: string; phases: PhaseInfo[]; training: null | { generations: Generation[]; live?: Live; machine?: string } }

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
        <TrainerNow live={status?.training?.live ?? null} machine={status?.training?.machine} updated={status?.training ? status.updated : undefined} />
        <OpeningMap gens={status?.training?.generations ?? []} />
      </div>

      <Training training={status?.training ?? null} />
    </div>
  )
}

/** the trainer, right now: what it's doing and how much it has played (reported by the trainer itself) */
function TrainerNow({ live, machine, updated }: { live: Live | null; machine?: string; updated?: string }) {
  return (
    <section className="lab-card">
      <h2>Training now</h2>
      {live ? (
        <>
          <p className="lab-note">{live.step}</p>
          <div className="lab-big">
            <b>{n0.format(live.totalGames)}</b>
            <span>self-play games learned from</span>
          </div>
          <div className="lab-row">
            <div><b>{n0.format(Math.round(live.gamesPerSec))}</b><span>games a second</span></div>
            <div><b>{compact.format(live.positions ?? 0)}</b><span>positions learned from</span></div>
            <div><b>{live.generation ?? 0}</b><span>generation</span></div>
          </div>
          {updated && <p className="lab-note">{machine ? `${machine} · ` : ''}last report {new Date(updated).toLocaleString()}</p>}
        </>
      ) : (
        <p className="lab-note lab-idle">Nothing is training yet. When training runs on your PC, it reports here: what it's doing, games played and learned from, and which generation it's on.</p>
      )}
    </section>
  )
}

/** a fixed board: how much a player values each corner as its first settlement: today's Expert, or a generation of
 *  the network (side by side through the generations) */
function OpeningMap({ gens }: { gens: Generation[] }) {
  const { s, expert } = useMemo(() => {
    const s = newGame(['a', 'b', 'c', 'd'].map((id) => ({ id, name: id })), REFERENCE_SEED)
    return { s, expert: openingValues(s, 0) }
  }, [])
  const [who, setWho] = useState<'expert' | number>('expert')
  const pickGen = typeof who === 'number' ? gens[Math.min(who, gens.length - 1)] : null
  const values = pickGen ? new Map(Object.entries(pickGen.heat).map(([v, x]) => [Number(v), x])) : expert
  const ranked = [...values.entries()].sort((a, b) => b[1] - a[1])
  const top = ranked.slice(0, 3).map(([v]) => v)
  const vs = [...values.values()]
  const lo = Math.min(...vs), hi = Math.max(...vs)
  const xs = TOPO.vertices.map((v) => v.x), ys = TOPO.vertices.map((v) => v.y)
  const pad = 0.6
  const box = [Math.min(...xs) - pad, Math.min(...ys) - pad, Math.max(...xs) - Math.min(...xs) + 2 * pad, Math.max(...ys) - Math.min(...ys) + 2 * pad]
  const [hover, setHover] = useState<number | null>(null)
  const pips: Record<number, number> = { 2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 8: 5, 9: 4, 10: 3, 11: 2, 12: 1 }
  return (
    <section className="lab-card">
      <h2>Where it would settle first</h2>
      <p className="lab-note">A fixed board. Each corner's dot is how much the player values it as a first settlement. Expert: its own scoring with its look-ahead. The network: its chance of winning after settling there. Ringed: the top three.</p>
      <div className="lab-seg" role="group" aria-label="Whose map">
        <button type="button" aria-pressed={who === 'expert'} onClick={() => setWho('expert')}>Today's Expert</button>
        <button type="button" aria-pressed={who !== 'expert'} disabled={!gens.length} onClick={() => setWho(gens.length - 1)}>The network</button>
      </div>
      {typeof who === 'number' && gens.length > 1 && (
        <label className="lab-slider">
          <span>Generation {pickGen?.gen}</span>
          <input type="range" min={0} max={gens.length - 1} value={Math.min(who, gens.length - 1)} onChange={(e) => setWho(Number(e.target.value))} />
        </label>
      )}
      <svg className="lab-board" viewBox={box.join(' ')} role="img" aria-label="The reference board with each corner's value">
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
          // (squared, so the few corners it really wants stand out from the many it merely accepts)
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
        {hover !== null && values.has(hover) ? (
          <>
            {TOPO.vertices[hover].hexes.map((h) => s.tiles[h]).filter((t) => resourceOf(t)).map((t) => `${resourceOf(t)} ${t.number}`).join(' · ')}:{' '}
            {pickGen ? `${Math.round(values.get(hover)! * 100)}% to win` : `value ${values.get(hover)!.toFixed(1)}`}
            {top.includes(hover) ? ` (#${top.indexOf(hover) + 1})` : ''}
          </>
        ) : (
          'Point at a corner for what it touches.'
        )}
      </p>
    </section>
  )
}

/** a measure across the generations: a line, an optional band, a reference line, and an optional second line
 *  (for example the win rate against today's Expert, which only exists where a generation was promoted) */
function GenChart({ gens, y, band, ref, fmt, domain, label, y2, tip2, legend }: { gens: Generation[]; y: (g: Generation) => number; band?: (g: Generation) => [number, number]; ref?: { value: number; label: string }; fmt: (v: number) => string; domain: [number, number]; label: string; y2?: (g: Generation) => number | undefined; tip2?: (g: Generation) => string | undefined; legend?: [string, string] }) {
  const W = 1000, H = 260, m = { l: 56, r: 16, t: 14, b: 30 }
  const last = Math.max(4, ...gens.map((g) => g.gen))
  const x = (g: number) => m.l + (g / last) * (W - m.l - m.r)
  const [lo, hi] = domain
  const yy = (v: number) => m.t + (1 - (Math.min(hi, Math.max(lo, v)) - lo) / (hi - lo || 1)) * (H - m.t - m.b)
  const ticks = Array.from({ length: 5 }, (_, i) => lo + ((hi - lo) * i) / 4)
  const [hover, setHover] = useState<Generation | null>(null)
  return (
    <div className="lab-chart-box">
      <svg className="lab-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}
        onPointerMove={(e) => {
          if (!gens.length) return
          const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect()
          const gx = (((e.clientX - r.left) / r.width) * W - m.l) / (W - m.l - m.r) * last
          setHover(gens.reduce((a, b) => (Math.abs(b.gen - gx) < Math.abs(a.gen - gx) ? b : a)))
        }}
        onPointerLeave={() => setHover(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={m.l} x2={W - m.r} y1={yy(t)} y2={yy(t)} className="lab-gridline" />
            <text x={m.l - 8} y={yy(t) + 4} textAnchor="end" className="lab-tick">{fmt(t)}</text>
          </g>
        ))}
        {Array.from({ length: Math.min(last, 10) + 1 }, (_, i) => Math.round((i * last) / Math.min(last, 10))).map((g) => (
          <text key={g} x={x(g)} y={H - 8} textAnchor="middle" className="lab-tick">{g}</text>
        ))}
        {ref && (
          <>
            <line x1={m.l} x2={W - m.r} y1={yy(ref.value)} y2={yy(ref.value)} className="lab-fair" />
            <text x={W - m.r} y={yy(ref.value) - 6} textAnchor="end" className="lab-tick">{ref.label}</text>
          </>
        )}
        {band && gens.length > 1 && (
          <path d={`M${gens.map((g) => `${x(g.gen)},${yy(band(g)[1])}`).join('L')}L${[...gens].reverse().map((g) => `${x(g.gen)},${yy(band(g)[0])}`).join('L')}Z`} className="lab-band" />
        )}
        {gens.length > 0 && <polyline points={gens.map((g) => `${x(g.gen)},${yy(y(g))}`).join(' ')} className="lab-line" />}
        {gens.map((g) => (
          <circle key={g.gen} cx={x(g.gen)} cy={yy(y(g))} r={g.promoted ? 6 : 4} className={g.promoted ? 'lab-dot kept' : 'lab-dot'} />
        ))}
        {y2 && (() => {
          const pts = gens.filter((g) => Number.isFinite(y2(g) as number))
          return (
            <>
              {pts.length > 1 && <polyline points={pts.map((g) => `${x(g.gen)},${yy(y2(g) as number)}`).join(' ')} className="lab-line-2" />}
              {pts.map((g) => <circle key={g.gen} cx={x(g.gen)} cy={yy(y2(g) as number)} r={5} className="lab-dot-2" />)}
            </>
          )
        })()}
        {legend && (
          <g>
            <line x1={m.l + 6} x2={m.l + 26} y1={m.t + 8} y2={m.t + 8} className="lab-line" />
            <text x={m.l + 32} y={m.t + 12} className="lab-legend">{legend[0]}</text>
            <line x1={m.l + 6} x2={m.l + 26} y1={m.t + 26} y2={m.t + 26} className="lab-line-2" />
            <text x={m.l + 32} y={m.t + 30} className="lab-legend">{legend[1]}</text>
          </g>
        )}
        {hover && <line x1={x(hover.gen)} x2={x(hover.gen)} y1={m.t} y2={H - m.b} className="lab-cursor" />}
      </svg>
      {hover && (
        <div className="lab-tip" style={{ left: `${(x(hover.gen) / W) * 100}%` }}>
          <b>Generation {hover.gen}</b> {hover.promoted ? '· promoted' : ''}
          <br />
          {fmt(y(hover))}
          {band && <> ({fmt(band(hover)[0])} to {fmt(band(hover)[1])})</>}
          {tip2 && tip2(hover) && <><br />{tip2(hover)}</>}
        </div>
      )}
    </div>
  )
}

/** training: strength, understanding, a fixed yardstick, and how it plays, generation by generation */
function Training({ training }: { training: Status['training'] }) {
  const gens = training?.generations ?? []
  if (!gens.length)
    return (
      <section className="lab-card lab-training">
        <h2>Strength by generation</h2>
        <p className="lab-note">Each generation plays the champion in rotated seats over the same dice, and is kept only if it clearly wins more than a fair share. Its rating is the champion's plus the gap that match measured.</p>
        <div className="lab-empty">
          <GenChart gens={[]} y={(g) => g.rating} fmt={(v) => `${Math.round(v)}`} domain={[0, 400]} label="Rating by generation" />
          <p>Starts when training runs. The first point is generation 0: a network that has learned nothing yet.</p>
        </div>
      </section>
    )
  const rmax = Math.max(100, ...gens.map((g) => g.ratingHi)), rmin = Math.min(0, ...gens.map((g) => g.ratingLo))
  const keys: [keyof Habits, string, (v: number) => string][] = [
    ['points', 'Points at the end', (v) => v.toFixed(1)],
    ['settlements', 'Settlements built', (v) => v.toFixed(1)],
    ['cities', 'Cities built', (v) => v.toFixed(1)],
    ['roads', 'Roads built', (v) => v.toFixed(1)],
    ['cards', 'Cards bought', (v) => v.toFixed(1)],
    ['knights', 'Knights played', (v) => v.toFixed(1)],
    ['bankTrades', 'Bank trades', (v) => v.toFixed(1)],
    ['longestRoad', 'Holds Longest Road', (v) => `${Math.round(v * 100)}%`],
    ['largestArmy', 'Holds Largest Army', (v) => `${Math.round(v * 100)}%`],
  ]
  const shown = gens.length > 8 ? gens.filter((_, i) => i % Math.ceil(gens.length / 8) === 0 || i === gens.length - 1) : gens
  return (
    <>
      <section className="lab-card lab-training">
        <h2>Strength by generation</h2>
        <p className="lab-note">Each generation plays the champion in rotated seats over the same dice, and is kept (a filled dot) only if it clearly wins more than a fair share. Its rating is the champion's plus the gap that match measured; the band is that match's 90% range.</p>
        <GenChart gens={gens} y={(g) => g.rating} band={(g) => [g.ratingLo, g.ratingHi]} ref={{ value: 0, label: 'generation 0' }} fmt={(v) => `${v > 0 ? '+' : ''}${Math.round(v)}`} domain={[rmin, rmax]} label="Rating by generation" />
      </section>
      <div className="lab-grid two">
        <section className="lab-card">
          <h2>Predicting new games</h2>
          <p className="lab-note">How well it predicts the winners of games it hasn't learned from yet, before it learns from them: the honest measure of understanding. Lower is better; the dashed line is guessing.</p>
          <GenChart gens={gens} y={(g) => g.holdout} ref={{ value: Math.log(4), label: 'guessing' }} fmt={(v) => v.toFixed(2)} domain={[Math.min(0.8, ...gens.map((g) => g.holdout)), Math.max(1.6, ...gens.map((g) => g.holdout))]} label="Prediction loss on new games by generation" />
        </section>
        <section className="lab-card">
          <h2>Against random play and today's Expert</h2>
          <p className="lab-note">Two fixed yardsticks: the champion in one seat against three players making random legal moves, and against three of today's hand-written Expert. Measured on promotion. A fair share is 25%; the goal is to leave Expert far behind.</p>
          <GenChart
            gens={gens}
            y={(g) => g.vsRandom}
            y2={(g) => g.winVsExpert}
            legend={['vs random', "vs today's Expert"]}
            tip2={(g) => (g.winVsExpert != null ? `vs Expert ${Math.round(g.winVsExpert * 100)}%${g.winVsExpertLo != null ? ` (${Math.round(g.winVsExpertLo * 100)}–${Math.round(g.winVsExpertHi! * 100)})` : ''}` : undefined)}
            ref={{ value: 0.25, label: 'fair share' }}
            fmt={(v) => `${Math.round(v * 100)}%`}
            domain={[0, 1]}
            label="Win rate against random play and today's Expert by generation"
          />
        </section>
      </div>
      <section className="lab-card">
        <h2>How it plays</h2>
        <p className="lab-note">Per game, in its matches against the champion.</p>
        <div className="lab-table-wrap">
          <table className="lab-table">
            <thead>
              <tr>
                <th />
                {shown.map((g) => (
                  <th key={g.gen}>Gen {g.gen}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Turns in a game</td>
                {shown.map((g) => (
                  <td key={g.gen}>{Math.round(g.turns)}</td>
                ))}
              </tr>
              {keys.map(([k, label, f]) => (
                <tr key={k}>
                  <td>{label}</td>
                  {shown.map((g) => (
                    <td key={g.gen}>{f(g.habits[k])}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  )
}
