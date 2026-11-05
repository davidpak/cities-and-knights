/**
 * Telling the table what happened. Every game event becomes one plain line with the players' colours and the actual
 * cards: who rolled what, who got what, who traded what with whom. The same lines feed three places:
 *   the chronicle (the whole story, down the side), the announcer (the big moments, across the top of the board, for a
 *   moment), and the "+2 grain" that pops up on a player's plaque.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { TOPO } from '../../../shared/board.ts'
import type { GameEvent, View } from '../../../shared/engine.ts'
import { CARD_NAME, RESOURCES, type Hand, type Resource } from '../../../shared/rules.ts'
import { PLAYER, RESOURCE_NAME } from '../lib/palette.ts'
import { Bundle, Icon, PieceIcon, Pips } from './Cards.tsx'

export function Who({ view, p, you = true }: { view: View; p: number; you?: boolean }) {
  const pl = view.players[p]
  return (
    <span className="who" style={{ ['--pc' as string]: PLAYER[pl.color].ui }}>
      {you && p === view.you ? 'You' : pl.name}
    </span>
  )
}

const one = (r: Resource, n = 1): Partial<Hand> => ({ [r]: n })
const TERRAIN_WORD: Record<string, string> = { forest: 'forest', hills: 'hills', pasture: 'pasture', fields: 'fields', mountains: 'mountains', desert: 'desert' }

/** one event as a line of words and pictures; null for ones not worth a line */
export function describe(view: View, e: GameEvent): ReactNode | null {
  const W = (p: number) => <Who view={view} p={p} />
  switch (e.k) {
    case 'roll':
      return (
        <>
          {W(e.p)} rolled <Pips v={e.dice[0]} size={15} />
          <Pips v={e.dice[1]} size={15} /> <b className="big-num">{e.dice[0] + e.dice[1]}</b>
        </>
      )
    case 'gain':
      if (!e.gains.length) return <span className="muted">Nobody collects anything.</span>
      return (
        <span className="gains">
          {e.gains.map((g) => (
            <span key={g.p} className="gain">
              {W(g.p)} <span className="plus">+</span>
              <Bundle of={g.got} />
            </span>
          ))}
          {e.short?.length ? <span className="muted"> (the bank ran out of {e.short.join(', ')})</span> : null}
        </span>
      )
    case 'build': {
      const what = e.what === 'road' ? 'a road' : e.what === 'city' ? 'a city' : 'a settlement'
      const hex = e.what !== 'road' ? TOPO.vertices[e.at].hexes : TOPO.edges[e.at].hexes
      const on = hex.map((h) => view.tiles[h]).filter((t) => t.number !== null)
      return (
        <>
          <PieceIcon what={e.what} size={16} color={PLAYER[view.players[e.p].color].ui} /> {W(e.p)} built {what}
          {e.what !== 'road' && on.length > 0 && <span className="muted"> on {on.map((t) => `${TERRAIN_WORD[t.terrain]} ${t.number}`).join(', ')}</span>}
        </>
      )
    }
    case 'buy':
      return (
        <>
          <PieceIcon what="card" size={16} color="#6f5bc4" /> {W(e.p)} bought a development card
        </>
      )
    case 'play':
      return (
        <>
          {W(e.p)} played <b>{CARD_NAME[e.card]}</b>
        </>
      )
    case 'monopoly':
      return (
        <>
          {W(e.p)} took every <Icon r={e.r} size={15} /> {RESOURCE_NAME[e.r].toLowerCase()}: <b>{e.count}</b> in all
        </>
      )
    case 'plenty':
      return (
        <>
          {W(e.p)} took <Bundle of={e.take.reduce<Partial<Hand>>((h, r) => ({ ...h, [r]: (h[r] ?? 0) + 1 }), {})} /> from the bank
        </>
      )
    case 'bank':
      return (
        <>
          {W(e.p)} traded <Bundle of={one(e.give, e.count)} /> <span className="arrow">→</span> <Bundle of={one(e.get)} /> with the bank
        </>
      )
    case 'offer':
      return (
        <>
          {W(e.p)} offers <Bundle of={e.give} /> for <Bundle of={e.get} />
        </>
      )
    case 'answer':
      return (
        <>
          {W(e.p)} {e.yes ? <b className="yes">said yes</b> : <span className="no">said no</span>}
        </>
      )
    case 'trade':
      return (
        <span className="trade-line">
          {W(e.from)} <span className="arrow">⇄</span> {W(e.to)}: <Bundle of={e.give} /> <span className="arrow">for</span> <Bundle of={e.get} />
        </span>
      )
    case 'seven': {
      const who = Object.keys(e.discards).map(Number)
      return (
        <>
          <b className="seven">7!</b> {who.length ? (
            <>
              {who.map((p, i) => (
                <span key={p}>
                  {i > 0 && ', '}
                  {W(p)}
                </span>
              ))}{' '}
              must discard half
            </>
          ) : (
            'The robber moves'
          )}
        </>
      )
    }
    case 'discard':
      return (
        <>
          {W(e.p)} discarded <b>{e.count}</b>
        </>
      )
    case 'robber': {
      const t = view.tiles[e.hex]
      return (
        <>
          {W(e.p)} moved the robber to {TERRAIN_WORD[t.terrain]}
          {t.number !== null ? ` ${t.number}` : ''}
        </>
      )
    }
    case 'steal':
      return (
        <>
          {W(e.thief)} stole {e.r ? <Bundle of={one(e.r)} /> : 'a card'} from {W(e.victim)}
        </>
      )
    case 'award':
      return e.p === null ? (
        <>Nobody holds {e.what === 'road' ? 'Longest Road' : 'Largest Army'} now</>
      ) : (
        <>
          {W(e.p)} took <b className="award-word">{e.what === 'road' ? 'Longest Road' : 'Largest Army'}</b> (+2)
          {e.was !== null && <> from {W(e.was)}</>}
        </>
      )
    case 'turn':
      return null
    case 'win':
      return (
        <>
          {W(e.p)} won with <b>{e.points}</b> points!
        </>
      )
  }
}

