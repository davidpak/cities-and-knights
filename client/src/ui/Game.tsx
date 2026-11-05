/**
 * The game: the whole screen is the table. Everything you do, you do to things on it (see three/table/Table.tsx).
 * On top there's only: what to do now, what just happened, one button for the turn, the tray's few buttons,
 * small counts on the stacks, everyone's name and points, and a History panel that stays shut until you open it.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { affordable, canPlay, citySpots, roadSpots, robberSpots, settlementSpots, tradeRatios, type View } from '../../../shared/engine.ts'
import { COST, RESOURCES, emptyHand, handSize, type Card, type Hand, type Resource } from '../../../shared/rules.ts'
import { PLAYER } from '../lib/palette.ts'
import { act, room, toast as say, useStore } from '../net.ts'
import type { PickKind, Picking } from '../three/Board.tsx'
import { useProjector } from '../three/labels.ts'
import { TableView, type TrayContents } from '../three/table/Table.tsx'
import { CARD, TRAY, layoutFor, seatParts, type Spot } from '../three/table/layout.ts'
import { publishState } from '../three/TestHook.tsx'
import { Chronicle, describe, Who } from './Chronicle.tsx'

type Build = 'road' | 'settlement' | 'city'
type Deal = { give: Hand; get: Hand; to: 'bank' | number | null }

const add = (h: Hand, r: Resource, d = 1): Hand => ({ ...h, [r]: Math.max(0, h[r] + d) })
const minus = (a: Hand, b: Partial<Hand>): Hand => Object.fromEntries(RESOURCES.map((r) => [r, a[r] - (b[r] ?? 0)])) as Hand

function useAspect() {
  const [a, setA] = useState(() => window.innerWidth / window.innerHeight)
  useEffect(() => {
    const f = () => setA(window.innerWidth / window.innerHeight)
    window.addEventListener('resize', f)
    return () => window.removeEventListener('resize', f)
  }, [])
  return a
}

export function Game({ view }: { view: View }) {
  const { toast } = useStore()
  const me = view.you
  const ph = view.phase
  const mine = me >= 0 && view.current === me
  const main = mine && ph.kind === 'main'
  const hand = me >= 0 ? view.players[me].hand : null
  const offer = view.offer
  const myOffer = offer?.from === me ? offer : null
  const toMe = offer && offer.from !== me && (offer.to === undefined || offer.to === me) && !offer.accepted.includes(me) && !offer.declined.includes(me) ? offer : null
  const owe = ph.kind === 'discard' ? ph.owed[me] ?? 0 : 0

  const aspect = useAspect()
  const layout = useMemo(() => layoutFor(view.players.length, me < 0 ? 0 : me, aspect), [view.players.length, me, aspect])

  const [building, setBuilding] = useState<Build | null>(null)
  const [deal, setDeal] = useState<Deal | null>(null)
  const [drop, setDrop] = useState<Hand>(emptyHand()) // cards picked to discard
  const [plenty, setPlenty] = useState<Resource[] | null>(null)
  const [monopoly, setMonopoly] = useState(false)
  const [history, setHistory] = useState(false)

  // a choice lasts only while it still makes sense
  useEffect(() => {
    if (!main) {
      setBuilding(null)
      setDeal(null)
      setPlenty(null)
      setMonopoly(false)
    }
  }, [main])
  useEffect(() => {
    if (!owe) setDrop(emptyHand())
  }, [owe])
  const hadOffer = useRef(!!myOffer)
  useEffect(() => {
    if (hadOffer.current && !myOffer) setDeal(null) // your offer was answered (or taken back): the tray clears
    hadOffer.current = !!myOffer
  }, [myOffer])

  const can = {
    road: main && view.players[me].pieces.road > 0 && affordable(view, me, 'road') && roadSpots(view, me).length > 0,
    settlement: main && view.players[me].pieces.settlement > 0 && affordable(view, me, 'settlement') && settlementSpots(view, me).length > 0,
    city: main && view.players[me].pieces.city > 0 && affordable(view, me, 'city') && citySpots(view, me).length > 0,
  }
  const picking: Picking = useMemo(() => {
    if (!mine) return null
    if (ph.kind === 'setup') return ph.step === 'settlement' ? { kind: 'settlement', spots: settlementSpots(view, me) } : { kind: 'road', spots: roadSpots(view, me) }
    if (ph.kind === 'roadBuilding') return { kind: 'road', spots: roadSpots(view, me) }
    if (ph.kind === 'robber') return { kind: 'robber', spots: robberSpots(view) }
    if (main && building === 'road') return { kind: 'road', spots: roadSpots(view, me) }
    if (main && building === 'settlement') return { kind: 'settlement', spots: settlementSpots(view, me) }
    if (main && building === 'city') return { kind: 'city', spots: citySpots(view, me) }
    return null
  }, [mine, main, ph, building, view, me])
  useEffect(
    () =>
      publishState({
        view,
        picking,
        // where things are on the table, for browser tests
        spots: {
          hand: layout.hand,
          bank: layout.bank,
          deck: layout.deck,
          dev: [0, 1, 2, 3, 4].map(layout.dev),
          wants: [0, 1, 2, 3, 4].map(layout.wants),
          supply: layout.supply,
          seats: layout.seats.map((s) => ({ p: s.p, hand: seatParts(s.at).hand })),
          tray: layout.tray,
        },
      }),
    [view, picking, layout],
  )

  const onPick = async (kind: PickKind, id: number) => {
    if (kind === 'robber') await act({ type: 'moveRobber', hex: id })
    else if (kind === 'road') await act({ type: 'buildRoad', edge: id })
    else if (kind === 'settlement') await act({ type: 'buildSettlement', vertex: id })
    else await act({ type: 'buildCity', vertex: id })
    setBuilding(null)
  }

  const victims = ph.kind === 'steal' && mine ? ph.victims : []
  const trading = main && !myOffer && !plenty && !monopoly
  const openDeal = (d: Partial<Deal>) => setDeal((cur) => ({ give: cur?.give ?? emptyHand(), get: cur?.get ?? emptyHand(), to: cur?.to ?? null, ...d }))
  const playable = (c: Card) => mine && c !== 'victoryPoint' && canPlay(view, me, c) && (c === 'knight' ? ph.kind === 'roll' || ph.kind === 'main' : ph.kind === 'main')

  // the tray shows: an offer made to you, your own offer waiting, your discard, or the trade you're putting together
  let tray: TrayContents | null = null
  if (toMe) tray = { mode: 'trade', give: toMe.get, get: toMe.give, locked: true }
  else if (myOffer) tray = { mode: 'trade', give: myOffer.give, get: myOffer.get, locked: true }
  else if (owe) tray = { mode: 'discard', give: drop, get: {} }
  else if (deal) tray = { mode: 'trade', give: deal.give, get: deal.get }
  const shownHand = hand ? minus(hand, owe ? drop : deal && !myOffer ? deal.give : {}) : null

  const on = {
    hand: (r: Resource) => {
      if (owe) return handSize(drop) < owe && setDrop(add(drop, r))
      if (!trading) return
      openDeal({ give: add(deal?.give ?? emptyHand(), r) })
    },
    trayGive: (r: Resource) => (owe ? setDrop(add(drop, r, -1)) : deal && setDeal({ ...deal, give: add(deal.give, r, -1) })),
    trayGet: (r: Resource) => deal && setDeal({ ...deal, get: add(deal.get, r, -1) }),
    want: (r: Resource) => openDeal({ get: add(deal?.get ?? emptyHand(), r) }),
    bank: async (r: Resource) => {
      if (plenty) {
        const picks = [...plenty, r]
        if (picks.length < 2) return setPlenty(picks)
        if (await act({ type: 'playYearOfPlenty', take: picks as [Resource, Resource] })) setPlenty(null)
        return
      }
      if (monopoly) {
        if (await act({ type: 'playMonopoly', resource: r })) setMonopoly(false)
        return
      }
      if (!trading) return
      const ratios = tradeRatios(view, me)
      const give = deal?.give ?? emptyHand()
      // what on the tray pays for it: exactly the bank's rate of one kind, or else enough of one kind
      const kinds = RESOURCES.filter((g) => g !== r && give[g] >= ratios[g])
      const g = kinds.find((k) => give[k] === ratios[k]) ?? kinds[0]
      if (!g) return say(`The bank wants ${Math.min(...RESOURCES.filter((k) => k !== r).map((k) => ratios[k]))} of a kind`)
      if (await act({ type: 'bankTrade', give: g, get: r })) {
        const left = add(give, g, -ratios[g])
        setDeal(handSize(left) || handSize(deal?.get ?? emptyHand()) ? { ...(deal as Deal), give: left } : null)
      }
    },
    deck: () => {
      if (!main) return
      if (!affordable(view, me, 'card')) return say('1 wool, 1 grain, 1 ore')
      act({ type: 'buyCard' })
    },
    dev: (c: Card) => {
      if (c === 'knight') act({ type: 'playKnight' })
      else if (c === 'roadBuilding') act({ type: 'playRoadBuilding' })
      else if (c === 'yearOfPlenty') (setPlenty([]), setDeal(null))
      else if (c === 'monopoly') (setMonopoly(true), setDeal(null))
    },
    supply: (w: Build) => {
      if (building === w) return setBuilding(null)
      if (!can[w]) {
        const pieces = view.players[me].pieces[w]
        if (!pieces) return say(`No ${w === 'city' ? 'cities' : w + 's'} left`)
        if (!affordable(view, me, w)) return say(Object.entries(COST[w]).map(([r, n]) => `${n} ${r}`).join(', '))
        return say('Nowhere to build that yet')
      }
      setBuilding(w)
    },
    opponent: (p: number) => {
      if (victims.includes(p)) return act({ type: 'steal', victim: p })
      if (myOffer && myOffer.to === undefined && myOffer.accepted.includes(p)) return act({ type: 'confirmTrade', with: p })
      if (!trading || !deal) return
      if (!handSize(deal.give) || !handSize(deal.get)) return say(handSize(deal.give) ? 'Pick what you want' : 'Put your cards on the tray')
      act({ type: 'offerTrade', give: deal.give, get: deal.get, to: p })
    },
  }

  // keys: R roll, E end turn, Esc put everything back
  useEffect(() => {
    const f = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setBuilding(null)
        setDeal(null)
        setPlenty(null)
        setMonopoly(false)
      }
      if (!mine) return
      if (e.key.toLowerCase() === 'r' && ph.kind === 'roll') act({ type: 'roll' })
      if (e.key.toLowerCase() === 'e' && ph.kind === 'main' && !myOffer) act({ type: 'endTurn' })
    }
    window.addEventListener('keydown', f)
    return () => window.removeEventListener('keydown', f)
  }, [mine, ph.kind, myOffer])

  // labels and buttons scale with the table (so they keep their places on it, on any screen)
  const project = useProjector()
  const [ax] = project(0, 0, 0)
  const [bx] = project(100, 0, 0)
  const k = Math.min(1.2, Math.max(0.5, Math.abs(bx - ax) / 100 || 1))

  const lastRoll = [...view.events].reverse().find((e) => e.k === 'roll')
  const dice = view.dice ?? (lastRoll?.k === 'roll' ? lastRoll.dice : null)
  const devs = view.players[me]?.cards ?? []

  return (
    <div className="game" style={{ ['--k' as string]: k }}>
      <TableView
        tiles={view.tiles}
        harbors={view.harbors}
        buildings={view.buildings}
        roads={view.roads}
        robber={view.robber}
        colors={view.players.map((p) => p.color)}
        picking={picking}
        you={me}
        onPick={onPick}
        dice={dice}
        rolls={view.rolls}
        onRoll={mine && ph.kind === 'roll' ? () => act({ type: 'roll' }) : undefined}
        events={view.events}
        view={view}
        layout={layout}
        hand={shownHand}
        tray={tray}
        building={building}
        can={{
          hand: !!hand && (trading || owe > 0),
          tray: (trading && !!deal) || owe > 0,
          wants: trading,
          bank: trading || !!plenty || monopoly,
          deck: main,
          supply: { road: can.road, settlement: can.settlement, city: can.city },
          supplyTap: main,
          dev: Object.fromEntries(devs.map((c) => [c.card, playable(c.card)])),
          opponents: victims.length ? victims : trading ? layout.seats.map((s) => s.p) : [],
        }}
        on={on}
      />

      <Lines view={view} plenty={plenty} monopoly={monopoly} owe={owe} />

      <Labels view={view} layout={layout} hand={shownHand} />

      {tray && (
        <TrayMarks
          view={view}
          layout={layout}
          deal={deal}
          setDeal={setDeal}
          toMe={toMe}
          myOffer={myOffer}
          owe={owe}
          drop={drop}
        />
      )}

      <div className="corner">
        {mine && ph.kind === 'roll' && (
          <button className="stamp-btn go big" onClick={() => act({ type: 'roll' })}>
            Roll
          </button>
        )}
        {main && (
          <button className="stamp-btn go big" disabled={!!myOffer} onClick={() => act({ type: 'endTurn' })}>
            End turn
          </button>
        )}
      </div>

      <button className="history-btn stamp-btn" onClick={() => setHistory((h) => !h)}>
        {history ? 'Close' : 'History'}
      </button>
      {history && (
        <aside className="drawer paper">
          <Chronicle view={view} />
          <button className="link" onClick={() => confirm('Leave this game?') && room.leave()}>
            Leave the game
          </button>
        </aside>
      )}

      {ph.kind === 'over' && <GameOver view={view} />}
      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}

// ---------------------------------------------------------------- the two lines at the top

function Lines(props: { view: View; plenty: Resource[] | null; monopoly: boolean; owe: number }) {
  const { view, plenty, monopoly, owe } = props
  const ph = view.phase
  const mine = view.current === view.you
  const who = <Who view={view} p={view.current} you={false} />
  let todo: React.ReactNode = mine ? 'Your turn' : <>{who}'s turn</>
  if (mine && ph.kind === 'setup') todo = ph.step === 'settlement' ? 'Place a settlement' : 'Place a road'
  if (ph.kind === 'discard') todo = owe ? `Discard ${owe}` : 'Waiting for discards'
  if (mine && ph.kind === 'robber') todo = 'Move the robber'
  if (mine && ph.kind === 'steal') todo = 'Steal a card'
  if (mine && ph.kind === 'roadBuilding') todo = `Place ${ph.left} road${ph.left > 1 ? 's' : ''}`
  if (mine && plenty) todo = `Take ${2 - plenty.length} from the bank`
  if (mine && monopoly) todo = 'Name a card from the bank'
  if (ph.kind === 'over') todo = <>{<Who view={view} p={ph.winner} />} won!</>
  const last = [...view.events].reverse().find((e) => e.k !== 'turn' && e.k !== 'answer')
  return (
    <div className="lines">
      <div className={`todo ${mine ? 'mine' : ''}`}>{todo}</div>
      {last && <div className="happened" key={last.n}>{describe(view, last)}</div>}
    </div>
  )
}

// ---------------------------------------------------------------- labels on the table

function Labels({ view, layout, hand }: { view: View; layout: ReturnType<typeof layoutFor>; hand: Hand | null }) {
  const project = useProjector()
  const me = view.you
  const corner = ([x, z]: Spot, n: number) => {
    const [sx, sy] = project(x + CARD.w / 2 - 4, Math.min(n, 12) * (CARD.t + 0.12) + 2, z - CARD.d / 2 + 4)
    return { left: sx, top: sy }
  }
  const at = ([x, z]: Spot, y = 4) => {
    const [sx, sy] = project(x, y, z)
    return { left: sx, top: sy }
  }
  const count = (key: string, spot: Spot, n: number) =>
    n > 1 ? (
      <span key={key} className="count" style={corner(spot, n)}>
        {n}
      </span>
    ) : null
  const o = view.offer
  const pl = me >= 0 ? view.players[me] : null
  return (
    <div className="labels">
      {hand && RESOURCES.map((r, i) => count(`h${r}`, layout.hand[i], hand[r]))}
      {layout.seats.map(({ p, at: spot }) => {
        const op = view.players[p]
        const parts = seatParts(spot, layout.portrait)
        // during your open offer: who has said yes (click their cards to trade) and who said no
        const answer = o && o.from === me && o.to === undefined ? (o.accepted.includes(p) ? 'yes' : o.declined.includes(p) ? 'no' : 'wait') : null
        return (
          <span key={`s${p}`}>
            {count(`oh${p}`, parts.hand, op.handCount)}
            <span className={`name ${view.current === p ? 'turn' : ''}`} style={{ ...at(parts.label), ['--pc' as string]: PLAYER[op.color].ui }}>
              {op.name} <b>{op.points}</b>
              {answer === 'yes' && <i className="mark ok">✓</i>}
              {answer === 'no' && <i className="mark no">✕</i>}
            </span>
          </span>
        )
      })}
      {pl && (
        <span className={`name mine ${view.current === me ? 'turn' : ''}`} style={{ ...at(layout.meLabel), ['--pc' as string]: PLAYER[pl.color].ui }}>
          {pl.name} <b>{pl.points}</b>
        </span>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- the tray's buttons

/** the tray's two marks: a green check and a red cross, beside it */
function TrayMarks({ view, layout, deal, setDeal, toMe, myOffer, owe, drop }: { view: View; layout: ReturnType<typeof layoutFor>; deal: Deal | null; setDeal: (d: Deal | null) => void; toMe: View['offer']; myOffer: View['offer']; owe: number; drop: Hand }) {
  const project = useProjector()
  const [x, y] = project(layout.tray[0] + TRAY.w / 2 + 10, 0, layout.tray[1])
  const style = { left: x, top: y }
  const me = view.you
  let ok: (() => void) | null = null
  let no: (() => void) | null = null
  let okLive = true
  if (toMe) {
    ok = () => act({ type: 'acceptOffer' })
    okLive = RESOURCES.every((r) => (view.players[me].hand?.[r] ?? 0) >= toMe.get[r])
    no = () => act({ type: 'declineOffer' })
  } else if (myOffer) {
    no = () => act({ type: 'cancelOffer' })
  } else if (owe) {
    ok = () => act({ type: 'discard', cards: drop })
    okLive = handSize(drop) === owe
  } else if (deal) {
    // the check puts it to everyone; to offer one player, click their cards
    ok = () => act({ type: 'offerTrade', give: deal.give, get: deal.get })
    okLive = handSize(deal.give) > 0 && handSize(deal.get) > 0 && !RESOURCES.some((r) => deal.give[r] && deal.get[r])
    no = () => setDeal(null)
  }
  return (
    <div className="marks" style={style}>
      {ok && (
        <button className="mark-btn ok" disabled={!okLive} onClick={ok} aria-label="Yes">
          ✓
        </button>
      )}
      {no && (
        <button className="mark-btn no" onClick={no} aria-label="No">
          ✕
        </button>
      )}
    </div>
  )
}

function GameOver({ view }: { view: View }) {
  const ph = view.phase
  if (ph.kind !== 'over') return null
  const order = view.players.map((p, i) => ({ p, i })).sort((a, b) => b.p.points - a.p.points)
  return (
    <div className="dialog-back">
      <div className="paper dialog">
        <div className="dialog-head">{ph.winner === view.you ? 'You win!' : `${view.players[ph.winner].name} wins!`}</div>
        <div className="scores">
          {order.map(({ p, i }) => (
            <div key={p.id} className="score">
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
      </div>
    </div>
  )
}
