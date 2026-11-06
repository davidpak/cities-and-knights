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
import { BARBARIAN_STEPS, CARD_TEXT, GOODS, KNIGHT_COST, PROGRESS, RESOURCES, TRACKS, TRACK_NAME, emptyHand, handSize, hasAll, type Card, type Good, type Hand, type Progress, type Resource, type Track } from '../../../shared/rules.ts'
import { PLAYER, TRACK_COLOR } from '../lib/palette.ts'
import { act, room, useStore } from '../net.ts'
import { GLOW_AT, type PickKind, type Picking } from '../three/Board.tsx'
import { useProjector } from '../three/labels.ts'
import { TableView, packHand, type TrayContents } from '../three/table/Table.tsx'
import { CARD, TRAY, layoutFor, seatParts, type Spot } from '../three/table/layout.ts'
import { paintFace } from '../three/table/faces.ts'
import { publishState } from '../three/TestHook.tsx'
import { Bundle } from './Cards.tsx'
import { Chronicle, describe, Who } from './Chronicle.tsx'

type Build = 'road' | 'settlement' | 'city' | 'knight' | 'wall'
type Deal = { give: Hand; get: Hand; to: 'bank' | number | null }

const add = (h: Hand, r: Good, d = 1): Hand => ({ ...h, [r]: Math.max(0, h[r] + d) })
const minus = (a: Hand, b: Partial<Hand>): Hand => Object.fromEntries(GOODS.map((r) => [r, Math.max(0, a[r] - (b[r] ?? 0))])) as Hand