/** the whole story, newest at the bottom, a rule between turns */
export function Chronicle({ view }: { view: View }) {
  const ref = useRef<HTMLDivElement>(null)
  const last = view.events[view.events.length - 1]?.n
  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight, behavior: 'smooth' })
  }, [last])
  return (
    <div className="chronicle" ref={ref}>
      {view.events.map((e) =>
        e.k === 'turn' ? (
          <div key={e.n} className="turn-rule" style={{ ['--pc' as string]: PLAYER[view.players[e.p].color].ui }}>
            <span>{e.p === view.you ? 'Your turn' : `${view.players[e.p].name}'s turn`}</span>
          </div>
        ) : (
          (() => {
            // answers to an offer show live on the mat and the plaques; the story keeps the offer and the trade
            const line = e.k === 'answer' ? null : describe(view, e)
            return line ? (
              <div key={e.n} className={`entry e-${e.k}`}>
                {line}
              </div>
            ) : null
          })()
        ),
      )}
    </div>
  )
}

/** which moments get the big headline: everything that changes the table, said once, in order */
const HEADLINE = new Set<GameEvent['k']>(['roll', 'trade', 'steal', 'seven', 'monopoly', 'award', 'win', 'bank', 'build', 'play', 'plenty'])

/** new events since you arrived, one headline at a time across the top of the board */
export function Announcer({ view }: { view: View }) {
  const seen = useRef(view.events[view.events.length - 1]?.n ?? -1)
  const [queue, setQueue] = useState<GameEvent[]>([])
  const [now, setNow] = useState<GameEvent | null>(null)
  useEffect(() => {
    const fresh = view.events.filter((e) => e.n > seen.current)
    if (!fresh.length) return
    seen.current = fresh[fresh.length - 1].n
    // setup placements and your own building don't need a headline; a roll and what it paid are shown together
    const keep = fresh.filter((e) => HEADLINE.has(e.k) && !(e.k === 'build' && (e.free || e.p === view.you)) && !(e.k === 'bank' && e.p === view.you))
    if (keep.length) setQueue((q) => [...q, ...keep].slice(-6))
  }, [view.events, view.you])
  useEffect(() => {
    if (now || !queue.length) return
    setNow(queue[0])
    setQueue((q) => q.slice(1))
  }, [now, queue])
  useEffect(() => {
    if (!now) return
    const t = setTimeout(() => setNow(null), queue.length > 1 ? 1100 : 2000)
    return () => clearTimeout(t)
  }, [now, queue.length])
  if (!now) return null
  // a roll's headline carries what it paid out
  const gain = now.k === 'roll' ? view.events.find((e) => e.n === now.n + 1 && e.k === 'gain') : undefined
  return (
    <div className={`announcer ${now.k}`} key={now.n}>
      <div className="announce-line">{describe(view, now)}</div>
      {gain && <div className="announce-sub">{describe(view, gain)}</div>}
    </div>
  )
}

/** "+2 [grain]" that floats up from a player's plaque when they get cards (and "−1" when one is taken) */
export function useGains(view: View, p: number) {
  const seen = useRef(view.events[view.events.length - 1]?.n ?? -1)
  const [pops, setPops] = useState<{ id: number; got: Partial<Hand>; sign: 1 | -1 }[]>([])
  useEffect(() => {
    const fresh = view.events.filter((e) => e.n > seen.current)
    if (!fresh.length) return
    seen.current = fresh[fresh.length - 1].n
    const add: { id: number; got: Partial<Hand>; sign: 1 | -1 }[] = []
    for (const e of fresh) {
      if (e.k === 'gain') for (const g of e.gains) if (g.p === p) add.push({ id: e.n, got: g.got, sign: 1 })
      if (e.k === 'trade' && (e.from === p || e.to === p)) add.push({ id: e.n, got: e.from === p ? e.get : e.give, sign: 1 })
      if (e.k === 'bank' && e.p === p) add.push({ id: e.n, got: { [e.get]: 1 }, sign: 1 })
      if (e.k === 'plenty' && e.p === p) add.push({ id: e.n, got: e.take.reduce<Partial<Hand>>((h, r) => ({ ...h, [r]: (h[r] ?? 0) + 1 }), {}), sign: 1 })
      if (e.k === 'monopoly' && e.p === p && e.count) add.push({ id: e.n, got: { [e.r]: e.count }, sign: 1 })
      if (e.k === 'steal' && e.thief === p && e.r) add.push({ id: e.n, got: { [e.r]: 1 }, sign: 1 })
      if (e.k === 'steal' && e.victim === p && e.r) add.push({ id: e.n, got: { [e.r]: 1 }, sign: -1 })
    }
    if (!add.length) return
    setPops((x) => [...x, ...add])
    const ids = add.map((a) => a.id)
    const t = setTimeout(() => setPops((x) => x.filter((q) => !ids.includes(q.id))), 2200)
    return () => clearTimeout(t)
  }, [view.events, p])
  return pops
}

export function GainPops({ view, p }: { view: View; p: number }) {
  const pops = useGains(view, p)
  return (
    <div className="pops">
      {pops.map((g) => (
        <span key={`${g.id}${g.sign}`} className={`pop ${g.sign < 0 ? 'loss' : ''}`}>
          {g.sign < 0 ? '−' : '+'}
          <Bundle of={g.got} />
        </span>
      ))}
    </div>
  )
}

export const RESOURCE_ORDER = RESOURCES
