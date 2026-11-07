/**
 * Telling the table what happened. Every game event becomes one plain line with the players' colours and the actual
 * cards: who rolled what, who got what, who traded what with whom. The same lines feed three places:
 *   the chronicle (the whole story, down the side), the announcer (the big moments, across the top of the board, for a
 *   moment), and the "+2 grain" that pops up on a player's plaque.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { TOPO } from '../../../shared/board.ts'
import type { GameEvent, View } from '../../../shared/engine.ts'
import { CARD_NAME, PROGRESS, handSize, RESOURCES, TRACK_NAME, type Good, type Hand } from '../../../shared/rules.ts'
import { PLAYER } from '../lib/palette.ts'
import { faceURL } from '../three/table/faces.ts'
import { Bundle, Icon, PieceIcon, Pips } from './Cards.tsx'

export function Who({ view, p, you = true }: { view: View; p: number; you?: boolean }) {
  const pl = view.players[p]
  return (
    <span className="who" style={{ ['--pc' as string]: PLAYER[pl.color].ui }}>
      {you && p === view.you ? 'You' : pl.name}
    </span>
  )
}

const one = (r: Good, n = 1): Partial<Hand> => ({ [r]: n })
const TERRAIN_WORD: Record<string, string> = { forest: 'forest', hills: 'hills', pasture: 'pasture', fields: 'fields', mountains: 'mountains', desert: 'desert' }

/** one event as a line of words and pictures; null for ones not worth a line */
/** (a played card's name can be tapped, where the line is shown with somewhere to show the card) */
export function describe(view: View, e: GameEvent, onCard?: (e: GameEvent) => void): ReactNode | null {
  const card = (name: string) =>
    onCard ? (
      <button className="card-link" onClick={() => onCard(e)}>
        {name}
      </button>
    ) : (
      <b>{name}</b>
    )
  const W = (p: number) => <Who view={view} p={p} />
  switch (e.k) {
    case 'roll':
      return (
        <>
          {W(e.p)} rolled <Pips v={e.dice[0]} size={15} />
          <Pips v={e.dice[1]} size={15} /> <b className="big-num">{e.dice[0] + e.dice[1]}</b>
          {e.event && <span className="muted"> · {e.event === 'ship' ? 'ship' : TRACK_NAME[e.event]}</span>}
        </>
      )
    case 'gain':
      if (!e.gains.length) return <span className="muted">No yield</span>
      return (
        <span className="gains">
          {e.gains.map((g) => (
            <span key={g.p} className="gain">
              {W(g.p)} <span className="plus">+</span>
              <Bundle of={g.got} />
            </span>
          ))}
          {e.short?.length ? <span className="muted"> (bank out: {e.short.join(', ')})</span> : null}
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
          <PieceIcon what="card" size={16} color="#6f5bc4" /> {W(e.p)} bought a card
        </>
      )
    case 'play':
      return (
        <>
          {W(e.p)} played {card(CARD_NAME[e.card])}
        </>
      )
    case 'monopoly':
      return (
        <>
          {W(e.p)} took all <Icon r={e.r} size={15} /> <b>{e.count}</b>
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
          {W(e.p)} traded <Bundle of={one(e.give, e.count)} /> <span className="arrow">→</span> <Bundle of={one(e.get)} /> (bank)
        </>
      )
    case 'offer':
      return (
        <>
          {handSize(e.give) ? (
            <>
              {W(e.p)} offered <Bundle of={e.give} /> for <Bundle of={e.get} />
            </>
          ) : (
            <>
              {W(e.p)} asked for <Bundle of={e.get} />
            </>
          )}
          {e.to !== undefined && <> to {W(e.to)}</>}
        </>
      )
    case 'answer':
      return (
        <>
          {W(e.p)} {e.yes ? <b className="yes">✓</b> : <span className="no">✕</span>}
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
              discard half
            </>
          ) : (
            'Robber'
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
          {W(e.p)} robber → {TERRAIN_WORD[t.terrain]}
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
        <>{e.what === 'road' ? 'Longest Road' : 'Largest Army'}: nobody</>
      ) : (
        <>
          {W(e.p)} took <b className="award-word">{e.what === 'road' ? 'Longest Road' : 'Largest Army'}</b> (+2)
          {e.was !== null && <> from {W(e.was)}</>}
        </>
      )
    case 'barbarians':
      return e.at >= 7 ? <>Barbarians attack!</> : <>Ship {e.at}/7</>
    case 'attack': {
      const strength = e.strength
      const defense = e.defense.reduce((a, b) => a + b, 0)
      if (e.won)
        return (
          <>
            Barbarians {strength} vs knights {defense}: held
            {e.defender !== null ? <> · {W(e.defender)} +1</> : e.tied.length ? <> · {e.tied.map((p, i) => <span key={p}>{i > 0 && ', '}{W(p)}</span>)} draw a card</> : null}
          </>
        )
      return (
        <>
          Barbarians {strength} vs knights {defense}: lost
          {e.pillaged.length > 0 && (
            <>
              : {e.pillaged.map((x, i) => (
                <span key={i}>
                  {i > 0 && ', '}
                  {W(x.p)} −{x.wall ? 'wall' : 'city'}
                </span>
              ))}
            </>
          )}
        </>
      )
    }
    case 'draw':
      return (
        <>
          {W(e.p)} drew {TRACK_NAME[e.track].toLowerCase()}{e.card && (e.p === view.you || e.card === 'townCharter' || e.card === 'press') ? <>: <b>{PROGRESS[e.card].name}</b></> : null}
        </>
      )
    case 'improve':
      return (
        <>
          {W(e.p)} {TRACK_NAME[e.track]} <b>{e.level}</b>
        </>
      )
    case 'metropolis':
      return (
        <>
          {W(e.p)} <b className="award-word">{TRACK_NAME[e.track]} metropolis</b> (+2){e.from !== null && <> from {W(e.from)}</>}
        </>
      )
    case 'knight': {
      const str = e.level ? ` (${['', 'basic', 'strong', 'mighty'][e.level]})` : ''
      const what = {
        build: 'built a knight',
        promote: 'upgraded a knight',
        activate: 'activated a knight',
        move: 'moved a knight',
        displace: 'displaced',
        chase: 'chased the robber',
        lost: 'lost a knight',
      }[e.what]
      return (
        <>
          {W(e.p)} {what}
          {e.what === 'displace' && e.victim !== undefined ? <> {W(e.victim)}</> : str}
        </>
      )
    }
    case 'wall':
      return <>{W(e.p)} built a city wall</>
    case 'progress':
      return (
        <>
          {W(e.p)} played {card(PROGRESS[e.card].name)}
        </>
      )
    case 'merchant':
      return <>{W(e.p)} moved the trader</>
    case 'take':
      return (
        <>
          {W(e.p)} took {e.what === 'progress' ? (e.card && (e.p === view.you || e.from === view.you) ? <b>{PROGRESS[e.card].name}</b> : 'a progress card') : e.what ? <Bundle of={one(e.what, e.count)} /> : <b>{e.count}</b>}
          {!e.what || e.what === 'progress' ? (e.what === 'progress' ? '' : ' card' + (e.count === 1 ? '' : 's')) : ''} from {W(e.from)}
        </>
      )
    case 'snatch':
      return e.thief >= 0 ? (
        <>
          {W(e.thief)} pinched {e.r ? <Bundle of={one(e.r)} /> : 'a card'} from {W(e.victim)}
        </>
      ) : (
        <>A card went missing: {e.r ? <Bundle of={one(e.r)} /> : 'a card'}</>
      )
    case 'caught':
      return e.r ? (
        <>
          {W(e.thief)} gave {W(e.victim)} <Bundle of={one(e.r)} />
        </>
      ) : (
        <>
          {W(e.thief)} caught stealing from {W(e.victim)}!
        </>
      )
    case 'pillage':
      return (
        <>
          {W(e.p)} −{e.wall ? 'wall' : 'city'}
        </>
      )
    case 'swap':
      // (the tiles as they are now: each holds the other's old number)
      return (
        <>
          {W(e.p)} swapped <b>{view.tiles[e.b].number}</b> ({TERRAIN_WORD[view.tiles[e.a].terrain]}) ⇄ <b>{view.tiles[e.a].number}</b> ({TERRAIN_WORD[view.tiles[e.b].terrain]})
        </>
      )
    case 'unroad':
      return (
        <>
          {W(e.p)} took up a road of {W(e.owner)}
        </>
      )
    case 'aqueduct':
      return (
        <>
          {W(e.p)} +<Bundle of={one(e.r)} /> (aqueduct)
        </>
      )
    case 'turn':
      return null
    case 'win':
      return (
        <>
          {W(e.p)} wins · <b>{e.points}</b>
        </>
      )
  }
}

