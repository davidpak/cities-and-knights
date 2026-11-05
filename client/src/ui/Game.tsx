/**
 * The table. Everyone sits round it:
 *   across the top, the other players' plaques (points, cards in hand, what they just got)
 *   in the middle, the board, with the dice in their tray, and the big moments announced across its top
 *   down the side, the chronicle: the whole story, line by line
 *   along the bottom, your seat: what to do now, your hand fanned out, and your moves
 * When you trade, the trade mat rises out of your hand; when someone offers you a trade, a slip appears there.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { affordable, canPlay, citySpots, roadSpots, robberSpots, settlementSpots, type View } from '../../../shared/engine.ts'
import { CARDS, COST, RESOURCES, emptyHand, handSize, type Card, type Hand, type Resource } from '../../../shared/rules.ts'
import { CARD_ICON } from '../lib/icons.ts'
import { PLAYER } from '../lib/palette.ts'
import { act, room, useStore } from '../net.ts'
import { BoardView, type PickKind, type Picking } from '../three/Board.tsx'
import { publishState } from '../three/TestHook.tsx'
import { Backs, CardRow, Cost, DevCard, PieceIcon, ResourceCard } from './Cards.tsx'
import { Announcer, Chronicle, GainPops, Who } from './Chronicle.tsx'
import { add, OfferSlip, TradeMat, type Trade } from './Trade.tsx'

type Mode = 'road' | 'settlement' | 'city' | null
const minus = (a: Hand, b: Hand): Hand => Object.fromEntries(RESOURCES.map((r) => [r, a[r] - b[r]])) as Hand

export function Game({ view }: { view: View }) {
  const { toast } = useStore()
  const me = view.you
  const mine = me >= 0 && view.current === me
  const ph = view.phase
  const [mode, setMode] = useState<Mode>(null)
  const [trade, setTrade] = useState<Trade | null>(null)
  const [story, setStory] = useState(false) // the chronicle, on small screens
  const colors = view.players.map((p) => p.color)
  const canTrade = mine && ph.kind === 'main'
  const myOffer = view.offer?.from === me

  useEffect(() => {
    if (!mine || ph.kind !== 'main') setMode(null)
    if (!canTrade) setTrade(null)
  }, [mine, ph.kind, canTrade])
  // your own offer reopens the mat (to see the answers), and closes it when the trade is done
  useEffect(() => {
    if (myOffer) setTrade((t) => t ?? { give: emptyHand(), get: emptyHand() })
  }, [myOffer])
  const lastOffer = useRef(myOffer)
  useEffect(() => {
    if (lastOffer.current && !myOffer) setTrade(null)
    lastOffer.current = myOffer
  }, [myOffer])

  const picking: Picking = useMemo(() => {
    if (!mine) return null
    if (ph.kind === 'setup') return ph.step === 'settlement' ? { kind: 'settlement', spots: settlementSpots(view, me) } : { kind: 'road', spots: roadSpots(view, me) }
    if (ph.kind === 'roadBuilding') return { kind: 'road', spots: roadSpots(view, me) }
    if (ph.kind === 'robber') return { kind: 'robber', spots: robberSpots(view) }
    if (ph.kind === 'main' && mode === 'road') return { kind: 'road', spots: roadSpots(view, me) }
    if (ph.kind === 'main' && mode === 'settlement') return { kind: 'settlement', spots: settlementSpots(view, me) }
    if (ph.kind === 'main' && mode === 'city') return { kind: 'city', spots: citySpots(view, me) }
    return null
  }, [mine, ph, mode, view, me])

  useEffect(() => publishState({ view, picking }), [view, picking])

  const onPick = async (kind: PickKind, id: number) => {
    if (kind === 'robber') await act({ type: 'moveRobber', hex: id })
    else if (kind === 'road') await act({ type: 'buildRoad', edge: id })
    else if (kind === 'settlement') await act({ type: 'buildSettlement', vertex: id })
    else await act({ type: 'buildCity', vertex: id })
    setMode(null)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return
      if (e.key === 'Escape') {
        setMode(null)
        if (!myOffer) setTrade(null)
      }
      if (!mine) return
      if (e.key.toLowerCase() === 'r' && ph.kind === 'roll') act({ type: 'roll' })
      if (e.key.toLowerCase() === 'e' && ph.kind === 'main') act({ type: 'endTurn' })
      if (e.key.toLowerCase() === 't' && ph.kind === 'main') setTrade((t) => (t ? null : { give: emptyHand(), get: emptyHand() }))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [mine, ph.kind, myOffer])

  // the dice keep showing the last throw (the state forgets it at a new turn)
  const lastRoll = [...view.events].reverse().find((e) => e.k === 'roll')
  const dice = view.dice ?? (lastRoll?.k === 'roll' ? lastRoll.dice : null)

  const hand = me >= 0 ? view.players[me].hand : null
  const shown = hand && trade && !myOffer ? minus(hand, trade.give) : hand
  const opponents = view.players.map((_, i) => i).filter((i) => i !== me)

  return (
    <div className={`table ${story ? 'story-open' : ''}`}>
      <header className="seats">
        {opponents.map((i) => (
          <Plaque key={i} view={view} p={i} />
        ))}
        <button className="story-toggle stamp-btn" onClick={() => setStory((s) => !s)}>
          {story ? 'Board' : 'Story'}
        </button>
      </header>

      <main className="board-area">
        <BoardView
          tiles={view.tiles}
          harbors={view.harbors}
          buildings={view.buildings}
          roads={view.roads}
          robber={view.robber}
          colors={colors}
          picking={picking}
          you={me}
          onPick={onPick}
          dice={dice}
          rolls={view.rolls}
          onRoll={mine && ph.kind === 'roll' ? () => act({ type: 'roll' }) : undefined}
          events={view.events}
        />
        <Announcer view={view} />
        {trade && hand && <TradeMat view={view} trade={trade} setTrade={setTrade} close={() => setTrade(null)} />}
        {!trade && <OfferSlip view={view} />}
      </main>

      <aside className="story">
        <div className="story-head">The story so far</div>
        <Chronicle view={view} />
      </aside>

      {me >= 0 && shown && (
        <footer className="my-seat" style={{ ['--pc' as string]: PLAYER[view.players[me].color].ui }}>
          <Prompt view={view} mode={mode} trading={!!trade} />
          <div className="seat-row">
            <MyPlaque view={view} />
            <div className="hand">
              <CardRow
                hand={shown}
                all
                fan
                onPick={trade && !myOffer ? (r) => setTrade({ ...trade, give: add(trade.give, r, 1) }) : undefined}
              />
              <MyCards view={view} />
            </div>
            <Moves view={view} mode={mode} setMode={setMode} trading={!!trade} toggleTrade={() => setTrade(trade ? null : { give: emptyHand(), get: emptyHand() })} />
          </div>
        </footer>
      )}

      {me >= 0 && <Dialogs view={view} />}
      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}

// ---------------------------------------------------------------- the plaques

function Plaque({ view, p }: { view: View; p: number }) {
  const { room: info } = useStore()
  const pl = view.players[p]
  const seat = info?.seats.find((s) => s.id === pl.id)
  const turn = view.current === p
  const o = view.offer
  const answer = o && o.from !== p ? (o.accepted.includes(p) ? 'yes' : o.declined.includes(p) ? 'no' : 'thinking') : o?.from === p ? 'offering' : null
  return (
    <div className={`plaque ${turn ? 'turn' : ''}`} style={{ ['--pc' as string]: PLAYER[pl.color].ui }}>
      {turn && <span className="turn-flag">{doing(view)}</span>}
      <div className="plaque-top">
        <span className="pname">
          {pl.name}
          {seat?.bot && <span className="tag">bot</span>}
          {seat && !seat.connected && <span className="tag warn">away</span>}
        </span>
        <span className="vp" title="Victory points">
          {pl.points}
        </span>
      </div>
      <div className="plaque-stats">
        <Backs n={pl.handCount} title="Resource cards in hand" />
        <Backs n={pl.cardCount} kind="dev" title="Development cards" />
        <span className="knights" title="Knights played">
          <svg className="icon" width={15} height={15} viewBox="0 0 24 24" aria-hidden>
            <path d={CARD_ICON.knight} fill="#9c8a74" stroke="#2a1d13" strokeWidth="1.6" />
          </svg>
          {pl.knights}
        </span>
        {view.longestRoad === p && <span className="ribbon" title="Longest Road: +2 points">Road</span>}
        {view.largestArmy === p && <span className="ribbon" title="Largest Army: +2 points">Army</span>}
        {answer && <span className={`answer-chip ${answer}`}>{answer === 'yes' ? 'Yes' : answer === 'no' ? 'No' : answer === 'offering' ? 'Offering' : '…'}</span>}
      </div>
      <GainPops view={view} p={p} />
    </div>
  )
}

/** what the current player is doing, for the flag on their plaque */
function doing(view: View) {
  const ph = view.phase
  switch (ph.kind) {
    case 'setup':
      return `placing a ${ph.step}`
    case 'roll':
      return 'rolling'
    case 'discard':
      return 'waiting for discards'
    case 'robber':
      return 'moving the robber'
    case 'steal':
      return 'stealing'
    case 'roadBuilding':
      return 'building roads'
    case 'main':
      return view.offer ? 'trading' : 'their turn'
    case 'over':
      return 'won!'
  }
}

