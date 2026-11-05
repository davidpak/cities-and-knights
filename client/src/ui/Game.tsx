/**
 * The game screen: the 3D table, and around it plain buttons for every move. The board only ever offers legal
 * spots (from the shared rules), so a click always does what it shows.
 */
import { useEffect, useMemo, useState } from 'react'
import {
  affordable, canPlay, citySpots, roadSpots, robberSpots, settlementSpots, tradeRatios, type View,
} from '../../../shared/engine.ts'
import { CARD_NAME, CARD_TEXT, COST, RESOURCES, emptyHand, handSize, type Card, type Hand, type Resource } from '../../../shared/rules.ts'
import { PLAYER, RESOURCE_NAME } from '../lib/palette.ts'
import { act, room, useStore } from '../net.ts'
import { Board, type Picking } from '../three/Board.tsx'
import { Dice } from '../three/Dice.tsx'
import { Scene } from '../three/Scene.tsx'
import { publishState, TestHook } from '../three/TestHook.tsx'
import { Cost, Icon, Modal, Pickers } from './bits.tsx'

type Mode = 'road' | 'settlement' | 'city' | null

export function Game({ view }: { view: View }) {
  const { toast } = useStore()
  const me = view.you
  const mine = me >= 0 && view.current === me
  const ph = view.phase
  const [mode, setMode] = useState<Mode>(null)
  const [trading, setTrading] = useState(false)
  const colors = view.players.map((p) => p.color)

  // a mode only lasts while it still makes sense
  useEffect(() => {
    if (!mine || ph.kind !== 'main') setMode(null)
  }, [mine, ph.kind])

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

  const onPick = async (kind: NonNullable<Picking>['kind'], id: number) => {
    if (kind === 'robber') await act({ type: 'moveRobber', hex: id })
    else if (kind === 'road') await act({ type: 'buildRoad', edge: id })
    else if (kind === 'settlement') await act({ type: 'buildSettlement', vertex: id })
    else await act({ type: 'buildCity', vertex: id })
    setMode(null)
  }

  return (
    <div className="game">
      <div className="canvas-wrap">
        <Scene>
          <Board
            tiles={view.tiles}
            harbors={view.harbors}
            buildings={view.buildings}
            roads={view.roads}
            robber={view.robber}
            colors={colors}
            picking={picking}
            you={me}
            onPick={onPick}
          />
          <Dice dice={view.dice} rolls={view.rolls} onRoll={mine && ph.kind === 'roll' ? () => act({ type: 'roll' }) : undefined} />
          <TestHook />
        </Scene>
      </div>

      <Banner view={view} mode={mode} />
      <Players view={view} />
      <Log view={view} />
      {me >= 0 && <Bottom view={view} mode={mode} setMode={setMode} openTrade={() => setTrading(true)} />}

      {me >= 0 && <Dialogs view={view} trading={trading} closeTrade={() => setTrading(false)} />}
      {toast && <div className="toast plate">{toast}</div>}
    </div>
  )
}

// ---------------------------------------------------------------- what's happening

const name = (v: View, i: number) => (i === v.you ? 'You' : v.players[i].name)

function Banner({ view, mode }: { view: View; mode: Mode }) {
  const ph = view.phase
  const mine = view.current === view.you
  const who = view.players[view.current]
  let text: string
  switch (ph.kind) {
    case 'setup':
      text = mine
        ? ph.step === 'settlement'
          ? 'Place a settlement: click a spot on the board'
          : 'Now place a road next to it'
        : `${who.name} is placing a ${ph.step}…`
      break
    case 'roll':
      text = mine ? 'Your turn: roll the dice' : `${who.name} is about to roll…`
      break
    case 'discard': {
      const owe = ph.owed[view.you]
      const waiting = Object.keys(ph.owed).map((i) => name(view, Number(i)))
      text = owe ? `A 7! You have too many cards: discard ${owe}` : `A 7! Waiting for ${waiting.join(', ')} to discard…`
      break
    }
    case 'robber':
      text = mine ? 'Move the robber: click a tile' : `${who.name} is moving the robber…`
      break
    case 'steal':
      text = mine ? 'Pick who to take a card from' : `${who.name} is taking a card…`
      break
    case 'roadBuilding':
      text = mine ? `Place ${ph.left} free road${ph.left > 1 ? 's' : ''}` : `${who.name} is building roads…`
      break
    case 'main':
      text = mine
        ? mode === 'road'
          ? 'Click a side to build a road'
          : mode === 'settlement'
            ? 'Click a corner to build a settlement'
            : mode === 'city'
              ? 'Click one of your settlements to make it a city'
              : 'Build, trade, or end your turn'
        : `${who.name}'s turn`
      break
    case 'over':
      text = `${view.players[ph.winner].name} wins!`
      break
  }
  const total = view.dice ? view.dice[0] + view.dice[1] : null
  return (
    <div className="banner plate" style={{ borderColor: PLAYER[who.color].ui }}>
      {total !== null && ph.kind !== 'setup' && <span className="rolled" title="Last roll">{total}</span>}
      <span>{text}</span>
    </div>
  )
}

