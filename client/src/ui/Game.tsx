/**
 * The game screen, in three parts that never cover each other:
 *   the board (top down, as big as the space allows), a side panel (players, trades, the log), and a bar along the
 *   bottom (what to do now, your cards, your buttons).
 * Every move is a button or a click on a marked spot.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  affordable, canPlay, citySpots, roadSpots, robberSpots, settlementSpots, tradeRatios, type View,
} from '../../../shared/engine.ts'
import { CARDS, COST, RESOURCES, emptyHand, handSize, type Card, type Hand, type Resource } from '../../../shared/rules.ts'
import { PLAYER, RESOURCE_NAME } from '../lib/palette.ts'
import { act, room, useStore } from '../net.ts'
import { BoardView, type PickKind, type Picking } from '../three/Board.tsx'
import { publishState } from '../three/TestHook.tsx'
import { Bundle, CardRow, Cost, DevCard, Dice, Icon, ResourceCard } from './Cards.tsx'

type Mode = 'road' | 'settlement' | 'city' | null
type Trade = { give: Hand; get: Hand }

const add = (h: Hand, r: Resource, d: number): Hand => ({ ...h, [r]: Math.max(0, h[r] + d) })
const minus = (a: Hand, b: Hand): Hand => Object.fromEntries(RESOURCES.map((r) => [r, a[r] - b[r]])) as Hand

export function Game({ view }: { view: View }) {
  const { toast } = useStore()
  const me = view.you
  const mine = me >= 0 && view.current === me
  const ph = view.phase
  const [mode, setMode] = useState<Mode>(null)
  const [trade, setTrade] = useState<Trade | null>(null)
  const rolling = useRolling(view.rolls)
  const colors = view.players.map((p) => p.color)
  const canTrade = mine && ph.kind === 'main'

  useEffect(() => {
    if (!mine || ph.kind !== 'main') setMode(null)
    if (!canTrade) setTrade(null)
  }, [mine, ph.kind, canTrade])

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

  // keys: R roll, E end turn, Esc cancel
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return
      if (e.key === 'Escape') {
        setMode(null)
        setTrade(null)
      }
      if (!mine) return
      if (e.key.toLowerCase() === 'r' && ph.kind === 'roll') act({ type: 'roll' })
      if (e.key.toLowerCase() === 'e' && ph.kind === 'main') act({ type: 'endTurn' })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [mine, ph.kind])

  const hand = me >= 0 ? view.players[me].hand : null
  const shown = hand && trade ? minus(hand, trade.give) : hand

  return (
    <div className="g">
      <main className="g-board">
        <BoardView tiles={view.tiles} harbors={view.harbors} buildings={view.buildings} roads={view.roads} robber={view.robber} colors={colors} picking={picking} you={me} onPick={onPick} />
      </main>

      <aside className="g-side">
        <Players view={view} />
        {view.offer && <Offer view={view} />}
        {trade && hand ? <TradePanel view={view} trade={trade} setTrade={setTrade} /> : <Log view={view} />}
      </aside>

      <footer className="g-bar">
        <div className="bar-top">
          <Status view={view} mode={mode} trading={!!trade} />
          <Dice dice={view.dice} rolling={rolling} />
        </div>
        {me >= 0 && shown && (
          <div className="bar-main">
            <div className="hand">
              <CardRow hand={shown} all onPick={trade ? (r) => setTrade({ ...trade, give: add(trade.give, r, 1) }) : undefined} />
              <MyCards view={view} />
            </div>
            <Actions view={view} mode={mode} setMode={setMode} trading={!!trade} toggleTrade={() => setTrade(trade ? null : { give: emptyHand(), get: emptyHand() })} />
          </div>
        )}
      </footer>

      {me >= 0 && <Dialogs view={view} />}
      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}

/** true for a moment after each roll, so the dice can shake */
function useRolling(rolls: number) {
  const [on, setOn] = useState(false)
  const first = useRef(rolls)
  useEffect(() => {
    if (rolls === first.current) return
    setOn(true)
    const t = setTimeout(() => setOn(false), 550)
    return () => clearTimeout(t)
  }, [rolls])
  return on
}

// ---------------------------------------------------------------- what to do now

const nameOf = (v: View, i: number) => (i === v.you ? 'You' : v.players[i].name)

