/**
 * The end of the game, in numbers: how the dice fell (each total against what two dice should give), a few
 * headlines, and everything each player did, side by side.
 */
import { useState } from 'react'
import type { View } from '../../../shared/engine.ts'
import { handSize } from '../../../shared/rules.ts'
import type { PlayerStats, Stats } from '../../../shared/stats.ts'
import { PLAYER } from '../lib/palette.ts'
import { Bundle } from './Cards.tsx'
import { Who } from './Chronicle.tsx'

/** how many of 36 throws of two dice make each total */
const WAYS: Record<number, number> = { 2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 7: 6, 8: 5, 9: 4, 10: 3, 11: 2, 12: 1 }
const TOTALS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]

/** the dice: one bar per total; a dashed tick where two fair dice would put it; hover for the numbers */
function DiceChart({ rolls }: { rolls: number[] }) {
  const n = TOTALS.reduce((a, t) => a + rolls[t], 0)
  const [hover, setHover] = useState<number | null>(null)
  const max = Math.max(1, ...TOTALS.map((t) => Math.max(rolls[t], (n * WAYS[t]) / 36)))
  const top = TOTALS.reduce((a, t) => (rolls[t] > rolls[a] ? t : a), 2)
  return (
    <div className="dice-chart" role="img" aria-label={`Dice totals over ${n} rolls`}>
      <div className="dc-plot">
        {TOTALS.map((t) => {
          const exp = (n * WAYS[t]) / 36
          return (
            <div key={t} className={`dc-col ${hover === t ? 'on' : ''}`} onPointerEnter={() => setHover(t)} onPointerLeave={() => setHover((h) => (h === t ? null : h))}>
              {/* (the most rolled total is labelled; any other on hover) */}
              {(t === top || hover === t) && (
                <span className="dc-val" style={{ bottom: `calc(${(Math.max(rolls[t], exp) / max) * 100}% + 3px)` }}>
                  {rolls[t]}
                </span>
              )}
              <span className="dc-bar" style={{ height: `${(rolls[t] / max) * 100}%` }} />
              <span className="dc-exp" style={{ bottom: `${(exp / max) * 100}%` }} />
              {hover === t && (
                <span className="dc-tip">
                  <b>{t}</b>: {rolls[t]} of {n} ({n ? Math.round((rolls[t] / n) * 100) : 0}%)
                  <br />
                  fair dice: {exp.toFixed(1)}
                </span>
              )}
            </div>
          )
        })}
      </div>
      <div className="dc-axis">
        {TOTALS.map((t) => (
          <span key={t} className={t === 6 || t === 8 ? 'red' : ''}>
            {t}
          </span>
        ))}
      </div>
      <div className="dc-key">
        <i className="dc-key-bar" /> rolled <i className="dc-key-exp" /> fair dice · {n} rolls
      </div>
    </div>
  )
}

type Row = { label: string; get: (p: PlayerStats) => number | React.ReactNode; n?: (p: PlayerStats) => number; x?: boolean; base?: boolean }