function MyPlaque({ view }: { view: View }) {
  const me = view.you
  const pl = view.players[me]
  return (
    <div className="plaque mine">
      <div className="plaque-top">
        <span className="pname">{pl.name}</span>
        <span className="vp" title="Victory points (hidden ones included)">
          {pl.points}
        </span>
      </div>
      <div className="plaque-stats pieces-left" title="Pieces left to build">
        <span>
          <PieceIcon what="road" size={15} color={PLAYER[pl.color].ui} /> {pl.pieces.road}
        </span>
        <span>
          <PieceIcon what="settlement" size={15} color={PLAYER[pl.color].ui} /> {pl.pieces.settlement}
        </span>
        <span>
          <PieceIcon what="city" size={15} color={PLAYER[pl.color].ui} /> {pl.pieces.city}
        </span>
        {view.longestRoad === me && <span className="ribbon">Road</span>}
        {view.largestArmy === me && <span className="ribbon">Army</span>}
      </div>
      <GainPops view={view} p={me} />
    </div>
  )
}

// ---------------------------------------------------------------- what to do now

function Prompt({ view, mode, trading }: { view: View; mode: Mode; trading: boolean }) {
  const ph = view.phase
  const mine = view.current === view.you
  const who = <Who view={view} p={view.current} you={false} />
  let text: React.ReactNode
  switch (ph.kind) {
    case 'setup':
      text = mine ? (ph.step === 'settlement' ? 'Place a settlement on one of the white spots' : 'Now place a road next to it') : <>{who} is placing a {ph.step}</>
      break
    case 'roll':
      text = mine ? 'Your turn. Roll the dice (or click them)' : <>{who} is about to roll</>
      break
    case 'discard': {
      const owe = ph.owed[view.you]
      text = owe ? `A 7! You have too many cards: discard ${owe}` : 'A 7! Waiting for discards'
      break
    }
    case 'robber':
      text = mine ? 'Move the robber: click a tile' : <>{who} is moving the robber</>
      break
    case 'steal':
      text = mine ? 'Pick who to steal from' : <>{who} is stealing a card</>
      break
    case 'roadBuilding':
      text = mine ? `Place ${ph.left} free road${ph.left > 1 ? 's' : ''}` : <>{who} is building roads</>
      break
    case 'main':
      text = mine
        ? view.offer?.from === view.you
          ? 'Your offer is out: pick who to trade with, or take it back'
          : trading
            ? 'Trading: give from your hand, pick what you want'
          : mode === 'road'
            ? 'Click a white mark to build a road'
            : mode === 'settlement'
              ? 'Click a white spot to build a settlement'
              : mode === 'city'
                ? 'Click one of your settlements to make it a city'
                : 'Build, trade, or end your turn'
        : <>{who}'s turn</>
      break
    case 'over':
      text = <>{<Who view={view} p={ph.winner} />} won!</>
      break
  }
  return <div className={`prompt ${mine ? 'mine' : ''}`}>{text}</div>
}