function Status({ view, mode, trading }: { view: View; mode: Mode; trading: boolean }) {
  const ph = view.phase
  const mine = view.current === view.you
  const who = view.players[view.current]
  let text: string
  switch (ph.kind) {
    case 'setup':
      text = mine ? (ph.step === 'settlement' ? 'Place a settlement on a marked corner' : 'Place a road next to it') : `${who.name} is placing a ${ph.step}`
      break
    case 'roll':
      text = mine ? 'Your turn: roll the dice' : `${who.name} is rolling`
      break
    case 'discard': {
      const owe = ph.owed[view.you]
      text = owe ? `A 7! Discard ${owe} cards` : `A 7! Waiting for ${Object.keys(ph.owed).map((i) => nameOf(view, Number(i))).join(', ')} to discard`
      break
    }
    case 'robber':
      text = mine ? 'Move the robber: click a tile' : `${who.name} is moving the robber`
      break
    case 'steal':
      text = mine ? 'Pick who to steal from' : `${who.name} is stealing a card`
      break
    case 'roadBuilding':
      text = mine ? `Place ${ph.left} free road${ph.left > 1 ? 's' : ''}` : `${who.name} is building roads`
      break
    case 'main':
      text = mine
        ? trading
          ? 'Click your cards to offer them, and pick what you want'
          : mode === 'road'
            ? 'Click a marked side to build a road'
            : mode === 'settlement'
              ? 'Click a marked corner to build a settlement'
              : mode === 'city'
                ? 'Click one of your settlements to upgrade it'
                : 'Build, trade, or end your turn'
        : `${who.name}'s turn`
      break
    case 'over':
      text = `${view.players[ph.winner].name} wins!`
      break
  }
  return (
    <div className={`status ${mine ? 'mine' : ''}`}>
      <span className="status-dot" style={{ background: PLAYER[who.color].ui }} />
      {text}
    </div>
  )
}

// ---------------------------------------------------------------- the side panel

