/**
 * The game: the whole screen is the table. Everything you do, you do to things on it (see three/table/Table.tsx).
 * On top there's only: what to do now, what just happened, one button for the turn, the tray's few buttons,
 * small counts on the stacks, everyone's name and points, and a History panel that stays shut until you open it.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { affordable, canPlay, citySpots, roadSpots, robberSpots, settlementSpots, tradeRatios, type View } from '../../../shared/engine.ts'
import { COST, RESOURCES, emptyHand, handSize, type Card, type Hand, type Resource } from '../../../shared/rules.ts'
import { PLAYER, RESOURCE_NAME } from '../lib/palette.ts'
import { act, room, toast as say, useStore } from '../net.ts'
import type { PickKind, Picking } from '../three/Board.tsx'
import { useProjector } from '../three/labels.ts'
import { TableView, type TrayContents } from '../three/table/Table.tsx'
import { CARD, TRAY, layoutFor, seatParts, type Spot } from '../three/table/layout.ts'
import { publishState } from '../three/TestHook.tsx'
import { Bundle, Cost } from './Cards.tsx'
import { Chronicle, describe, Who } from './Chronicle.tsx'

type Build = 'road' | 'settlement' | 'city'
type Deal = { give: Hand; get: Hand; to: 'bank' | number | null }

const add = (h: Hand, r: Resource, d = 1): Hand => ({ ...h, [r]: Math.max(0, h[r] + d) })
const minus = (a: Hand, b: Partial<Hand>): Hand => Object.fromEntries(RESOURCES.map((r) => [r, a[r] - (b[r] ?? 0)])) as Hand

/** what the bank would do with this trade (harbour rates included), or why not */
function bankPlan(view: View, d: Deal): { ok: boolean; why: string; pairs: [Resource, Resource][] } {
  const ratios = tradeRatios(view, view.you)
  const give = RESOURCES.filter((r) => d.give[r] > 0)
  const get = RESOURCES.filter((r) => d.get[r] > 0)
  if (!give.length || !get.length) return { ok: false, why: '', pairs: [] }
  if (give.some((r) => d.get[r] > 0)) return { ok: false, why: "can't give and get the same thing", pairs: [] }
  const odd = give.find((r) => d.give[r] % ratios[r] !== 0)
  if (odd) return { ok: false, why: `the bank takes ${RESOURCE_NAME[odd].toLowerCase()} ${ratios[odd]} for 1`, pairs: [] }
  const out = give.flatMap((r) => Array<Resource>(d.give[r] / ratios[r]).fill(r))
  const into = get.flatMap((r) => Array<Resource>(d.get[r]).fill(r))
  if (out.length !== into.length) return { ok: false, why: `that's ${out.length} from the bank, not ${into.length}`, pairs: [] }
  if (get.some((r) => view.bank[r] < d.get[r])) return { ok: false, why: 'the bank is out of that', pairs: [] }
  return { ok: true, why: '', pairs: out.map((r, i) => [r, into[i]]) }
}

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
      if (!trading) return say(mine ? 'Finish what you are doing first.' : 'You can trade on your turn, after rolling.')
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
      if (!trading) return say('You can trade with the bank on your turn, after rolling.')
      openDeal({ get: add(deal?.get ?? emptyHand(), r), to: 'bank' })
    },
    deck: () => {
      if (!main) return say('Buy a card on your turn, after rolling.')
      if (!affordable(view, me, 'card')) return say('A development card costs 1 wool, 1 grain and 1 ore.')
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
        if (!pieces) return say(`You have no ${w === 'city' ? 'cities' : w + 's'} left.`)
        if (!affordable(view, me, w)) return say(`A ${w} costs ${Object.entries(COST[w]).map(([r, n]) => `${n} ${r}`).join(', ')}.`)
        return say(`There's nowhere to build a ${w} yet.`)
      }
      setBuilding(w)
    },
    opponent: (p: number) => {
      if (victims.includes(p)) return act({ type: 'steal', victim: p })
      if (trading) openDeal({ to: p })
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

  const lastRoll = [...view.events].reverse().find((e) => e.k === 'roll')
  const dice = view.dice ?? (lastRoll?.k === 'roll' ? lastRoll.dice : null)
  const devs = view.players[me]?.cards ?? []

  return (
    <div className="game">
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

      <Lines view={view} building={building} deal={deal} plenty={plenty} monopoly={monopoly} victims={victims} owe={owe} />

      <Labels view={view} layout={layout} hand={shownHand} victims={victims} building={building} />

      {tray && (
        <TrayButtons
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

function Lines(props: { view: View; building: Build | null; deal: Deal | null; plenty: Resource[] | null; monopoly: boolean; victims: number[]; owe: number }) {
  const { view, building, deal, plenty, monopoly, victims, owe } = props
  const ph = view.phase
  const mine = view.current === view.you
  const who = <Who view={view} p={view.current} you={false} />
  let todo: React.ReactNode
  switch (ph.kind) {
    case 'setup':
      todo = mine ? (ph.step === 'settlement' ? 'Place a settlement on a white spot' : 'Now a road next to it') : <>{who} is placing a {ph.step}</>
      break
    case 'roll':
      todo = mine ? 'Your turn: roll the dice' : <>{who} is rolling</>
      break
    case 'discard':
      todo = owe ? `Too many cards: put ${owe} on the tray to discard` : 'Waiting for discards'
      break
    case 'robber':
      todo = mine ? 'Move the robber: click a tile' : <>{who} is moving the robber</>
      break
    case 'steal':
      todo = mine && victims.length ? "Steal: click someone's cards" : <>{who} is stealing</>
      break
    case 'roadBuilding':
      todo = mine ? `Place ${ph.left} free road${ph.left > 1 ? 's' : ''}` : <>{who} is building roads</>
      break
    case 'main':
      todo = !mine ? (
        <>{who}'s turn</>
      ) : plenty ? (
        `Year of Plenty: click ${2 - plenty.length} bank card${plenty.length ? '' : 's'}`
      ) : monopoly ? (
        'Monopoly: click a bank card to name it'
      ) : building ? (
        `Click a white mark to build your ${building}`
      ) : deal ? (
        'Trading: your cards go near you, what you want goes far'
      ) : (
        'Build, trade, or end your turn'
      )
      break
    case 'over':
      todo = <>{<Who view={view} p={ph.winner} />} won!</>
      break
  }
  const last = [...view.events].reverse().find((e) => e.k !== 'turn' && e.k !== 'answer')
  return (
    <div className="lines">
      <div className={`todo ${mine ? 'mine' : ''}`}>{todo}</div>
      {last && <div className="happened" key={last.n}>{describe(view, last)}</div>}
    </div>
  )
}

// ---------------------------------------------------------------- labels on the table

function Labels({ view, layout, hand, victims, building }: { view: View; layout: ReturnType<typeof layoutFor>; hand: Hand | null; victims: number[]; building: Build | null }) {
  const project = useProjector()
  const me = view.you
  const corner = ([x, z]: Spot, n: number, small = false) => {
    const k = small ? CARD.small : 1
    const [sx, sy] = project(x + (CARD.w * k) / 2 - 3, Math.min(n, 12) * CARD.t + 2, z - (CARD.d * k) / 2 + 3)
    return { left: sx, top: sy }
  }
  const at = ([x, z]: Spot, y = 4) => {
    const [sx, sy] = project(x, y, z)
    return { left: sx, top: sy }
  }
  const count = (key: string, spot: Spot, n: number, extra = '') =>
    n > 0 ? (
      <span key={key} className={`count ${extra}`} style={corner(spot, n)}>
        {n}
      </span>
    ) : null
  const pl = me >= 0 ? view.players[me] : null
  const devs = pl?.cards ?? []
  const devKinds = [...new Set(devs.map((c) => c.card))]
  return (
    <div className="labels">
      {hand && RESOURCES.map((r, i) => count(`h${r}`, layout.hand[i], hand[r]))}
      {RESOURCES.map((r, i) => count(`b${r}`, layout.bank[i], view.bank[r], 'bank'))}
      {count('deck', layout.deck, view.pile, 'bank')}
      {devKinds.map((c, i) => count(`d${c}`, layout.dev(i), devs.filter((x) => x.card === c).length))}
      {layout.seats.map(({ p, at: spot }) => {
        const o = view.players[p]
        const parts = seatParts(spot, layout.portrait)
        return (
          <span key={`s${p}`}>
            {count(`oh${p}`, parts.hand, o.handCount)}
            {count(`od${p}`, parts.dev, o.cardCount)}
            {count(`ok${p}`, parts.knights, o.knights)}
            <span className={`name ${view.current === p ? 'turn' : ''}`} style={{ ...at(parts.label), ['--pc' as string]: PLAYER[o.color].ui }}>
              {o.name} <b>{o.points}</b>
            </span>
            {victims.includes(p) && (
              <span className="steal-tag" style={at(parts.hand, 14)}>
                steal
              </span>
            )}
          </span>
        )
      })}
      {pl && (
        <>
          <span className={`name mine ${view.current === me ? 'turn' : ''}`} style={{ ...at(layout.meLabel), ['--pc' as string]: PLAYER[pl.color].ui }}>
            You <b>{pl.points}</b>
          </span>
          {!layout.portrait && (['road', 'settlement', 'city'] as const).map((w) => (
            <span key={w} className={`supply-tag ${building === w ? 'up' : ''}`} style={at([layout.supply[w][0], layout.supply[w][1] + 30], 2)} title={`${w}: ${pl.pieces[w]} left`}>
              <Cost of={COST[w]} />
            </span>
          ))}
          {!layout.portrait && (
            <span className="supply-tag deck-tag" style={at([layout.deck[0], layout.deck[1] + 36], 2)} title="A development card">
              <Cost of={COST.card} />
            </span>
          )}
        </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- the tray's buttons

function TrayButtons({ view, layout, deal, setDeal, toMe, myOffer, owe, drop }: { view: View; layout: ReturnType<typeof layoutFor>; deal: Deal | null; setDeal: (d: Deal | null) => void; toMe: View['offer']; myOffer: View['offer']; owe: number; drop: Hand }) {
  const project = useProjector()
  // pinned under the tray's near edge, kept on screen
  const [x, y] = project(layout.tray[0] - TRAY.w / 2, 0, layout.tray[1] + TRAY.d / 2 + 6)
  const style = { left: Math.max(8, x), top: y }
  const me = view.you
  const others = layout.seats.map((s) => s.p)

  if (toMe) {
    return (
      <div className="tray-ui" style={style}>
        <span>
          <Who view={view} p={toMe.from} /> wants to trade
        </span>
        <span className="tray-row">
          <button className="stamp-btn go" disabled={!RESOURCES.every((r) => (view.players[me].hand?.[r] ?? 0) >= toMe.get[r])} onClick={() => act({ type: 'acceptOffer' })}>
            Accept
          </button>
          <button className="stamp-btn" onClick={() => act({ type: 'declineOffer' })}>
            No thanks
          </button>
        </span>
      </div>
    )
  }
  if (myOffer) {
    const to = myOffer.to
    return (
      <div className="tray-ui" style={style}>
        {to !== undefined ? (
          <span>
            Waiting for <Who view={view} p={to} />…
          </span>
        ) : (
          <span className="tray-row">
            {others.map((p) =>
              myOffer.accepted.includes(p) ? (
                <button key={p} className="stamp-btn go" onClick={() => act({ type: 'confirmTrade', with: p })}>
                  Trade with {view.players[p].name}
                </button>
              ) : null,
            )}
          </span>
        )}
        <button className="stamp-btn" onClick={() => act({ type: 'cancelOffer' })}>
          Take it back
        </button>
      </div>
    )
  }
  if (owe) {
    return (
      <div className="tray-ui" style={style}>
        <button className="stamp-btn go" disabled={handSize(drop) !== owe} onClick={() => act({ type: 'discard', cards: drop })}>
          Discard {handSize(drop)} of {owe}
        </button>
      </div>
    )
  }
  if (!deal) return null
  const plan = bankPlan(view, deal)
  const ready = handSize(deal.give) > 0 && handSize(deal.get) > 0 && !RESOURCES.some((r) => deal.give[r] && deal.get[r])
  const trade = async () => {
    for (const [give, get] of plan.pairs) if (!(await act({ type: 'bankTrade', give, get }))) break
    setDeal(null)
  }
  return (
    <div className="tray-ui" style={style}>
      <span className="tray-row">
        <button className={`stamp-btn ${deal.to === 'bank' ? 'go' : ''}`} disabled={!plan.ok} onClick={trade} title={plan.why}>
          Trade with the bank
        </button>
        {others.map((p) => (
          <button
            key={p}
            className={`stamp-btn who-btn ${deal.to === p ? 'go' : ''}`}
            style={{ ['--pc' as string]: PLAYER[view.players[p].color].ui }}
            disabled={!ready}
            onClick={() => act({ type: 'offerTrade', give: deal.give, get: deal.get, to: p })}
          >
            Offer {view.players[p].name}
          </button>
        ))}
        <button className="stamp-btn" onClick={() => setDeal(null)}>
          Put back
        </button>
      </span>
      {!plan.ok && plan.why && <small className="why">Bank: {plan.why}</small>}
      {plan.ok && (
        <small className="why">
          Bank: <Bundle of={deal.give} /> for <Bundle of={deal.get} />
        </small>
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