function Players({ view }: { view: View }) {
  const { room: info } = useStore()
  return (
    <div className="players">
      {view.players.map((p, i) => {
        const seat = info?.seats.find((s) => s.id === p.id)
        return (
          <div key={p.id} className={`plate player ${i === view.current ? 'turn' : ''}`}>
            <div className="swatch" style={{ background: PLAYER[p.color].ui }} />
            <div className="pname">
              {p.name}
              {i === view.you && <span className="tag">you</span>}
              {seat?.bot && <span className="tag">bot</span>}
              {seat && !seat.connected && <span className="tag warn">away</span>}
            </div>
            <div className="points" title="Points">
              {p.points}
            </div>
            <div className="pstats">
              <span title="Resource cards in hand">{p.handCount} cards</span>
              <span title="Development cards held">{p.cardCount} dev</span>
              <span title="Knights played">{p.knights} knights</span>
              {view.longestRoad === i && <span className="badge" title="Longest Road (+2)">Road</span>}
              {view.largestArmy === i && <span className="badge" title="Largest Army (+2)">Army</span>}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function Log({ view }: { view: View }) {
  const lines = view.log.slice(-7)
  return (
    <div className="log plate">
      {lines.map((l) => (
        <div key={l.n} className="log-line" style={{ color: l.player !== undefined ? PLAYER[view.players[l.player].color].ui : undefined }}>
          {l.text}
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------- your hand and buttons

function Bottom({ view, mode, setMode, openTrade }: { view: View; mode: Mode; setMode: (m: Mode) => void; openTrade: () => void }) {
  const me = view.you
  const p = view.players[me]
  const hand = p.hand!
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

  return (
    <div className="bottom">
      <div className="hand plate">
        {RESOURCES.map((r) => (
          <div key={`${r}${hand[r]}`} className={`rcard ${hand[r] ? '' : 'none'}`} title={RESOURCE_NAME[r]}>
            <Icon r={r} size={30} />
            <div className="rcount">{hand[r]}</div>
            <div className="rname">{RESOURCE_NAME[r]}</div>
          </div>
        ))}
        <MyCards view={view} />
      </div>

      <div className="actions plate">
        {mine && ph.kind === 'roll' ? (
          <>
            <button className="big primary" onClick={() => act({ type: 'roll' })}>
              Roll the dice
            </button>
            {canPlay(view, me, 'knight') && (
              <button onClick={() => act({ type: 'playKnight' })} title={CARD_TEXT.knight}>
                Play Knight first
              </button>
            )}
          </>
        ) : (
          <>
            <div className="builds">
              <BuildButton label="Road" cost={COST.road} on={mode === 'road'} enabled={can.road} onClick={() => toggle('road')} left={p.pieces.road} />
              <BuildButton label="Settlement" cost={COST.settlement} on={mode === 'settlement'} enabled={can.settlement} onClick={() => toggle('settlement')} left={p.pieces.settlement} />
              <BuildButton label="City" cost={COST.city} on={mode === 'city'} enabled={can.city} onClick={() => toggle('city')} left={p.pieces.city} />
              <BuildButton label="Card" cost={COST.card} enabled={can.card} onClick={() => act({ type: 'buyCard' })} left={view.pile} />
            </div>
            <div className="row">
              <button disabled={!main} onClick={openTrade}>
                Trade
              </button>
              <button className="primary" disabled={!main} onClick={() => (setMode(null), act({ type: 'endTurn' }))}>
                End turn
              </button>
            </div>
          </>
        )}
        <button className="link" onClick={() => confirm('Leave this game?') && room.leave()}>
          Leave
        </button>
      </div>
    </div>
  )
}

function BuildButton({ label, cost, enabled, on, onClick, left }: { label: string; cost: Partial<Hand>; enabled: boolean; on?: boolean; onClick: () => void; left: number }) {
  return (
    <button className={`build ${on ? 'on' : ''}`} disabled={!enabled && !on} onClick={onClick} title={`${left} left`}>
      <span className="build-name">{on ? 'Cancel' : label}</span>
      <Cost of={cost} />
    </button>
  )
}

function MyCards({ view }: { view: View }) {
  const me = view.you
  const cards = view.players[me].cards ?? []
  const mine = view.current === me
  const ph = view.phase
  const [pick, setPick] = useState<Card | null>(null)
  if (cards.length === 0) return null
  const groups = new Map<Card, { n: number; ready: number }>()
  for (const c of cards) {
    const g = groups.get(c.card) ?? { n: 0, ready: 0 }
    g.n++
    if (c.turn < view.turn) g.ready++
    groups.set(c.card, g)
  }
  const playable = (c: Card) =>
    mine && c !== 'victoryPoint' && canPlay(view, me, c) && (c === 'knight' ? ph.kind === 'roll' || ph.kind === 'main' : ph.kind === 'main')
  const play = (c: Card) => {
    if (c === 'knight') act({ type: 'playKnight' })
    else if (c === 'roadBuilding') act({ type: 'playRoadBuilding' })
    else setPick(c)
  }
  return (
    <div className="mycards">
      {[...groups].map(([c, g]) => (
        <button key={c} className={`devcard ${c}`} disabled={!playable(c)} onClick={() => play(c)} title={`${CARD_TEXT[c]}${g.ready < g.n ? ' (new ones can be played next turn)' : ''}`}>
          <span className="dc-name">{CARD_NAME[c]}</span>
          {g.n > 1 && <span className="dc-n">×{g.n}</span>}
        </button>
      ))}
      {pick === 'yearOfPlenty' && <PlentyDialog view={view} close={() => setPick(null)} />}
      {pick === 'monopoly' && <MonopolyDialog close={() => setPick(null)} />}
    </div>
  )
}

// ---------------------------------------------------------------- dialogs

function Dialogs({ view, trading, closeTrade }: { view: View; trading: boolean; closeTrade: () => void }) {
  const me = view.you
  const ph = view.phase
  const mine = view.current === me
  if (ph.kind === 'over') return <GameOver view={view} />
  if (ph.kind === 'discard' && ph.owed[me]) return <DiscardDialog view={view} owe={ph.owed[me]} />
  if (ph.kind === 'steal' && mine) return <StealDialog view={view} victims={ph.victims} />
  return (
    <>
      {trading && mine && ph.kind === 'main' && <TradeDialog view={view} close={closeTrade} />}
      {view.offer && <OfferCard view={view} />}
    </>
  )
}

function DiscardDialog({ view, owe }: { view: View; owe: number }) {
  const hand = view.players[view.you].hand!
  const [pick, setPick] = useState<Hand>(emptyHand())
  const n = handSize(pick)
  return (
    <Modal title={`Discard ${owe} cards`}>
      <p>A 7 was rolled and you hold more than 7 cards. Choose {owe} to give back.</p>
      <Pickers value={pick} onChange={setPick} max={hand} />
      <div className="row end">
        <button className="primary" disabled={n !== owe} onClick={() => act({ type: 'discard', cards: pick })}>
          Discard <span className="num">{n}/{owe}</span>
        </button>
      </div>
    </Modal>
  )
}

function StealDialog({ view, victims }: { view: View; victims: number[] }) {
  return (
    <Modal title="Take a card from…">
      <div className="row wrap">
        {victims.map((v) => (
          <button key={v} className="victim" onClick={() => act({ type: 'steal', victim: v })} style={{ borderColor: PLAYER[view.players[v].color].ui }}>
            {view.players[v].name}
            <small>{view.players[v].handCount} cards</small>
          </button>
        ))}
      </div>
    </Modal>
  )
}

function PlentyDialog({ view, close }: { view: View; close: () => void }) {
  const [pick, setPick] = useState<Hand>(emptyHand())
  const n = handSize(pick)
  const take = RESOURCES.flatMap((r) => Array<Resource>(pick[r]).fill(r)) as [Resource, Resource]
  return (
    <Modal title="Year of Plenty: take two" onClose={close}>
      <Pickers value={pick} onChange={(h) => handSize(h) <= 2 && setPick(h)} max={view.bank} />
      <div className="row end">
        <button className="primary" disabled={n !== 2} onClick={async () => (await act({ type: 'playYearOfPlenty', take })) && close()}>
          Take them
        </button>
      </div>
    </Modal>
  )
}

function MonopolyDialog({ close }: { close: () => void }) {
  return (
    <Modal title="Monopoly: name a resource" onClose={close}>
      <div className="row wrap">
        {RESOURCES.map((r) => (
          <button key={r} className="choice" onClick={async () => (await act({ type: 'playMonopoly', resource: r })) && close()}>
            <Icon r={r} size={28} />
            {RESOURCE_NAME[r]}
          </button>
        ))}
      </div>
    </Modal>
  )
}

function TradeDialog({ view, close }: { view: View; close: () => void }) {
  const me = view.you
  const hand = view.players[me].hand!
  const ratios = tradeRatios(view, me)
  const [tab, setTab] = useState<'bank' | 'players'>('bank')
  const [give, setGive] = useState<Resource | null>(null)
  const [get, setGet] = useState<Resource | null>(null)
  const [offerGive, setOfferGive] = useState<Hand>(emptyHand())
  const [offerGet, setOfferGet] = useState<Hand>(emptyHand())
  return (
    <Modal title="Trade" onClose={close}>
      <div className="tabs">
        <button className={tab === 'bank' ? 'on' : ''} onClick={() => setTab('bank')}>
          With the bank
        </button>
        <button className={tab === 'players' ? 'on' : ''} onClick={() => setTab('players')} disabled={view.players.length < 2}>
          With players
        </button>
      </div>
      {tab === 'bank' ? (
        <>
          <h3>Give</h3>
          <div className="row wrap">
            {RESOURCES.map((r) => (
              <button key={r} className={`choice ${give === r ? 'on' : ''}`} disabled={hand[r] < ratios[r]} onClick={() => setGive(r)}>
                <Icon r={r} size={24} />
                <span>
                  {ratios[r]} {RESOURCE_NAME[r]}
                </span>
              </button>
            ))}
          </div>
          <h3>Get one</h3>
          <div className="row wrap">
            {RESOURCES.map((r) => (
              <button key={r} className={`choice ${get === r ? 'on' : ''}`} disabled={r === give || view.bank[r] === 0} onClick={() => setGet(r)}>
                <Icon r={r} size={24} />
                <span>{RESOURCE_NAME[r]}</span>
              </button>
            ))}
          </div>
          <div className="row end">
            <button
              className="primary"
              disabled={!give || !get || give === get}
              onClick={async () => {
                if (give && get && (await act({ type: 'bankTrade', give, get }))) {
                  setGive(null)
                  setGet(null)
                }
              }}
            >
              Trade <span className="num">{give ? ratios[give] : ''}</span> for <span className="num">1</span>
            </button>
          </div>
        </>
      ) : (
        <>
          <h3>You give</h3>
          <Pickers value={offerGive} onChange={setOfferGive} max={hand} />
          <h3>You want</h3>
          <Pickers value={offerGet} onChange={setOfferGet} />
          <div className="row end">
            <button
              className="primary"
              disabled={!handSize(offerGive) || !handSize(offerGet) || RESOURCES.some((r) => offerGive[r] && offerGet[r])}
              onClick={async () => (await act({ type: 'offerTrade', give: offerGive, get: offerGet })) && close()}
            >
              Offer to everyone
            </button>
          </div>
        </>
      )}
    </Modal>
  )
}

function OfferCard({ view }: { view: View }) {
  const o = view.offer!
  const me = view.you
  const mineOffer = o.from === me
  const hand = view.players[me].hand!
  const canAccept = RESOURCES.every((r) => hand[r] >= o.get[r])
  const declined = o.declined.includes(me)
  return (
    <div className="offer plate">
      <div>
        <b>{mineOffer ? 'Your offer' : `${view.players[o.from].name} offers`}</b>
      </div>
      <div className="offer-row">
        <Cost of={o.give} /> <span className="for">for</span> <Cost of={o.get} />
      </div>
      {mineOffer ? (
        <>
          {o.declined.length > 0 && <small>Declined by {o.declined.map((i) => view.players[i].name).join(', ')}</small>}
          <button onClick={() => act({ type: 'cancelOffer' })}>Withdraw</button>
        </>
      ) : declined ? (
        <small>You declined</small>
      ) : (
        <div className="row">
          <button className="primary" disabled={!canAccept} onClick={() => act({ type: 'acceptOffer' })}>
            Accept
          </button>
          <button onClick={() => act({ type: 'declineOffer' })}>Decline</button>
        </div>
      )}
    </div>
  )
}

function GameOver({ view }: { view: View }) {
  const ph = view.phase
  if (ph.kind !== 'over') return null
  const order = view.players.map((p, i) => ({ p, i })).sort((a, b) => b.p.points - a.p.points)
  return (
    <Modal title={ph.winner === view.you ? 'You win!' : `${view.players[ph.winner].name} wins!`}>
      <div className="scores">
        {order.map(({ p, i }) => (
          <div key={p.id} className="score">
            <span className="swatch" style={{ background: PLAYER[p.color].ui }} />
            <span>{name(view, i)}</span>
            <b>{p.points}</b>
          </div>
        ))}
      </div>
      <div className="row end">
        <button className="primary" onClick={() => room.leave()}>
          Back to the start
        </button>
      </div>
    </Modal>
  )
}