function Players({ view }: { view: View }) {
  const { room: info } = useStore()
  return (
    <div className="players">
      {view.players.map((p, i) => {
        const seat = info?.seats.find((s) => s.id === p.id)
        return (
          <div key={p.id} className={`player ${i === view.current ? 'turn' : ''}`} style={{ ['--pc' as string]: PLAYER[p.color].ui }}>
            <div className="player-top">
              <span className="pname">
                {p.name}
                {i === view.you && <span className="tag">you</span>}
                {seat?.bot && <span className="tag">bot</span>}
                {seat && !seat.connected && <span className="tag warn">away</span>}
              </span>
              <span className="points" title="Victory points">
                {p.points}
                <small>pts</small>
              </span>
            </div>
            <div className="player-stats">
              <span className="stat" title="Resource cards">
                <span className="mini-card res-back" />
                {p.handCount}
              </span>
              <span className="stat" title="Development cards">
                <span className="mini-card dev-back" />
                {p.cardCount}
              </span>
              <span className="stat" title="Knights played">
                Knights {p.knights}
              </span>
              {view.longestRoad === i && <span className="award" title="Longest Road: +2 points">Longest road</span>}
              {view.largestArmy === i && <span className="award" title="Largest Army: +2 points">Largest army</span>}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function Log({ view }: { view: View }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight })
  }, [view.log])
  return (
    <div className="log" ref={ref}>
      {view.log.slice(-40).map((l) => (
        <div key={l.n} className="log-line">
          {l.player !== undefined && <span className="log-dot" style={{ background: PLAYER[view.players[l.player].color].ui }} />}
          {l.text}
        </div>
      ))}
    </div>
  )
}

function Offer({ view }: { view: View }) {
  const o = view.offer!
  const me = view.you
  const mineOffer = o.from === me
  const hand = view.players[me]?.hand
  const canAccept = !!hand && RESOURCES.every((r) => hand[r] >= o.get[r])
  const declined = o.declined.includes(me)
  return (
    <div className="panel offer">
      <div className="panel-title">{mineOffer ? 'Your offer' : `${view.players[o.from].name} wants to trade`}</div>
      <div className="offer-row">
        <span className="offer-label">{mineOffer ? 'You give' : 'They give'}</span>
        <Bundle of={o.give} />
      </div>
      <div className="offer-row">
        <span className="offer-label">{mineOffer ? 'You get' : 'You give'}</span>
        <Bundle of={o.get} />
      </div>
      {mineOffer ? (
        <div className="row">
          <small className="muted">{o.declined.length ? `No from ${o.declined.map((i) => view.players[i].name).join(', ')}` : 'Waiting for answers…'}</small>
          <button className="btn" onClick={() => act({ type: 'cancelOffer' })}>
            Withdraw
          </button>
        </div>
      ) : declined ? (
        <small className="muted">You said no.</small>
      ) : (
        <div className="row">
          <button className="btn primary" disabled={!canAccept} onClick={() => act({ type: 'acceptOffer' })} title={canAccept ? '' : "You don't have those cards"}>
            Accept
          </button>
          <button className="btn" onClick={() => act({ type: 'declineOffer' })}>
            No thanks
          </button>
        </div>
      )}
    </div>
  )
}

/** what the bank would do with this trade, if anything (harbour rates included) */
function bankPlan(view: View, t: Trade): { ok: boolean; why: string; pairs: [Resource, Resource][] } {
  const ratios = tradeRatios(view, view.you)
  const give = RESOURCES.filter((r) => t.give[r] > 0)
  const get = RESOURCES.filter((r) => t.get[r] > 0)
  if (!give.length) return { ok: false, why: 'Add cards from your hand', pairs: [] }
  if (!get.length) return { ok: false, why: 'Pick what you want', pairs: [] }
  if (give.some((r) => t.get[r] > 0)) return { ok: false, why: "Can't give and get the same thing", pairs: [] }
  const odd = give.find((r) => t.give[r] % ratios[r] !== 0)
  if (odd) return { ok: false, why: `The bank takes ${RESOURCE_NAME[odd].toLowerCase()} ${ratios[odd]} at a time`, pairs: [] }
  const out: Resource[] = give.flatMap((r) => Array<Resource>(t.give[r] / ratios[r]).fill(r))
  const into: Resource[] = get.flatMap((r) => Array<Resource>(t.get[r]).fill(r))
  if (out.length !== into.length) return { ok: false, why: `That buys ${out.length} from the bank, not ${into.length}`, pairs: [] }
  if (get.some((r) => view.bank[r] < t.get[r])) return { ok: false, why: 'The bank is out of that', pairs: [] }
  return { ok: true, why: '', pairs: out.map((r, i) => [r, into[i]]) }
}

function TradePanel({ view, trade, setTrade }: { view: View; trade: Trade; setTrade: (t: Trade | null) => void }) {
  const ratios = tradeRatios(view, view.you)
  const plan = bankPlan(view, trade)
  const offerOk = handSize(trade.give) > 0 && handSize(trade.get) > 0 && !RESOURCES.some((r) => trade.give[r] && trade.get[r])
  const bankTrade = async () => {
    for (const [give, get] of plan.pairs) if (!(await act({ type: 'bankTrade', give, get }))) break
    setTrade({ give: emptyHand(), get: emptyHand() })
  }
  return (
    <div className="panel trade">
      <div className="panel-title">
        Trade
        <button className="x" onClick={() => setTrade(null)} aria-label="Close">
          ×
        </button>
      </div>
      <div className="trade-label">You give</div>
      <div className="trade-slot">
        {handSize(trade.give) ? <CardRow hand={trade.give} small onPick={(r) => setTrade({ ...trade, give: add(trade.give, r, -1) })} /> : <span className="hint">Click cards in your hand</span>}
      </div>
      <div className="trade-label">You want</div>
      <div className="trade-slot">
        {handSize(trade.get) ? <CardRow hand={trade.get} small onPick={(r) => setTrade({ ...trade, get: add(trade.get, r, -1) })} /> : <span className="hint">Pick below</span>}
      </div>
      <div className="card-row pick-row">
        {RESOURCES.map((r) => (
          <ResourceCard key={r} r={r} small onClick={() => setTrade({ ...trade, get: add(trade.get, r, 1) })} title={`Want ${RESOURCE_NAME[r]}`} />
        ))}
      </div>
      <div className="rates" title="How many of a kind the bank takes for one card (your harbours lower it)">
        Bank:
        {RESOURCES.map((r) => (
          <span key={r} className={`rate ${ratios[r] < 4 ? 'good' : ''}`}>
            <Icon r={r} size={14} />
            {ratios[r]}:1
          </span>
        ))}
      </div>
      <div className="trade-actions">
        <button className="btn primary" disabled={!plan.ok} onClick={bankTrade} title={plan.why}>
          Trade with bank
        </button>
        <button
          className="btn"
          disabled={!offerOk || view.players.length < 2}
          onClick={async () => {
            if (await act({ type: 'offerTrade', give: trade.give, get: trade.get })) setTrade(null)
          }}
        >
          Offer to players
        </button>
      </div>
      {!plan.ok && <small className="muted">{plan.why}</small>}
    </div>
  )
}

// ---------------------------------------------------------------- your cards and buttons

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
      {CARDS.filter((c) => cards.some((x) => x.card === c)).map((c) => {
        const n = cards.filter((x) => x.card === c).length
        const ready = cards.some((x) => x.card === c && x.turn < view.turn)
        return <DevCard key={c} card={c} n={n} ready={ready} onPlay={playable(c) ? () => play(c) : undefined} />
      })}
      {pick === 'yearOfPlenty' && <PlentyDialog view={view} close={() => setPick(null)} />}
      {pick === 'monopoly' && <MonopolyDialog close={() => setPick(null)} />}
    </div>
  )
}