export function GameStats({ view }: { view: View }) {
  const st = (view as View & { stats?: Stats }).stats
  if (!st) return null
  const x = !!view.x
  const P = st.players
  const total = (p: PlayerStats) => handSize(p.produced)
  // headlines: who stood out (a tie, or nothing at all, isn't a headline)
  const best = (f: (p: PlayerStats) => number) => {
    const v = P.map(f)
    const m = Math.max(...v)
    return m > 0 && v.filter((y) => y === m).length === 1 ? { p: v.indexOf(m), v: m } : null
  }
  const heads = [
    ['Luckiest', best(total), 'cards from rolls'],
    ['Biggest roll', best((p) => p.bestRoll), 'cards at once'],
    ['Top trader', best((p) => p.trades), 'trades'],
    ['Light fingers', best((p) => p.stole), 'cards taken'],
    ['Most robbed', best((p) => p.lost), 'cards lost'],
    ...(x ? [['Defender', best((p) => p.defended), 'times'] as const] : []),
  ].filter((h) => h[1]) as [string, { p: number; v: number }, string][]
  const rows: Row[] = [
    { label: 'Cards from rolls', get: (p) => total(p), n: total },
    { label: '…of each', get: (p) => <span className="gs-each"><Bundle of={p.produced} empty="–" /></span>, n: total },
    { label: 'Biggest roll', get: (p) => p.bestRoll, n: (p) => p.bestRoll },
    { label: 'Rolls with nothing', get: (p) => p.dryRolls, n: (p) => p.dryRolls },
    { label: 'Times rolled', get: (p) => p.rolled, n: (p) => p.rolled },
    { label: '7s rolled', get: (p) => p.sevens, n: (p) => p.sevens },
    { label: 'Roads built', get: (p) => p.roads, n: (p) => p.roads },
    { label: 'Settlements built', get: (p) => p.settlements, n: (p) => p.settlements },
    { label: 'Cities built', get: (p) => p.cities, n: (p) => p.cities },
    { label: 'City walls', get: (p) => p.walls, n: (p) => p.walls, x: true },
    { label: 'Improvements', get: (p) => p.improvements, n: (p) => p.improvements, x: true },
    { label: 'Metropolises', get: (p) => p.metropolises, n: (p) => p.metropolises, x: true },
    { label: 'Knights built', get: (p) => p.knightsBuilt, n: (p) => p.knightsBuilt, x: true },
    { label: 'Knights upgraded', get: (p) => p.knightsUpgraded, n: (p) => p.knightsUpgraded, x: true },
    { label: 'Knights activated', get: (p) => p.knightsReadied, n: (p) => p.knightsReadied, x: true },
    { label: 'Knight moves', get: (p) => p.knightMoves, n: (p) => p.knightMoves, x: true },
    { label: 'Barbarians held off', get: (p) => p.defended, n: (p) => p.defended, x: true },
    { label: 'Cities lost', get: (p) => p.pillaged, n: (p) => p.pillaged, x: true },
    { label: 'Progress cards drawn', get: (p) => p.progressDrawn, n: (p) => p.progressDrawn, x: true },
    { label: 'Progress cards played', get: (p) => p.progressPlayed, n: (p) => p.progressPlayed, x: true },
    { label: 'Waterworks picks', get: (p) => p.aqueduct, n: (p) => p.aqueduct, x: true },
    { label: 'Development cards bought', get: (p) => p.devBought, n: (p) => p.devBought, base: true },
    { label: 'Development cards played', get: (p) => p.devPlayed, n: (p) => p.devPlayed, base: true },
    { label: 'Knights played', get: (p) => p.knightCards, n: (p) => p.knightCards, base: true },
    { label: 'Trades with players', get: (p) => p.trades, n: (p) => p.trades },
    { label: 'Cards traded away / in', get: (p) => `${p.tradedAway} / ${p.tradedIn}`, n: (p) => p.tradedAway + p.tradedIn },
    { label: 'Bank trades', get: (p) => p.bankTrades, n: (p) => p.bankTrades },
    { label: 'Cards paid to the bank', get: (p) => p.bankPaid, n: (p) => p.bankPaid },
    { label: 'Cards taken from others', get: (p) => p.stole, n: (p) => p.stole },
    { label: 'Cards lost to others', get: (p) => p.lost, n: (p) => p.lost },
    { label: 'Sneaked away with', get: (p) => p.snatched, n: (p) => p.snatched },
    { label: 'Caught sneaking', get: (p) => p.caught, n: (p) => p.caught },
    { label: 'Cards discarded', get: (p) => p.discarded, n: (p) => p.discarded },
    { label: 'Robber moved', get: (p) => p.robberMoves, n: (p) => p.robberMoves },
  ]
  // only what this game had, and only rows where something happened
  const shown = rows.filter((r) => (x ? !r.base : !r.x) && P.some((p) => (r.n ? r.n(p) : 1) > 0))
  return (
    <div className="game-stats">
      {heads.length > 0 && (
        <div className="gs-heads">
          {heads.map(([title, h, unit]) => (
            <div key={title} className="gs-head" style={{ ['--pc' as string]: PLAYER[view.players[h.p].color].ui }}>
              <span className="gs-title">{title}</span>
              <Who view={view} p={h.p} />
              <span className="gs-num">
                <b>{h.v}</b> {h.v === 1 ? unit.replace(/^(\w+?)s\b/, '$1') : unit}
              </span>
            </div>
          ))}
        </div>
      )}
      <h4>Dice</h4>
      <DiceChart rolls={st.rolls} />
      {x && st.attacks > 0 && <p className="gs-note">Barbarian attacks: {st.attacks}</p>}
      <h4>Players</h4>
      <div className="gs-table-wrap">
        <table className="gs-table">
          <thead>
            <tr>
              <th />
              {view.players.map((_, i) => (
                <th key={i}>
                  <Who view={view} p={i} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Points</td>
              {view.players.map((p, i) => (
                <td key={i}>
                  <b>{p.points}</b>
                </td>
              ))}
            </tr>
            {shown.map((r) => (
              <tr key={r.label}>
                <td>{r.label}</td>
                {P.map((p, i) => (
                  <td key={i}>{r.get(p)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