/** the whole story, newest at the bottom, a rule between turns */
export function Chronicle({ view, onCard }: { view: View; onCard?: (e: GameEvent) => void }) {
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
            const line = e.k === 'answer' ? null : describe(view, e, onCard)
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

/** which moments flash up: what others do that changes the table (rolls have their own flash) */
const HEADLINE = new Set<GameEvent['k']>(['trade', 'steal', 'seven', 'monopoly', 'award', 'bank', 'build', 'play', 'plenty', 'progress', 'metropolis', 'attack', 'robber', 'take', 'unroad', 'swap', 'wall', 'knight', 'improve', 'pillage', 'caught'])
const actor = (e: GameEvent): number | null => ('p' in e && typeof e.p === 'number' ? e.p : e.k === 'trade' ? e.from : e.k === 'steal' ? e.thief : null)

/** what others just did, one short flash at a time over the board (your own moves you saw yourself) */
export function Announcer({ view }: { view: View }) {
  const seen = useRef(view.events[view.events.length - 1]?.n ?? -1)
  const [queue, setQueue] = useState<GameEvent[]>([])
  const [now, setNow] = useState<GameEvent | null>(null)
  useEffect(() => {
    const fresh = view.events.filter((e) => e.n > seen.current)
    if (!fresh.length) return
    seen.current = fresh[fresh.length - 1].n
    const keep = fresh.filter((e) => HEADLINE.has(e.k) && !(e.k === 'build' && e.free) && (actor(e) !== view.you || e.k === 'attack'))
    if (keep.length) setQueue((q) => [...q, ...keep].slice(-4))
  }, [view.events, view.you])
  useEffect(() => {
    if (now || !queue.length) return
    setNow(queue[0])
    setQueue((q) => q.slice(1))
  }, [now, queue])
  useEffect(() => {
    if (!now) return
    // (a card played stays up longer: there's a card to read)
    const card = now.k === 'play' || now.k === 'progress'
    const t = setTimeout(() => setNow(null), card ? (queue.length ? 1800 : 2600) : queue.length ? 1000 : 1700)
    return () => clearTimeout(t)
  }, [now, queue.length])
  if (!now) return null
  const line = describe(view, now)
  if (!line) return null
  // a card played: the card itself, big, with who played it
  if (now.k === 'play' || now.k === 'progress')
    return (
      <div className="announcer card-flash" key={now.n}>
        <img src={faceURL(now.k === 'play' ? `dev:${now.card}` : `prog:${now.card}`)} alt="" />
        <div>{line}</div>
      </div>
    )
  return (
    <div className={`announcer ${now.k}`} key={now.n}>
      {line}
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