function Actions({ view, mode, setMode, trading, toggleTrade }: { view: View; mode: Mode; setMode: (m: Mode) => void; trading: boolean; toggleTrade: () => void }) {
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
  const build = (label: string, key: keyof typeof can, cost: Partial<Hand>, onClick: () => void, left: number, on = false) => (
    <button className={`btn build ${on ? 'on' : ''}`} disabled={!can[key] && !on} onClick={onClick} title={`${label}: ${left} left`}>
      <span>{on ? 'Cancel' : label}</span>
      <Cost of={cost} />
    </button>
  )
  return (
    <div className="actions">
      <div className="builds">
        {build('Road', 'road', COST.road, () => toggle('road'), p.pieces.road, mode === 'road')}
        {build('Settlement', 'settlement', COST.settlement, () => toggle('settlement'), p.pieces.settlement, mode === 'settlement')}
        {build('City', 'city', COST.city, () => toggle('city'), p.pieces.city, mode === 'city')}
        {build('Dev card', 'card', COST.card, () => act({ type: 'buyCard' }), view.pile)}
      </div>
      <div className="turn-buttons">
        <button className={`btn ${trading ? 'on' : ''}`} disabled={!main} onClick={toggleTrade}>
          {trading ? 'Close trade' : 'Trade'}
        </button>
        {mine && ph.kind === 'roll' ? (
          <>
            {canPlay(view, me, 'knight') && (
              <button className="btn" onClick={() => act({ type: 'playKnight' })}>
                Knight first
              </button>
            )}
            <button className="btn primary big" onClick={() => act({ type: 'roll' })}>
              Roll dice <kbd>R</kbd>
            </button>
          </>
        ) : (
          <button
            className="btn primary big"
            disabled={!main}
            onClick={() => {
              setMode(null)
              act({ type: 'endTurn' })
            }}
          >
            End turn <kbd>E</kbd>
          </button>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- dialogs (only when the game needs an answer)

function Dialog({ title, children, onClose }: { title: string; children: React.ReactNode; onClose?: () => void }) {
  return (
    <div className="dialog-back">
      <div className="panel dialog">
        <div className="panel-title">
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
    <Dialog title={`Discard ${owe} cards`}>
      <p className="muted">A 7 was rolled and you have more than 7 cards. Click cards to put them back.</p>
      <div className="trade-label">Your hand</div>
      <CardRow hand={minus(hand, pick)} onPick={n < owe ? (r) => setPick(add(pick, r, 1)) : undefined} />
      <div className="trade-label">
        Discarding ({n} of {owe})
      </div>
      <div className="trade-slot">{n ? <CardRow hand={pick} onPick={(r) => setPick(add(pick, r, -1))} /> : <span className="hint">None yet</span>}</div>
      <div className="row end">
        <button className="btn primary" disabled={n !== owe} onClick={() => act({ type: 'discard', cards: pick })}>
          Discard
        </button>
      </div>
    </Dialog>
  )
}

function StealDialog({ view, victims }: { view: View; victims: number[] }) {
  return (
    <Dialog title="Steal a card from…">
      <div className="row wrap">
        {victims.map((v) => (
          <button key={v} className="btn victim" style={{ ['--pc' as string]: PLAYER[view.players[v].color].ui }} onClick={() => act({ type: 'steal', victim: v })}>
            {view.players[v].name}
            <small>{view.players[v].handCount} cards</small>
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
      <div className="card-row pick-row">
        {RESOURCES.map((r) => (
          <ResourceCard key={r} r={r} onClick={n < 2 && view.bank[r] > pick[r] ? () => setPick(add(pick, r, 1)) : undefined} />
        ))}
      </div>
      <div className="trade-slot">{n ? <CardRow hand={pick} onPick={(r) => setPick(add(pick, r, -1))} /> : <span className="hint">Pick two</span>}</div>
      <div className="row end">
        <button
          className="btn primary"
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
    <Dialog title="Monopoly: everyone gives you all of one resource" onClose={close}>
      <div className="card-row pick-row">
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
          <div key={p.id} className="score">
            <span className="status-dot" style={{ background: PLAYER[p.color].ui }} />
            <span>{nameOf(view, i)}</span>
            <b>{p.points}</b>
          </div>
        ))}
      </div>
      <div className="row end">
        <button className="btn primary" onClick={() => room.leave()}>
          Back to start
        </button>
      </div>
    </Dialog>
  )
}