// ---------------------------------------------------------------- your hand and moves

function MyCards({ view }: { view: View }) {
  const me = view.you
  const cards = view.players[me].cards ?? []
  const mine = view.current === me
  const ph = view.phase
  const [pick, setPick] = useState<Card | null>(null)
  if (cards.length === 0) return null
  const playable = (c: Card) => mine && c !== 'victoryPoint' && canPlay(view, me, c) && (c === 'knight' ? ph.kind === 'roll' || ph.kind === 'main' : ph.kind === 'main')
  const play = (c: Card) => {
    if (c === 'knight') act({ type: 'playKnight' })
    else if (c === 'roadBuilding') act({ type: 'playRoadBuilding' })
    else setPick(c)
  }
  return (
    <div className="card-row devs">
      {CARDS.filter((c) => cards.some((x) => x.card === c)).map((c) => (
        <DevCard key={c} card={c} n={cards.filter((x) => x.card === c).length} ready={cards.some((x) => x.card === c && x.turn < view.turn)} onPlay={playable(c) ? () => play(c) : undefined} />
      ))}
      {pick === 'yearOfPlenty' && <PlentyDialog view={view} close={() => setPick(null)} />}
      {pick === 'monopoly' && <MonopolyDialog close={() => setPick(null)} />}
    </div>
  )
}

