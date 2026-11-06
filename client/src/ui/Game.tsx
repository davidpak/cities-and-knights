/**
 * The game: the whole screen is the table. Everything you do, you do to things on it (see three/table/Table.tsx).
 * On top there's only: what to do now, what just happened, one button for the turn, the tray's few buttons,
 * small counts on the stacks, everyone's name and points, and a History panel that stays shut until you open it.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  affordable, canAct, canPlay, chaseSpots, citySpots, improveCost, knightMoves, knightSpots, pickTargets, promoteSpots,
  roadSpots, robberSpots, settlementSpots, tradeRatios, wallSpots, type PickNeed, type View,
} from '../../../shared/engine.ts'
import { BARBARIAN_STEPS, COST, GOODS, KNIGHT_COST, PROGRESS, RESOURCES, TRACKS, TRACK_NAME, emptyHand, handSize, hasAll, type Card, type Good, type Hand, type Progress, type Resource, type Track } from '../../../shared/rules.ts'
import { PLAYER, TRACK_COLOR } from '../lib/palette.ts'
import { act, room, toast as say, useStore } from '../net.ts'
import { GLOW_AT, type PickKind, type Picking } from '../three/Board.tsx'
import { useProjector } from '../three/labels.ts'
import { TableView, packHand, type TrayContents } from '../three/table/Table.tsx'
import { CARD, TRAY, layoutFor, seatParts, type Spot } from '../three/table/layout.ts'
import { publishState } from '../three/TestHook.tsx'
import { Bundle } from './Cards.tsx'
import { Chronicle, describe, Who } from './Chronicle.tsx'

type Build = 'road' | 'settlement' | 'city' | 'knight' | 'wall'
type Deal = { give: Hand; get: Hand; to: 'bank' | number | null }

const add = (h: Hand, r: Good, d = 1): Hand => ({ ...h, [r]: Math.max(0, h[r] + d) })
const minus = (a: Hand, b: Partial<Hand>): Hand => Object.fromEntries(GOODS.map((r) => [r, Math.max(0, a[r] - (b[r] ?? 0))])) as Hand

/** what each kind of pick asks for, in a few words */
const PICK_WORDS: Record<PickNeed, string> = {
  hex: 'Pick a tile',
  road: 'Pick a road with an open end',
  enemyKnight: "Pick someone else's knight",
  knightSpot: 'Pick a corner for your knight',
  player: "Click someone's cards",
  resource: 'Click a resource in the bank',
  commodity: 'Click a commodity in the bank',
  good: 'Click a kind of card in the bank',
  number: 'Click a tile with the number you want',
  myCity: 'Pick one of your cities',
  mySettlement: 'Pick one of your settlements',
  token: 'Pick a number token to swap',
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
  // an offer you're part of and haven't turned down (toMe: and haven't answered yet)
  const inOffer = offer && me >= 0 && offer.from !== me && (offer.to === undefined || offer.to === me) && !offer.declined.includes(me) ? offer : null
  const toMe = inOffer && !inOffer.accepted.includes(me) ? inOffer : null
  const owe = ph.kind === 'discard' ? ph.owed[me] ?? 0 : 0

  const aspect = useAspect()
  const knightsMode = !!view.x
  const layout = useMemo(() => layoutFor(view.players.length, me < 0 ? 0 : me, aspect, knightsMode), [view.players.length, me, aspect, knightsMode])

  const [building, setBuilding] = useState<Build | null>(null)
  const [deal, setDeal] = useState<Deal | null>(null)
  const [drop, setDrop] = useState<Hand>(emptyHand()) // cards picked to discard
  const [plenty, setPlenty] = useState<Resource[] | null>(null)
  const [monopoly, setMonopoly] = useState(false)
  const [history, setHistory] = useState(false)
  /** a finger has shown a piece on the board: tap it again to place it */
  const [armed, setArmed] = useState(false)
  /** the expansion: one of your ready knights, picked up to move (or to chase the robber) */
  const [selected, setSelected] = useState<number | null>(null)

  // a choice lasts only while it still makes sense
  useEffect(() => {
    if (!main) {
      setBuilding(null)
      setDeal(null)
      setPlenty(null)
      setMonopoly(false)
      setSelected(null)
    }
  }, [main])
  useEffect(() => setSelected(null), [view.x?.knights && JSON.stringify(view.x.knights)])
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
    // the expansion: a new knight (or a stronger one), a wall
    knight:
      main && !!view.x && !!hand &&
      ((view.players[me].pieces.knight[1] > 0 && hasAll(hand, KNIGHT_COST.knight) && knightSpots(view, me).length > 0) || (promoteSpots(view, me).length > 0 && hasAll(hand, KNIGHT_COST.promote))),
    wall: main && !!view.x && !!hand && wallSpots(view, me).length > 0 && hasAll(hand, KNIGHT_COST.wall),
  }
  const canImprove = Object.fromEntries(
    TRACKS.map((t) => {
      const cost = main && hand && view.x ? improveCost(view, me, t) : null
      return [t, !!cost && !!hand && hasAll(hand, cost)]
    }),
  ) as Record<Track, boolean>
  const pickPhase = mine && ph.kind === 'pick' ? ph : null
  const targets = pickPhase ? pickTargets(view, me) : []
  const myKnights = view.x ? Object.entries(view.x.knights).filter(([, k]) => k.owner === me).map(([v]) => Number(v)) : []
  const picking: Picking = useMemo(() => {
    if (!mine) return null
    if (ph.kind === 'setup') return ph.step === 'settlement' ? { kind: 'settlement', spots: settlementSpots(view, me) } : { kind: 'road', spots: roadSpots(view, me) }
    if (ph.kind === 'roadBuilding') return { kind: 'road', spots: roadSpots(view, me) }
    if (ph.kind === 'robber') return { kind: 'robber', spots: robberSpots(view) }
    // a progress card pointing at something on the board
    if (pickPhase) {
      const t = targets as number[]
      switch (pickPhase.need) {
        case 'hex':
        case 'token':
          return { kind: 'hex', spots: t }
        case 'number':
          return { kind: 'hex', spots: view.tiles.map((tile, i) => ({ tile, i })).filter(({ tile }) => tile.number !== null && t.includes(tile.number)).map(({ i }) => i) }
        case 'road':
          return { kind: 'edge', spots: t }
        case 'enemyKnight':
        case 'knightSpot':
        case 'myCity':
        case 'mySettlement':
          return { kind: 'vertex', spots: t }
      }
      return null
    }
    if (main && building === 'knight') return { kind: 'vertex', spots: [...knightSpots(view, me).filter(() => view.players[me].pieces.knight[1] > 0 && !!hand && hasAll(hand, KNIGHT_COST.knight)), ...(hand && hasAll(hand, KNIGHT_COST.promote) ? promoteSpots(view, me) : [])] }
    if (main && building === 'wall') return { kind: 'vertex', spots: wallSpots(view, me) }
    if (main && selected !== null) return { kind: 'vertex', spots: [...knightMoves(view, selected), ...(chaseSpots(view, me).includes(selected) ? [-1 - view.robber] : [])] }
    if (main && building === 'road') return { kind: 'road', spots: roadSpots(view, me) }
    if (main && building === 'settlement') return { kind: 'settlement', spots: settlementSpots(view, me) }
    if (main && building === 'city') return { kind: 'city', spots: citySpots(view, me) }
    // otherwise your knights on the board can be clicked (to ready one, or to pick up a ready one)
    if (main && myKnights.length && !deal) return { kind: 'quiet', spots: myKnights }
    return null
  }, [mine, main, ph, building, view, me, selected, deal])

  const onPick = async (kind: PickKind, id: number) => {
    if (pickPhase) {
      const target = pickPhase.need === 'number' ? view.tiles[id].number! : id
      await act({ type: 'pick', target })
      return
    }
    if (kind === 'quiet') {
      const k = view.x!.knights[id]
      if (!k.active) {
        if (!hand || !hasAll(hand, KNIGHT_COST.activate)) return say('Readying a knight takes 1 grain')
        await act({ type: 'activateKnight', vertex: id })
      } else if (!canAct(view, id)) say('Readied this turn: it can act from your next turn')
      else setSelected(id)
      return
    }
    if (building === 'knight') {
      if (view.x!.knights[id]) await act({ type: 'promoteKnight', vertex: id })
      else await act({ type: 'buildKnight', vertex: id })
      setBuilding(null)
      return
    }
    if (building === 'wall') {
      await act({ type: 'buildWall', vertex: id })
      setBuilding(null)
      return
    }
    if (selected !== null) {
      if (id < 0) await act({ type: 'chaseRobber', from: selected })
      else await act({ type: 'moveKnight', from: selected, to: id })
      setSelected(null)
      return
    }
    if (kind === 'robber') await act({ type: 'moveRobber', hex: id })
    else if (kind === 'road') await act({ type: 'buildRoad', edge: id })
    else if (kind === 'settlement') await act({ type: 'buildSettlement', vertex: id })
    else await act({ type: 'buildCity', vertex: id })
    setBuilding(null)
  }

  const victims = ph.kind === 'steal' && mine ? ph.victims : []
  const progressOwed = ph.kind === 'progressDiscard' ? ph.owed[me] ?? 0 : 0
  const myProgress = view.players[me]?.progress ?? []
  const progressPlayable = (c: Progress) => progressOwed > 0 || (mine && !myOffer && (c === 'augury' ? ph.kind === 'roll' : ph.kind === 'main'))
  const trading = main && !myOffer && !plenty && !monopoly
  const openDeal = (d: Partial<Deal>) => setDeal((cur) => ({ give: cur?.give ?? emptyHand(), get: cur?.get ?? emptyHand(), to: cur?.to ?? null, ...d }))
  const playable = (c: Card) => mine && c !== 'victoryPoint' && canPlay(view, me, c) && (c === 'knight' ? ph.kind === 'roll' || ph.kind === 'main' : ph.kind === 'main')

  // the tray shows: an offer made to you, your own offer waiting, your discard, or the trade you're putting together
  let tray: TrayContents | null = null
  if (inOffer) tray = { mode: 'trade', give: inOffer.get, get: inOffer.give, locked: true }
  else if (myOffer) tray = { mode: 'trade', give: myOffer.give, get: myOffer.get, locked: true }
  else if (owe) tray = { mode: 'discard', give: drop, get: {} }
  else if (deal) tray = { mode: 'trade', give: deal.give, get: deal.get }
  // what's on the tray came out of your hand (an offer to you shows what you'd hand over)
  const onTray = owe ? drop : myOffer ? myOffer.give : inOffer ? inOffer.get : deal ? deal.give : {}
  const shownHand = hand ? minus(hand, onTray) : null
  useEffect(
    () =>
      publishState({
        view,
        picking,
        // where things are on the table, for browser tests
        spots: {
          // (by kind, in the usual order: where each kind you hold lies now)
          hand: (() => {
            const kinds = view.x ? GOODS : RESOURCES
            const h = shownHand
            const at = packHand(layout.hand, kinds, h, layout.handEnd)
            return kinds.map((r) => at[r])
          })(),
          bank: layout.bank,
          deck: layout.deck,
          dev: [0, 1, 2, 3, 4].map((i) => layout.dev(i, shownHand ? (view.x ? GOODS : RESOURCES).filter((r) => shownHand[r] > 0).length : 0)),
          wants: layout.hand.map((_, i) => layout.wants(i)),
          supply: layout.supply,
          k: layout.k,
          seats: layout.seats.map((s) => ({ p: s.p, hand: seatParts(s.at, layout).hand })),
          tray: layout.tray,
        },
      }),
    [view, picking, layout, shownHand],
  )

  const on = {
    hand: (r: Good) => {
      if (owe) return handSize(drop) < owe && setDrop(add(drop, r))
      if (!trading) return
      openDeal({ give: add(deal?.give ?? emptyHand(), r) })
    },
    trayGive: (r: Good) => (owe ? setDrop(add(drop, r, -1)) : deal && setDeal({ ...deal, give: add(deal.give, r, -1) })),
    trayGet: (r: Good) => deal && setDeal({ ...deal, get: add(deal.get, r, -1) }),
    want: (r: Good) => openDeal({ get: add(deal?.get ?? emptyHand(), r) }),
    bank: async (r: Good) => {
      if (pickPhase && targets.includes(r)) return act({ type: 'pick', target: r })
      if (plenty) {
        const picks = [...plenty, r as Resource]
        if (picks.length < 2) return setPlenty(picks)
        if (await act({ type: 'playYearOfPlenty', take: picks as [Resource, Resource] })) setPlenty(null)
        return
      }
      if (monopoly) {
        if (await act({ type: 'playMonopoly', resource: r as Resource })) setMonopoly(false)
        return
      }
      if (!trading) return
      const ratios = tradeRatios(view, me)
      const give = deal?.give ?? emptyHand()
      // what on the tray pays for it: exactly the bank's rate of one kind, or else enough of one kind
      const all: readonly Good[] = view.x ? GOODS : RESOURCES
      const kinds = all.filter((g) => g !== r && give[g] >= ratios[g])
      const g = kinds.find((k) => give[k] === ratios[k]) ?? kinds[0]
      if (!g) return say(`The bank wants ${Math.min(...all.filter((k) => k !== r).map((k) => ratios[k]))} of a kind`)
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
    progress: (c: Progress) => {
      if (progressOwed) return act({ type: 'discardProgress', card: c })
      setBuilding(null)
      setSelected(null)
      act({ type: 'playProgress', card: c })
    },
    knight: () => {
      setSelected(null)
      if (building === 'knight') return setBuilding(null)
      if (!can.knight) return say(view.players[me].pieces.knight[1] === 0 && promoteSpots(view, me).length === 0 ? 'No knights left' : '1 wool, 1 ore')
      setBuilding('knight')
    },
    wall: () => {
      if (building === 'wall') return setBuilding(null)
      if (!can.wall) return say(view.players[me].pieces.wall === 0 ? 'No walls left' : wallSpots(view, me).length ? '2 brick' : 'A wall goes round one of your cities')
      setBuilding('wall')
    },
    improve: (t: Track) => {
      if (!main) return
      if (!canImprove[t]) {
        const cost = improveCost(view, me, t)
        return say(cost ? `${TRACK_NAME[t]}: ${Object.entries(cost).map(([g, n]) => `${n} ${g}`).join(', ')}` : view.x!.levels[me][t] >= 5 ? `${TRACK_NAME[t]} is complete` : 'You need a city first')
      }
      act({ type: 'improve', track: t })
    },
    supply: (w: Build) => {
      if (building === w) return setBuilding(null)
      if (w === 'knight' || w === 'wall') return
      if (!can[w]) {
        const pieces = view.players[me].pieces[w] as number
        if (!pieces) return say(`No ${w === 'city' ? 'cities' : w + 's'} left`)
        if (!affordable(view, me, w as 'road')) return say(Object.entries(COST[w as 'road']).map(([r, n]) => `${n} ${r}`).join(', '))
        return say('Nowhere to build that yet')
      }
      setBuilding(w)
    },
    opponent: (p: number) => {
      if (pickPhase && targets.includes(p)) return act({ type: 'pick', target: p })
      if (victims.includes(p)) return act({ type: 'steal', victim: p })
      if (myOffer && myOffer.to === undefined && myOffer.accepted.includes(p)) return act({ type: 'confirmTrade', with: p })
      if (!trading || !deal) return
      if (!handSize(deal.give) || !handSize(deal.get)) return say(handSize(deal.give) ? 'Pick what you want' : 'Put your cards on the tray')
      act({ type: 'offerTrade', give: deal.give, get: deal.get, to: p })
    },
  }

  const acts = trayActs({ view, deal, setDeal, toMe, myOffer, owe, drop })
  // while an offer is up, its panel on the tray holds every button for it
  const offerUp = !!(myOffer || inOffer)

  // keys: R roll, E end turn, Esc put everything back
  useEffect(() => {
    const f = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setBuilding(null)
        setDeal(null)
        setPlenty(null)
        setMonopoly(false)
        setSelected(null)
        if (ph.kind === 'pick' && ph.step === 0 && mine) act({ type: 'cancelPick' })
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
        onArm={setArmed}
        dice={dice}
        rolls={view.rolls}
        onRoll={mine && ph.kind === 'roll' ? () => act({ type: 'roll' }) : undefined}
        events={view.events}
        extras={view.x}
        view={view}
        layout={layout}
        hand={shownHand}
        tray={tray}
        building={building}
        can={{
          hand: !!hand && (trading || owe > 0),
          tray: (trading && !!deal) || owe > 0,
          wants: trading,
          bank: trading || !!plenty || monopoly || (!!pickPhase && ['resource', 'commodity', 'good'].includes(pickPhase.need)),
          deck: main && !view.x,
          supply: { road: can.road, settlement: can.settlement, city: can.city },
          supplyTap: main,
          dev: Object.fromEntries(devs.map((c) => [c.card, playable(c.card)])),
          opponents: pickPhase?.need === 'player' ? (targets as number[]) : victims.length ? victims : trading ? layout.seats.map((s) => s.p) : [],
          progress: Object.fromEntries(myProgress.map((c) => [c.card, progressPlayable(c.card)])),
          knight: can.knight,
          wall: can.wall,
          improve: canImprove,
        }}
        on={on}
      />

      <Lines view={view} plenty={plenty} monopoly={monopoly} owe={owe} building={building} selected={selected} progressOwed={progressOwed} toMe={toMe} armed={armed && !!picking} />

      <Labels view={view} layout={layout} hand={shownHand} />

      {tray && layout.marks !== 'corner' && !offerUp && <TrayMarks layout={layout} acts={acts} />}
      {offerUp && <OfferPanel view={view} layout={layout} acts={acts} />}

      <RollFlash view={view} layout={layout} />

      <div className="corner">
        {/* on a phone the tray's buttons are here, big, with words */}
        {tray && layout.marks === 'corner' && !offerUp && acts.no && (
          <button className="stamp-btn big no" onClick={acts.no}>
            {acts.noWord}
          </button>
        )}
        {tray && layout.marks === 'corner' && !offerUp && acts.ok && (
          <button className="stamp-btn go big ok" disabled={!acts.okLive} onClick={acts.ok}>
            {acts.okWord}
          </button>
        )}
        {mine && ph.kind === 'roll' && (
          <button className="stamp-btn go big" onClick={() => act({ type: 'roll' })}>
            Roll
          </button>
        )}
        {/* (on a phone, while the tray's buttons are down here, they take the turn button's place) */}
        {main && !(tray && layout.marks === 'corner' && !offerUp && (acts.ok || acts.no)) && (
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

function Lines(props: { view: View; plenty: Resource[] | null; monopoly: boolean; owe: number; building: Build | null; selected: number | null; progressOwed: number; toMe: View['offer']; armed: boolean }) {
  const { view, plenty, monopoly, owe, building, selected, progressOwed, toMe, armed } = props
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
  // the expansion
  if (mine && building === 'knight') todo = 'Place a knight, or click one of yours to make it stronger'
  if (mine && building === 'wall') todo = 'Pick a city to wall'
  if (mine && selected !== null) todo = 'Move your knight, push a weaker one away, or chase the robber'
  let cancel = false
  if (mine && ph.kind === 'pick') {
    todo = (
      <>
        <b>{PROGRESS[ph.card].name}</b>: {PICK_WORDS[ph.need].toLowerCase()}
      </>
    )
    cancel = ph.step === 0
  }
  if (ph.kind === 'progressDiscard') todo = progressOwed ? `Put back ${progressOwed} progress card${progressOwed > 1 ? 's' : ''} (four at most)` : 'Waiting for progress cards to be put back'
  if (ph.kind === 'over') todo = <>{<Who view={view} p={ph.winner} />} won!</>
  if (armed) todo = 'Tap it again to confirm'
  // an offer to you: what you'd get and what you'd give, said plainly (the answer is on the tray's panel)
  if (toMe)
    todo = (
      <>
        <Who view={view} p={toMe.from} you={false} /> offers <Bundle of={toMe.give} /> <span className="for">for your</span> <Bundle of={toMe.get} />
      </>
    )
  const last = [...view.events].reverse().find((e) => e.k !== 'turn' && e.k !== 'answer')
  return (
    <div className="lines">
      <div className={`todo ${mine ? 'mine' : ''} ${toMe ? 'offer' : ''}`}>
        {todo}
        {cancel && (
          <button className="todo-x" onClick={() => act({ type: 'cancelPick' })} aria-label="Put it back">
            ✕
          </button>
        )}
      </div>
      {last && <div className="happened" key={last.n}>{describe(view, last)}</div>}
    </div>
  )
}

// ---------------------------------------------------------------- labels on the table

function Labels({ view, layout, hand }: { view: View; layout: ReturnType<typeof layoutFor>; hand: Hand | null }) {
  const project = useProjector()
  const me = view.you
  const corner = ([x, z]: Spot, n: number, k = 1) => {
    const [sx, sy] = project(x + (CARD.w * k) / 2 - 4, n * CARD.t + 2, z - (CARD.d * k) / 2 + 4)
    return { left: sx, top: sy }
  }
  const at = ([x, z]: Spot, y = 4) => {
    const [sx, sy] = project(x, y, z)
    return { left: sx, top: sy }
  }
  const count = (key: string, spot: Spot, n: number, k = 1) =>
    n > 1 ? (
      <span key={key} className="count" style={corner(spot, n, k)}>
        {n}
      </span>
    ) : null
  const o = view.offer
  const pl = me >= 0 ? view.players[me] : null
  return (
    <div className="labels">
      {hand && (() => {
        const spots = packHand(layout.hand, view.x ? GOODS : RESOURCES, hand, layout.handEnd)
        return (view.x ? GOODS : RESOURCES).map((r) => count(`h${r}`, spots[r], hand[r]))
      })()}
      {/* the bank shows one card of each kind; only a kind running low says how many are left */}
      {(view.x ? GOODS : RESOURCES).map((r, i) =>
        view.bank[r] > 0 && view.bank[r] <= 4 ? (
          <span key={`b${r}`} className="count low" style={at(layout.bank[i], 8)}>
            {view.bank[r]}
          </span>
        ) : null,
      )}

      {layout.seats.map(({ p, at: spot }) => {
        const op = view.players[p]
        const parts = seatParts(spot, layout)
        // during your open offer: who has said yes (click their cards to trade) and who said no
        const answer = o && o.from === me && o.to === undefined ? (o.accepted.includes(p) ? 'yes' : o.declined.includes(p) ? 'no' : 'wait') : null
        return (
          <span key={`s${p}`}>
            {count(`oh${p}`, parts.hand, op.handCount, parts.small ? CARD.small : 1)}
            <span className={`name ${parts.labelStart ? 'start' : ''} ${view.current === p ? 'turn' : ''}`} style={{ ...at(parts.label), ['--pc' as string]: PLAYER[op.color].ui }}>
              {op.name} <b>{op.points}</b>
              {/* the expansion: their three city levels, in the tracks' colours */}
              {view.x && (
                <span className="lvs">
                  {TRACKS.map((t) => (
                    <i key={t} className="lv" style={{ background: TRACK_COLOR[t] }} title={TRACK_NAME[t]}>
                      {view.x!.levels[p][t]}
                    </i>
                  ))}
                </span>
              )}
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

type TrayActs = { ok: (() => void) | null; no: (() => void) | null; okLive: boolean; okWord: string; noWord: string }
/** what the tray's two buttons do now (and what they say, where there's room to say it) */
function trayActs({ view, deal, setDeal, toMe, myOffer, owe, drop }: { view: View; deal: Deal | null; setDeal: (d: Deal | null) => void; toMe: View['offer']; myOffer: View['offer']; owe: number; drop: Hand }): TrayActs {
  const me = view.you
  if (toMe)
    return {
      ok: () => act({ type: 'acceptOffer' }),
      okLive: GOODS.every((r) => (view.players[me].hand?.[r] ?? 0) >= (toMe.get[r] ?? 0)),
      okWord: 'Accept',
      no: () => act({ type: 'declineOffer' }),
      noWord: 'Decline',
    }
  if (myOffer) return { ok: null, okLive: false, okWord: '', no: () => act({ type: 'cancelOffer' }), noWord: 'Take back' }
  if (owe) return { ok: () => act({ type: 'discard', cards: drop }), okLive: handSize(drop) === owe, okWord: `Discard ${owe}`, no: null, noWord: '' }
  if (deal)
    // the check puts it to everyone; to offer one player, click their cards
    return {
      ok: () => act({ type: 'offerTrade', give: deal.give, get: deal.get }),
      okLive: handSize(deal.give) > 0 && handSize(deal.get) > 0 && !GOODS.some((r) => deal.give[r] && deal.get[r]),
      okWord: 'Offer',
      no: () => setDeal(null),
      noWord: 'Clear',
    }
  return { ok: null, no: null, okLive: false, okWord: '', noWord: '' }
}

/**
 * An open offer, on the tray: one row for each player it's put to, saying plainly whether they've accepted, declined
 * or are still deciding. The one who offered trades with a click on an accepted row; the ones it's put to answer on
 * their own row. Everyone involved sees everyone else's answers as they come in.
 */
function OfferPanel({ view, layout, acts }: { view: View; layout: ReturnType<typeof layoutFor>; acts: TrayActs }) {
  const project = useProjector()
  const o = view.offer
  if (!o) return null
  const me = view.you
  const mineOffer = o.from === me
  const asked = view.players.map((_, i) => i).filter((i) => i !== o.from && (o.to === undefined || i === o.to))
  const state = (p: number) => (o.accepted.includes(p) ? 'yes' : o.declined.includes(p) ? 'no' : 'wait')
  const nobody = asked.every((p) => state(p) === 'no')
  // just above the tray, as wide as it (at least wide enough for a name and two buttons), kept on the screen
  const [x0, top] = project(layout.tray[0] - TRAY.w / 2, 0, layout.tray[1] - TRAY.d / 2)
  const [x1] = project(layout.tray[0] + TRAY.w / 2, 0, layout.tray[1] - TRAY.d / 2)
  const width = Math.min(window.innerWidth - 16, Math.max(x1 - x0 + 24, 280))
  const left = Math.max(8, Math.min(window.innerWidth - 8 - width, (x0 + x1) / 2 - width / 2))
  const from = view.players[o.from]
  // (your own answer, while you haven't given it, is the two buttons along the bottom)
  const rows = asked.filter((p) => p !== me || state(p) !== 'wait')
  return (
    <div className="offer-panel" style={{ left, top, width, ['--n' as string]: Math.max(1, rows.length) }}>
      <div className="op-head">
        {mineOffer ? (
          o.to === undefined ? (
            'Your offer to everyone'
          ) : (
            <>
              Your offer to <Who view={view} p={o.to} you={false} />
            </>
          )
        ) : (
          <>
            <Who view={view} p={o.from} you={false} /> offers {o.to === undefined ? 'everyone' : 'you'}
          </>
        )}
      </div>
      {rows.map((p) => {
        const st = state(p)
        const pl = view.players[p]
        return (
          <div key={p} className={`op-row ${st}`} style={{ ['--pc' as string]: PLAYER[pl.color].ui }}>
            <span className="op-name">{p === me ? 'You' : pl.name}</span>
            {mineOffer && st === 'yes' ? (
              <button className="op-btn trade" onClick={() => act({ type: 'confirmTrade', with: p })}>
                Trade
              </button>
            ) : (
              <span className={`op-state ${st}`}>{st === 'yes' ? '✓ Accepted' : st === 'no' ? '✕ Declined' : <>Deciding<i className="dots" /></>}</span>
            )}
          </div>
        )
      })}
      {asked.includes(me) && state(me) === 'wait' && (
        <div className="op-ans">
          <button className="op-btn no" onClick={acts.no ?? undefined}>
            Decline
          </button>
          <button className="op-btn ok" disabled={!acts.okLive} onClick={acts.ok ?? undefined}>
            {acts.okLive ? 'Accept' : "You don't have it"}
          </button>
        </div>
      )}
      {!mineOffer && o.accepted.includes(me) && <div className="op-foot">Waiting for {from.name} to pick</div>}
      {mineOffer && (
        <button className={`op-btn back ${nobody ? 'loud' : ''}`} onClick={acts.no ?? undefined}>
          {nobody ? 'Nobody wants it: take it back' : 'Take back'}
        </button>
      )}
    </div>
  )
}

/** the tray's two marks: a green check and a red cross, beside it */
function TrayMarks({ layout, acts }: { layout: ReturnType<typeof layoutFor>; acts: TrayActs }) {
  const project = useProjector()
  const side = layout.marks === 'left' ? -1 : 1
  const [x, y] = project(layout.tray[0] + side * (TRAY.w / 2 + 10), 0, layout.tray[1])
  const { ok, no, okLive } = acts
  return (
    <div className={`marks ${side < 0 ? 'left' : ''}`} style={{ left: x, top: y }}>
      {ok && (
        <button className="mark-btn ok" disabled={!okLive} onClick={ok} aria-label={acts.okWord}>
          ✓
        </button>
      )}
      {no && (
        <button className="mark-btn no" onClick={no} aria-label={acts.noWord}>
          ✕
        </button>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- the roll, big, for a moment

const PIP_AT: Record<number, [number, number][]> = {
  1: [[1, 1]],
  2: [[0, 0], [2, 2]],
  3: [[0, 0], [1, 1], [2, 2]],
  4: [[0, 0], [2, 0], [0, 2], [2, 2]],
  5: [[0, 0], [2, 0], [1, 1], [0, 2], [2, 2]],
  6: [[0, 0], [2, 0], [0, 1], [2, 1], [0, 2], [2, 2]],
}
function DieFace({ v, kind }: { v: number; kind: 'plain' | 'red' | 'yellow' }) {
  return (
    <span className={`die ${kind}`}>
      {PIP_AT[v].map(([c, r], i) => (
        <i key={i} style={{ gridColumn: c + 1, gridRow: r + 1 }} />
      ))}
    </span>
  )
}
const FACE_WORD: Record<string, string> = { ship: 'The barbarians sail on', trade: 'Trade cards', politics: 'Politics cards', science: 'Science cards' }

/** once the dice have landed: what was rolled, big in the middle, for a moment (the dice in their tray are small) */
function RollFlash({ view, layout }: { view: View; layout: ReturnType<typeof layoutFor> }) {
  const project = useProjector()
  const last = [...view.events].reverse().find((e) => e.k === 'roll')
  const seen = useRef(last?.n ?? -1)
  const [shown, setShown] = useState<Extract<View['events'][number], { k: 'roll' }> | null>(null)
  useEffect(() => {
    if (!last || last.k !== 'roll' || last.n <= seen.current) return
    seen.current = last.n
    const a = window.setTimeout(() => setShown(last), GLOW_AT * 1000 - 80)
    const b = window.setTimeout(() => setShown((s) => (s?.n === last.n ? null : s)), GLOW_AT * 1000 + 1500)
    return () => {
      clearTimeout(a)
      clearTimeout(b)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [last?.n])
  if (!shown) return null
  const [a, b] = shown.dice
  const total = a + b
  const x = !!view.x
  const face = shown.event
  const note =
    total === 7
      ? 'Robber!'
      : face && face !== 'ship'
        ? `${FACE_WORD[face]} for level ${Math.max(1, a - 1)} and up`
        : face === 'ship'
          ? view.x?.barbarian
            ? `${FACE_WORD.ship}: ${Math.min(view.x.barbarian, BARBARIAN_STEPS)} of ${BARBARIAN_STEPS}`
            : 'The barbarians land!'
          : null
  const [fx, fy] = project(layout.flash[0], 10, layout.flash[1])
  return (
    <div className="roll-flash" key={shown.n} aria-live="polite" style={{ left: fx, top: fy }}>
      <div className="rf-who">
        <Who view={view} p={shown.p} />
      </div>
      <div className="rf-row">
        <DieFace v={a} kind={x ? 'red' : 'plain'} />
        <DieFace v={b} kind={x ? 'yellow' : 'plain'} />
        <b className={`rf-total ${total === 7 ? 'seven' : ''}`}>{total}</b>
      </div>
      {note && (
        <div className="rf-note" style={face && face !== 'ship' && total !== 7 ? { background: TRACK_COLOR[face] } : undefined}>
          {note}
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