/** what each kind of pick asks for, in a few words */
const PICK_WORDS: Record<PickNeed, string> = {
  hex: 'Pick tile',
  road: 'Pick open road',
  enemyKnight: 'Pick enemy knight',
  knightSpot: 'Pick spot',
  player: 'Pick player',
  resource: 'Pick resource',
  commodity: 'Pick commodity',
  good: 'Pick card type',
  number: 'Pick number',
  myCity: 'Pick city',
  mySettlement: 'Pick settlement',
  token: 'Pick token',
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
  // a card of yours, held up close (tap one in your hand)
  const [zoom, setZoom] = useState<{ kind: 'dev'; card: Card } | { kind: 'prog'; card: Progress } | null>(null)
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
        if (!hand || !hasAll(hand, KNIGHT_COST.activate)) return
        await act({ type: 'activateKnight', vertex: id })
      } else if (canAct(view, id)) setSelected(id)
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
      if (!g) return
      if (await act({ type: 'bankTrade', give: g, get: r })) {
        const left = add(give, g, -ratios[g])
        setDeal(handSize(left) || handSize(deal?.get ?? emptyHand()) ? { ...(deal as Deal), give: left } : null)
      }
    },
    deck: () => {
      if (!main) return
      if (!affordable(view, me, 'card')) return
      act({ type: 'buyCard' })
    },
    dev: (c: Card) => setZoom({ kind: 'dev', card: c }),
    progress: (c: Progress) => setZoom({ kind: 'prog', card: c }),
    playDev: (c: Card) => {
      if (c === 'knight') act({ type: 'playKnight' })
      else if (c === 'roadBuilding') act({ type: 'playRoadBuilding' })
      else if (c === 'yearOfPlenty') (setPlenty([]), setDeal(null))
      else if (c === 'monopoly') (setMonopoly(true), setDeal(null))
    },
    playProgress: (c: Progress) => {
      if (progressOwed) return act({ type: 'discardProgress', card: c })
      setBuilding(null)
      setSelected(null)
      act({ type: 'playProgress', card: c })
    },
    knight: () => {
      setSelected(null)
      if (building === 'knight') return setBuilding(null)
      if (!can.knight) return
      setBuilding('knight')
    },
    wall: () => {
      if (building === 'wall') return setBuilding(null)
      if (!can.wall) return
      setBuilding('wall')
    },
    improve: (t: Track) => {
      if (!main) return
      if (!canImprove[t]) return
      act({ type: 'improve', track: t })
    },
    supply: (w: Build) => {
      if (building === w) return setBuilding(null)
      if (w === 'knight' || w === 'wall') return
      if (!can[w]) return
      setBuilding(w)
    },
    opponent: (p: number) => {
      if (pickPhase && targets.includes(p)) return act({ type: 'pick', target: p })
      if (victims.includes(p)) return act({ type: 'steal', victim: p })
      if (myOffer && myOffer.to === undefined && myOffer.accepted.includes(p)) return act({ type: 'confirmTrade', with: p })
      if (!trading || !deal) return
      if (!handSize(deal.give) || !handSize(deal.get)) return
      act({ type: 'offerTrade', give: deal.give, get: deal.get, to: p })
    },
  }

  const acts = trayActs({ view, deal, setDeal, toMe, myOffer, owe, drop })
  // while an offer is up, its panel on the tray holds every button for it
  const offerUp = !!(myOffer || inOffer)

  // your turn, while you're in another tab: the tab says so
  useEffect(() => {
    const base = 'Towns and Peasants'
    const f = () => (document.title = mine && document.hidden ? `● Your turn · ${base}` : base)
    f()
    document.addEventListener('visibilitychange', f)
    return () => document.removeEventListener('visibilitychange', f)
  }, [mine])

  // keys: R roll, E end turn, Esc put everything back
  useEffect(() => {
    const f = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setZoom(null)
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

      {tray && layout.marks !== 'corner' && <TrayMarks layout={layout} acts={acts} />}
      {offerUp && <OfferStrip view={view} layout={layout} />}

      <RollFlash view={view} layout={layout} />

      {zoom && (() => {
        const held = zoom.kind === 'dev' ? devs.some((c) => c.card === zoom.card) : myProgress.some((c) => c.card === zoom.card)
        if (!held) return null
        const close = () => setZoom(null)
        const live = zoom.kind === 'prog' ? progressPlayable(zoom.card) : playable(zoom.card)
        const word = zoom.kind === 'prog' && progressOwed ? 'Discard' : 'Play'
        return (
          <CardZoom
            look={`${zoom.kind}:${zoom.card}`}
            caption={zoom.kind === 'dev' ? CARD_TEXT[zoom.card] : null}
            onClose={close}
            action={live ? { word, go: () => (close(), zoom.kind === 'dev' ? on.playDev(zoom.card) : on.playProgress(zoom.card)) } : null}
          />
        )
      })()}

      <div className="corner">
        {/* on a phone the tray's buttons are here, big, with words */}
        {tray && layout.marks === 'corner' && acts.no && (
          <button className="stamp-btn big no" onClick={acts.no}>
            {acts.noWord}
          </button>
        )}
        {tray && layout.marks === 'corner' && acts.ok && (
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
        {main && !(tray && layout.marks === 'corner' && (acts.ok || acts.no)) && (
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
  if (mine && ph.kind === 'setup') todo = ph.step === 'settlement' ? 'Place settlement' : 'Place road'
  if (ph.kind === 'discard') todo = owe ? `Discard ${owe}` : 'Discarding…'
  if (mine && ph.kind === 'robber') todo = 'Move robber'
  if (mine && ph.kind === 'steal') todo = 'Pick player to rob'
  if (mine && ph.kind === 'roadBuilding') todo = `Place ${ph.left} road${ph.left > 1 ? 's' : ''}`
  if (mine && plenty) todo = `Pick ${2 - plenty.length} from bank`
  if (mine && monopoly) todo = 'Pick resource'
  // the expansion
  if (mine && building === 'knight') todo = 'Place or upgrade knight'
  if (mine && building === 'wall') todo = 'Pick city'
  if (mine && selected !== null) todo = 'Move knight'
  if (view.offer && ph.kind === 'main' && (mine || view.offer.to === undefined || view.offer.to === view.you)) todo = 'Trade pending'
  let cancel = false
  if (mine && ph.kind === 'pick') {
    todo = (
      <>
        <b>{PROGRESS[ph.card].name}</b> · {PICK_WORDS[ph.need]}
      </>
    )
    cancel = ph.step === 0
  }
  if (ph.kind === 'progressDiscard') todo = progressOwed ? `Discard ${progressOwed} progress` : 'Discarding…'
  if (ph.kind === 'over') todo = <>{<Who view={view} p={ph.winner} />} wins</>
  if (armed) todo = 'Tap again'
  // an offer to you: what you'd get, for what
  if (toMe)
    todo = (
      <>
        <Who view={view} p={toMe.from} you={false} /> <Bundle of={toMe.give} /> <span className="for">for</span> <Bundle of={toMe.get} />
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
  if (myOffer) return { ok: null, okLive: false, okWord: '', no: () => act({ type: 'cancelOffer' }), noWord: 'Cancel' }
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
 * An open offer: a row of chips over the tray, one per player it's put to, each with ✓, ✕ or … . The one who
 * offered taps a ✓ chip to trade.
 */
function OfferStrip({ view, layout }: { view: View; layout: ReturnType<typeof layoutFor> }) {
  const project = useProjector()
  const o = view.offer
  if (!o) return null
  const me = view.you
  const mineOffer = o.from === me
  const asked = view.players.map((_, i) => i).filter((i) => i !== o.from && i !== me && (o.to === undefined || i === o.to))
  if (!asked.length) return null
  const [x, top] = project(layout.tray[0], 0, layout.tray[1] - TRAY.d / 2)
  return (
    <div className="offer-strip" style={{ left: x, top }}>
      {asked.map((p) => {
        const st = o.accepted.includes(p) ? 'yes' : o.declined.includes(p) ? 'no' : 'wait'
        const pl = view.players[p]
        const style = { ['--pc' as string]: PLAYER[pl.color].ui }
        const mark = st === 'yes' ? '✓' : st === 'no' ? '✕' : <i className="dots" />
        return mineOffer && st === 'yes' ? (
          <button key={p} className="pchip yes go" style={style} onClick={() => act({ type: 'confirmTrade', with: p })} title={`Trade with ${pl.name}`}>
            {pl.name} <b>⇄</b>
          </button>
        ) : (
          <span key={p} className={`pchip ${st}`} style={style}>
            {pl.name} <b>{mark}</b>
          </span>
        )
      })}
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

// ---------------------------------------------------------------- a card held up close

function CardZoom({ look, caption, action, onClose }: { look: string; caption: string | null; action: { word: string; go: () => void } | null; onClose: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    if (ref.current) paintFace(look, ref.current, 2 * Math.min(2, window.devicePixelRatio || 1))
  }, [look])
  // (only a press that starts on the backdrop closes it: the tap that opened it ends here too, on a phone)
  const pressed = useRef(false)
  return (
    <div className="zoom-back" onPointerDown={(e) => (pressed.current = e.target === e.currentTarget)} onClick={(e) => pressed.current && e.target === e.currentTarget && onClose()}>
      <div className="zoom">
        <canvas ref={ref} className="zoom-card" />
        {caption && <div className="zoom-cap">{caption}</div>}
        <div className="zoom-row">
          {action && (
            <button className="zoom-btn go" onClick={action.go}>
              {action.word}
            </button>
          )}
          <button className="zoom-btn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
      </div>
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
        ? `${TRACK_NAME[face]} ${Math.max(1, a - 1)}+`
        : face === 'ship'
          ? view.x?.barbarian
            ? `Ship ${Math.min(view.x.barbarian, BARBARIAN_STEPS)}/${BARBARIAN_STEPS}`
            : 'Barbarians attack!'
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
        <div className="dialog-head">{ph.winner === view.you ? 'You win' : `${view.players[ph.winner].name} wins`}</div>
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
            Menu
          </button>
        </div>
      </div>
    </div>
  )
}