function Moves({ view, mode, setMode, trading, toggleTrade }: { view: View; mode: Mode; setMode: (m: Mode) => void; trading: boolean; toggleTrade: () => void }) {
  const me = view.you
  const p = view.players[me]
  const mine = view.current === me
  const ph = view.phase
  const main = mine && ph.kind === 'main'
  const can = {
    road: main && p.pieces.road > 0 && affordable(view, me, 'road') && roadSpots(view, me).length > 0,
    settlement: main && p.pieces.settlement > 0 && affordable(view, me, 'settlement') && settlementSpots(view, me).length > 0,
    city: main && p.pieces.city > 0 && affordable(view, me, 'city') && citySpots(view, me).length > 0,
    card: main && view.pile > 0 && affordable(view, me, 'card'),
  }
  const toggle = (m: Exclude<Mode, null>) => setMode(mode === m ? null : m)
  const color = PLAYER[p.color].ui
  const blueprint = (label: string, what: 'road' | 'settlement' | 'city' | 'card', cost: Partial<Hand>, onClick: () => void, on = false) => (
    <button className={`blueprint ${on ? 'on' : ''}`} disabled={!can[what] && !on} onClick={onClick} title={`${label}`}>
      <PieceIcon what={what} size={22} color={what === 'card' ? '#6f5bc4' : color} />
      <span className="bp-name">{on ? 'Cancel' : label}</span>
      <Cost of={cost} />
    </button>
  )
  return (
    <div className="moves">
      <div className="blueprints">
        {blueprint('Road', 'road', COST.road, () => toggle('road'), mode === 'road')}
        {blueprint('Settlement', 'settlement', COST.settlement, () => toggle('settlement'), mode === 'settlement')}
        {blueprint('City', 'city', COST.city, () => toggle('city'), mode === 'city')}
        {blueprint('Card', 'card', COST.card, () => act({ type: 'buyCard' }))}
      </div>
      <div className="turn-buttons">
        <button className={`stamp-btn ${trading ? 'on' : ''}`} disabled={!main} onClick={toggleTrade}>
          {trading ? 'Close trade' : 'Trade'} <kbd>T</kbd>
        </button>
        {mine && ph.kind === 'roll' ? (
          <>
            {canPlay(view, me, 'knight') && (
              <button className="stamp-btn" onClick={() => act({ type: 'playKnight' })}>
                Knight first
              </button>
            )}
            <button className="stamp-btn big go" onClick={() => act({ type: 'roll' })}>
              Roll <kbd>R</kbd>
            </button>
          </>
        ) : (
          <button
            className="stamp-btn big go"
            disabled={!main}
            onClick={() => {
              setMode(null)
              act({ type: 'endTurn' })
            }}
          >
            End turn <kbd>E</kbd>
          </button>
        )}
        <button className="link" onClick={() => confirm('Leave this game?') && room.leave()}>
          Leave
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- dialogs (only when the game needs an answer)

function Dialog({ title, children, onClose }: { title: string; children: React.ReactNode; onClose?: () => void }) {
  return (
    <div className="dialog-back">
      <div className="paper dialog">
        <div className="dialog-head">
          {title}
          {onClose && (
            <button className="x" onClick={onClose} aria-label="Close">
              ×
            </button>
          )}
        </div>
        {children}
      </div>
    </div>
  )
}

function Dialogs({ view }: { view: View }) {
  const me = view.you
  const ph = view.phase
  if (ph.kind === 'over') return <GameOver view={view} />
  if (ph.kind === 'discard' && ph.owed[me]) return <DiscardDialog view={view} owe={ph.owed[me]} />
  if (ph.kind === 'steal' && view.current === me) return <StealDialog view={view} victims={ph.victims} />
  return null
}

function DiscardDialog({ view, owe }: { view: View; owe: number }) {
  const hand = view.players[view.you].hand!
  const [pick, setPick] = useState<Hand>(emptyHand())
  const n = handSize(pick)
  return (
    <Dialog title={`A 7! Give back ${owe} cards`}>
      <p className="muted">You hold more than 7. Click cards to put them back.</p>
      <div className="side-label">Your hand</div>
      <CardRow hand={minus(hand, pick)} onPick={n < owe ? (r) => setPick(add(pick, r, 1)) : undefined} />
      <div className="side-label">
        Giving back {n} of {owe}
      </div>
      <div className="slot">{n ? <CardRow hand={pick} onPick={(r) => setPick(add(pick, r, -1))} /> : <span className="hint">none yet</span>}</div>
      <div className="dialog-foot">
        <button className="stamp-btn go" disabled={n !== owe} onClick={() => act({ type: 'discard', cards: pick })}>
          Give them back
        </button>
      </div>
    </Dialog>
  )
}

function StealDialog({ view, victims }: { view: View; victims: number[] }) {
  return (
    <Dialog title="Steal a card from…">
      <div className="victims">
        {victims.map((v) => (
          <button key={v} className="victim" style={{ ['--pc' as string]: PLAYER[view.players[v].color].ui }} onClick={() => act({ type: 'steal', victim: v })}>
            <span className="pname">{view.players[v].name}</span>
            <Backs n={view.players[v].handCount} />
          </button>
        ))}
      </div>
    </Dialog>
  )
}

function PlentyDialog({ view, close }: { view: View; close: () => void }) {
  const [pick, setPick] = useState<Hand>(emptyHand())
  const n = handSize(pick)
  const take = RESOURCES.flatMap((r) => Array<Resource>(pick[r]).fill(r)) as [Resource, Resource]
  return (
    <Dialog title="Year of Plenty: take any two" onClose={close}>
      <div className="card-row">
        {RESOURCES.map((r) => (
          <ResourceCard key={r} r={r} onClick={n < 2 && view.bank[r] > pick[r] ? () => setPick(add(pick, r, 1)) : undefined} />
        ))}
      </div>
      <div className="slot">{n ? <CardRow hand={pick} onPick={(r) => setPick(add(pick, r, -1))} /> : <span className="hint">pick two</span>}</div>
      <div className="dialog-foot">
        <button
          className="stamp-btn go"
          disabled={n !== 2}
          onClick={async () => {
            if (await act({ type: 'playYearOfPlenty', take })) close()
          }}
        >
          Take them
        </button>
      </div>
    </Dialog>
  )
}

function MonopolyDialog({ close }: { close: () => void }) {
  return (
    <Dialog title="Monopoly: name a resource, everyone hands theirs over" onClose={close}>
      <div className="card-row">
        {RESOURCES.map((r) => (
          <ResourceCard
            key={r}
            r={r}
            onClick={async () => {
              if (await act({ type: 'playMonopoly', resource: r })) close()
            }}
          />
        ))}
      </div>
    </Dialog>
  )
}

function GameOver({ view }: { view: View }) {
  const ph = view.phase
  if (ph.kind !== 'over') return null
  const order = view.players.map((p, i) => ({ p, i })).sort((a, b) => b.p.points - a.p.points)
  return (
    <Dialog title={ph.winner === view.you ? 'You win!' : `${view.players[ph.winner].name} wins!`}>
      <div className="scores">
        {order.map(({ p, i }) => (
          <div key={p.id} className="score" style={{ ['--pc' as string]: PLAYER[p.color].ui }}>
            <Who view={view} p={i} />
            <b>{p.points}</b>
          </div>
        ))}
      </div>
      <div className="dialog-foot">
        <button className="stamp-btn go" onClick={() => room.leave()}>
          Back to the start
        </button>
      </div>
    </Dialog>
  )
}
