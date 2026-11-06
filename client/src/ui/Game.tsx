/**
 * The game: the whole screen is the table. Everything you do, you do to things on it (see three/table/Table.tsx).
 * On top there's only: what to do now, what just happened, one button for the turn, the tray's few buttons,
 * small counts on the stacks, everyone's name and points, and a History panel that stays shut until you open it.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  OFFER_MS, affordable, canAct, longestRun, canPlay, chaseSpots, citySpots, improveCost, knightMoves, knightSpots, pickTargets, promoteSpots,
  roadSpots, robberSpots, settlementSpots, tradeRatios, wallSpots, type PickNeed, type View,
} from '../../../shared/engine.ts'
import { BARBARIAN_STEPS, CARD_TEXT, TRACK_GOOD, TRACK_LEVELS, TRACK_PERK, GOODS, KNIGHT_COST, PROGRESS, RESOURCES, TRACKS, TRACK_NAME, emptyHand, handSize, hasAll, type Card, type Good, type Hand, type Progress, type Resource, type Track } from '../../../shared/rules.ts'
import { PLAYER, TRACK_COLOR } from '../lib/palette.ts'
import { act, playerId, room, tryAct, useStore } from '../net.ts'
import { GLOW_AT, type PickKind, type Picking } from '../three/Board.tsx'
import { useProjector } from '../three/labels.ts'
import { TRAY_FLOOR, TableView, packHand, trayStacks, type TrayContents } from '../three/table/Table.tsx'
import { CARD, TRAY, layoutFor, raidToTable, seatParts, type Spot } from '../three/table/layout.ts'
import { edgeAt, vertexAt } from '../three/spec.ts'
import { SHIELD } from '../lib/icons.ts'
import { faceURL, paintFace } from '../three/table/faces.ts'
import { publishState } from '../three/TestHook.tsx'
import { Bundle, Icon, PieceIcon } from './Cards.tsx'
import { Announcer, Chronicle, describe, Who } from './Chronicle.tsx'
import { Costs, Rules } from './Reference.tsx'
import { GameStats } from './Stats.tsx'

type Build = 'road' | 'settlement' | 'city' | 'knight' | 'wall'
type Deal = { give: Hand; get: Hand; to: 'bank' | number | null; any?: number }

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
  theirCard: 'Pick a card',
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
  const { toast, room: info, solo } = useStore()
  const host = !!info && info.host === (solo ? 'you' : playerId)
  const me = view.you
  const ph = view.phase
  const mine = me >= 0 && view.current === me
  const main = mine && ph.kind === 'main'
  const hand = me >= 0 ? view.players[me].hand : null
  // open offers: yours, and those put to you that you haven't turned down
  const myOffers = view.offers.filter((o) => o.from === me)
  const incoming = me >= 0 ? view.offers.filter((o) => o.from !== me && (o.to === undefined || o.to === me) && !o.declined.includes(me)) : []
  const toMe = incoming.filter((o) => !o.accepted.includes(me))
  const owe = ph.kind === 'discard' ? ph.owed[me] ?? 0 : 0
  // someone is sneaking a card of yours right now
  const beingRobbed = !!view.snatch && view.snatch.victim === me

  const aspect = useAspect()
  const knightsMode = !!view.x
  const layout = useMemo(() => layoutFor(view.players.length, me < 0 ? 0 : me, aspect, knightsMode), [view.players.length, me, aspect, knightsMode])

  const [building, setBuilding] = useState<Build | null>(null)
  const [deal, setDeal] = useState<Deal | null>(null)
  const [drop, setDrop] = useState<Hand>(emptyHand()) // cards picked to discard
  const [plenty, setPlenty] = useState<Resource[] | null>(null)
  const [monopoly, setMonopoly] = useState(false)
  const [history, setHistory] = useState(false)
  // a player's tag tapped: everything about them, in a small card
  const [playerCard, setPlayerCard] = useState<number | null>(null)
  // (a phone: the bank, open in the middle; what's picked to give and to get)
  const [bankOpen, setBankOpen] = useState<{ give: Good | null; get: Good | null } | null>(null)
  const [tab, setTab] = useState<'History' | 'Costs' | 'Rules'>('History')
  // a card played, tapped in the history: the card, and what it did
  const [played, setPlayed] = useState<View['events'][number] | null>(null)
  // a card of yours, held up close (tap one in your hand)
  const [zoom, setZoom] = useState<{ kind: 'dev'; card: Card } | { kind: 'prog'; card: Progress } | null>(null)
  // why the card up close couldn't be played (when Play was tried)
  const [zoomWhy, setZoomWhy] = useState<string | null>(null)
  useEffect(() => setZoomWhy(null), [zoom])
  // one of your city tracks, up close: what each level gives, and Improve
  const [trackZoom, setTrackZoom] = useState<Track | null>(null)
  /** a finger has shown a piece on the board: tap it again to place it */
  const [armed, setArmed] = useState(false)
  /** the expansion: one of your ready knights, picked up to move (or to chase the robber) */
  const [selected, setSelected] = useState<number | null>(null)

  // a choice lasts only while it still makes sense
  useEffect(() => {
    if (!main) {
      setBuilding(null)
      setBankOpen(null)
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
  // saying yes to an offer with a wildcard: tap the cards from your hand that you'll give for it
  const [pickFor, setPickFor] = useState<{ id: number; need: number; picked: Hand } | null>(null)
  useEffect(() => {
    if (pickFor && !toMe.some((o) => o.id === pickFor.id)) setPickFor(null)
  }, [pickFor, toMe])

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
    // the barbarians won: pick which of your cities they take (on anyone's turn)
    if (ph.kind === 'pillage' && ph.owed[me]) return { kind: 'vertex', spots: ph.owed[me] }
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
    // otherwise every road, settlement and city you can build is marked, tap twice to build (and your knights on the
    // board can be clicked, to ready one or to pick up a ready one)
    if (main && !deal) {
      const layers = [
        can.road ? { kind: 'road' as const, spots: roadSpots(view, me) } : null,
        can.settlement ? { kind: 'settlement' as const, spots: settlementSpots(view, me) } : null,
        can.city ? { kind: 'city' as const, spots: citySpots(view, me) } : null,
        myKnights.length ? { kind: 'quiet' as const, spots: myKnights } : null,
      ].filter((l): l is NonNullable<typeof l> => !!l && l.spots.length > 0)
      if (layers.length) return { ...layers[0], more: layers.slice(1), twice: true }
    }
    return null
  }, [mine, main, ph, building, view, me, selected, deal])

  const onPick = async (kind: PickKind, id: number) => {
    if (ph.kind === 'pillage') return void act({ type: 'pillage', vertex: id })
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
  // robbing: whose fan you're picking from (one victim: theirs at once)
  const [robFrom, setRobFrom] = useState<number | null>(null)
  useEffect(() => setRobFrom(null), [ph.kind])
  const robbing = ph.kind === 'steal' && mine ? (ph.victims.length === 1 ? ph.victims[0] : robFrom) : null
  // being robbed: your own fan, to arrange while the robber chooses
  const myFan = ph.kind === 'steal' && !mine && ph.victims.includes(me) ? ph.fans?.[me] ?? null : null
  const progressOwed = ph.kind === 'progressDiscard' ? ph.owed[me] ?? 0 : 0
  const myProgress = view.players[me]?.progress ?? []
  const progressPlayable = (c: Progress) => progressOwed > 0 || (mine && !view.offers.length && (c === 'augury' ? ph.kind === 'roll' : ph.kind === 'main'))
  const trading = main && !plenty && !monopoly
  // while trading: the bank cards that can be had (the bank has one, and some other kind meets its rate)
  const bankKinds: readonly Good[] = view.x ? GOODS : RESOURCES
  const bankGoods: Partial<Record<Good, boolean>> | undefined =
    trading && hand
      ? (() => {
          const ratios = tradeRatios(view, me)
          return Object.fromEntries(bankKinds.map((r) => [r, view.bank[r] > 0 && bankKinds.some((g) => g !== r && hand[g] >= ratios[g])]))
        })()
      : undefined
  const openDeal = (d: Partial<Deal>) => setDeal((cur) => ({ give: cur?.give ?? emptyHand(), get: cur?.get ?? emptyHand(), to: cur?.to ?? null, ...d }))
  const playable = (c: Card) => mine && c !== 'victoryPoint' && canPlay(view, me, c) && (c === 'knight' ? ph.kind === 'roll' || ph.kind === 'main' : ph.kind === 'main')

  // the tray shows: an offer made to you, your own offer waiting, your discard, or the trade you're putting together
  let tray: TrayContents | null = null
  if (owe) tray = { mode: 'discard', give: drop, get: {} }
  else if (deal) tray = { mode: 'trade', give: deal.give, get: deal.get, any: deal.any }
  // what's on the tray came out of your hand (an offer to you shows what you'd hand over)
  // (an offer to you takes nothing from your hand until you accept it)
  const onTray = owe ? drop : deal ? deal.give : pickFor ? pickFor.picked : {}
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
      // someone is sneaking a card of yours: a tap on your cards catches them
      if (beingRobbed) return void act({ type: 'catch' })
      if (owe) return handSize(drop) < owe && setDrop(add(drop, r))
      if (pickFor && hand) {
        const o = view.offers.find((x) => x.id === pickFor.id)
        if (!o || (o.give[r] ?? 0) > 0 || hand[r] - (o.get[r] ?? 0) - pickFor.picked[r] <= 0) return
        const picked = add(pickFor.picked, r)
        if (handSize(picked) < pickFor.need) return setPickFor({ ...pickFor, picked })
        setPickFor(null)
        return void act({ type: 'acceptOffer', id: o.id, pick: picked })
      }
      if (!trading) return
      openDeal({ give: add(deal?.give ?? emptyHand(), r) })
    },
    trayGive: (r: Good) => (owe ? setDrop(add(drop, r, -1)) : deal && setDeal({ ...deal, give: add(deal.give, r, -1) })),
    trayGet: (r: Good) => deal && setDeal({ ...deal, get: add(deal.get, r, -1) }),
    trayAny: () => deal && setDeal({ ...deal, any: Math.max(0, (deal.any ?? 0) - 1) }),
    snatch: (p: number) => void act({ type: 'snatch', victim: p }),
    // a piece dropped on the board: built at the nearest spot it can go, if one is close
    // a piece of your supply picked up: its spots light up (let go on one to build it there)
    holdPiece: (w: Build | null) => {
      if (w && main && (w === 'road' || w === 'settlement' || w === 'city') && can[w]) setBuilding(w)
    },
    dropPiece: (w: Build, x: number, z: number) => {
      setBuilding(null)
      if (!main || (w !== 'road' && w !== 'settlement' && w !== 'city') || !can[w]) return
      const spots = w === 'road' ? roadSpots(view, me) : w === 'settlement' ? settlementSpots(view, me) : citySpots(view, me)
      const at = (id: number) => (w === 'road' ? edgeAt(id) : vertexAt(id))
      const near = spots.map((id) => ({ id, d: Math.hypot(at(id)[0] - x, at(id)[1] - z) })).sort((a, b) => a.d - b.d)[0]
      if (!near || near.d > 40) return
      setBuilding(null)
      void act(w === 'road' ? { type: 'buildRoad', edge: near.id } : w === 'settlement' ? { type: 'buildSettlement', vertex: near.id } : { type: 'buildCity', vertex: near.id })
    },
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
      if (!trading || !hand) return
      const ratios = tradeRatios(view, me)
      // on a phone: the bank opens big in the middle, what you'd give and what you'd get side by side, the card
      // tapped already picked (and the best card to pay with), so a slip of the finger trades nothing
      if (layout.portrait) {
        const pay = bankKinds.filter((k) => k !== r && hand[k] >= ratios[k]).sort((a, b) => ratios[a] - ratios[b] || hand[b] - hand[a])[0] ?? null
        return setBankOpen({ give: pay, get: r })
      }
      const give = deal?.give ?? emptyHand()
      // what pays for it: what's on the tray (exactly the bank's rate of one kind, or else enough of one kind), or
      // with nothing fit on the tray, straight from the hand (the best rate; of those, the kind held most)
      const kinds = bankKinds.filter((g) => g !== r && give[g] >= ratios[g])
      const fromTray = kinds.find((k) => give[k] === ratios[k]) ?? kinds[0]
      const g = fromTray ?? bankKinds.filter((k) => k !== r && hand[k] >= ratios[k]).sort((a, b) => ratios[a] - ratios[b] || hand[b] - hand[a])[0]
      if (!g) return
      if ((await act({ type: 'bankTrade', give: g, get: r })) && fromTray) {
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
    improve: (t: Track) => setTrackZoom(t),
    supply: (w: Build) => {
      if (building === w) return setBuilding(null)
      if (w === 'knight' || w === 'wall') return
      if (!can[w]) return
      setBuilding(w)
    },
    opponent: (p: number) => {
      if (pickPhase && targets.includes(p)) return act({ type: 'pick', target: p })
      if (victims.includes(p)) return setRobFrom(p)
      const ready = myOffers.find((o) => o.to === undefined && o.accepted.includes(p))
      if (ready) return act({ type: 'confirmTrade', id: ready.id, with: p })
      if (!trading) return
      // a full deal goes to them at once; otherwise they become who it's for (a second tap: everyone again)
      if (deal && handSize(deal.give) && handSize(deal.get) + (deal.any ?? 0) && !GOODS.some((r) => deal.give[r] && deal.get[r]))
        return void act({ type: 'offerTrade', give: deal.give, get: deal.get, any: deal.any ?? 0, to: p }).then((ok) => ok && setDeal(null))
      openDeal({ to: deal?.to === p ? null : p })
    },
  }

  const acts = trayActs({ view, deal, setDeal, owe, drop })
  // the wildcard: ask for one more card of their choosing
  const addAny = () => deal && setDeal({ ...deal, any: (deal.any ?? 0) + 1 })

  // your turn, while you're in another tab: the tab says so
  useEffect(() => {
    const base = 'Towns and Peasants'
    const f = () => (document.title = mine && document.hidden ? `● Your turn · ${base}` : base)
    f()
    document.addEventListener('visibilitychange', f)
    return () => document.removeEventListener('visibilitychange', f)
  }, [mine])

  const zoomRef = useRef(zoom)
  const buildingRef = useRef(building)
  const dealRef = useRef(deal)
  const plentyRef = useRef(plenty)
  const monopolyRef = useRef(monopoly)
  const selectedRef = useRef(selected)
  zoomRef.current = zoom
  buildingRef.current = building
  dealRef.current = deal
  plentyRef.current = plenty
  monopolyRef.current = monopoly
  selectedRef.current = selected

  // keys: R roll, E end turn, Esc put everything back (or open the menu)
  useEffect(() => {
    const f = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // put back whatever is in hand; with nothing in hand, the menu
        const busy = zoomRef.current || buildingRef.current || dealRef.current || plentyRef.current || monopolyRef.current || selectedRef.current !== null || (ph.kind === 'pick' && ph.step === 0 && mine)
        setZoom(null)
        setTrackZoom(null)
        setBuilding(null)
        setDeal(null)
        setPlenty(null)
        setMonopoly(false)
        setSelected(null)
        if (ph.kind === 'pick' && ph.step === 0 && mine) act({ type: 'cancelPick' })
        if (!busy) setHistory((h) => !h)
      }
      if (!mine) return
      if (e.key.toLowerCase() === 'r' && ph.kind === 'roll') act({ type: 'roll' })
      if (e.key.toLowerCase() === 'e' && ph.kind === 'main') act({ type: 'endTurn' })
    }
    window.addEventListener('keydown', f)
    return () => window.removeEventListener('keydown', f)
  }, [mine, ph.kind])

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
          hand: !!hand && (trading || owe > 0 || !!pickFor || beingRobbed),
          snatched: beingRobbed && hand ? GOODS.filter((r) => hand[r] > 0)[view.snatch!.id % Math.max(1, GOODS.filter((r) => hand[r] > 0).length)] ?? null : null,
          tray: (trading && !!deal) || owe > 0,
          wants: trading,
          bank: trading || !!plenty || monopoly || (!!pickPhase && ['resource', 'commodity', 'good'].includes(pickPhase.need)),
          bankGoods,
          deck: main && !view.x,
          supply: { road: can.road, settlement: can.settlement, city: can.city },
          supplyTap: main,
          dev: Object.fromEntries(devs.map((c) => [c.card, playable(c.card)])),
          opponents: pickPhase?.need === 'player' ? (targets as number[]) : victims.length ? victims : trading ? layout.seats.map((s) => s.p).filter((p) => view.players[p].handCount > 0) : [],
          progress: Object.fromEntries(myProgress.map((c) => [c.card, progressPlayable(c.card)])),
          knight: can.knight,
          wall: can.wall,
          improve: canImprove,
        }}
        on={on}
      />

      <Lines view={view} plenty={plenty} monopoly={monopoly} owe={owe} building={building} selected={selected} progressOwed={progressOwed} toMe={toMe[toMe.length - 1] ?? null} armed={armed && !!picking} />

      <Labels view={view} layout={layout} hand={shownHand} tray={tray} onPlayer={setPlayerCard} />
      {playerCard !== null && view.players[playerCard] && <PlayerCard view={view} p={playerCard} onClose={() => setPlayerCard(null)} />}
      {view.x && <BarbarianOdds view={view} layout={layout} />}
      {beingRobbed && hand && <SnatchCue layout={layout} hand={shownHand ?? hand} r={GOODS.filter((g) => hand[g] > 0)[view.snatch!.id % Math.max(1, GOODS.filter((g) => hand[g] > 0).length)]} />}

      {tray && !owe && layout.marks !== 'corner' && <TrayMarks layout={layout} acts={acts} onAny={trading && deal ? addAny : undefined} />}
      <Offers view={view} layout={layout} target={typeof deal?.to === 'number' ? deal.to : null} pickFor={pickFor} onPick={setPickFor} />

      <RollFlash view={view} layout={layout} />
      <Announcer view={view} />
      {played && (played.k === 'play' || played.k === 'progress') && (
        <CardZoom
          look={played.k === 'play' ? `dev:${played.card}` : `prog:${played.card}`}
          caption={played.k === 'play' ? CARD_TEXT[played.card] : null}
          after={whatFollowed(view, played)}
          action={null}
          onClose={() => setPlayed(null)}
        />
      )}
      {/* a choice that isn't a place on the board: in the middle of the screen */}
      {pickPhase && ['resource', 'commodity', 'good'].includes(pickPhase.need) && (
        <Chooser
          title={PROGRESS[pickPhase.card].name}
          cards={(targets as Good[]).map((r) => ({ key: r, look: `res:${r}`, go: () => act({ type: 'pick', target: r }) }))}
          onCancel={pickPhase.step === 0 ? () => act({ type: 'cancelPick' }) : undefined}
        />
      )}
      {pickPhase && pickPhase.need === 'player' && (
        <Chooser
          title={PROGRESS[pickPhase.card].name}
          players={(targets as number[]).map((p) => ({ p, go: () => act({ type: 'pick', target: p }) }))}
          view={view}
          onCancel={pickPhase.step === 0 ? () => act({ type: 'cancelPick' }) : undefined}
        />
      )}
      {pickPhase && pickPhase.need === 'number' && (
        <Chooser
          title={PROGRESS[pickPhase.card].name}
          numbers={(targets as number[]).map((n) => ({ n, go: () => act({ type: 'pick', target: n }) }))}
          onCancel={pickPhase.step === 0 ? () => act({ type: 'cancelPick' }) : undefined}
        />
      )}
      {mine && ph.kind === 'steal' && ph.victims.length > 1 && robFrom === null && (
        <Chooser title="Rob" players={ph.victims.map((p) => ({ p, go: () => setRobFrom(p) }))} view={view} />
      )}
      {ph.kind === 'aqueduct' && ph.owed[me] && (
        <Chooser title="Waterworks" cards={RESOURCES.filter((r) => view.bank[r] > 0).map((r) => ({ key: r, look: `res:${r}`, go: () => act({ type: 'aqueduct', r }) }))} />
      )}
      {bankOpen && trading && hand && (
        <BankPanel
          view={view}
          hand={hand}
          kinds={bankKinds}
          pick={bankOpen}
          onPick={setBankOpen}
          onTrade={async () => {
            if (!bankOpen.give || !bankOpen.get) return
            if (await act({ type: 'bankTrade', give: bankOpen.give, get: bankOpen.get })) setBankOpen({ give: null, get: null })
          }}
          onClose={() => setBankOpen(null)}
        />
      )}
      {mine && plenty && (
        <Chooser
          title={`Take ${2 - plenty.length}`}
          cards={RESOURCES.filter((r) => view.bank[r] > 0).map((r) => ({ key: r, look: `res:${r}`, go: () => on.bank(r) }))}
          onCancel={() => setPlenty(null)}
        />
      )}
      {mine && monopoly && (
        <Chooser
          title="Monopoly"
          cards={RESOURCES.map((r) => ({ key: r, look: `res:${r}`, go: () => on.bank(r) }))}
          onCancel={() => setMonopoly(false)}
        />
      )}
      {mine && ph.kind === 'pick' && ph.card === 'spy' && ph.need === 'theirCard' && (
        <StealFan
          n={view.players[ph.data[0]].progressCount}
          faces={view.players[ph.data[0]].progress?.map((c) => `prog:${c.card}`)}
          onPick={(i) => act({ type: 'pick', target: i })}
        />
      )}
      {trackZoom && view.x && (
        <TrackZoom
          track={trackZoom}
          level={view.x.levels[me][trackZoom]}
          onClose={() => setTrackZoom(null)}
          onImprove={canImprove[trackZoom] ? () => (act({ type: 'improve', track: trackZoom }), setTrackZoom(null)) : null}
        />
      )}
      {robbing !== null && ph.kind === 'steal' && (
        <StealFan n={ph.fans?.[robbing]?.length ?? view.players[robbing].handCount} onPick={(i) => act({ type: 'steal', victim: robbing, index: i })} onClose={ph.victims.length > 1 ? () => setRobFrom(null) : undefined} />
      )}
      {myFan && myFan.length > 0 && <MyFan order={myFan} />}
      <TurnBanner view={view} />
      <Flash text={ph.kind === 'pillage' && ph.owed[me] ? 'Pick city to lose' : mine && ph.kind === 'robber' ? 'Move robber' : null} />
      {owe > 0 && hand && <DiscardFan hand={hand} drop={drop} owe={owe} setDrop={setDrop} onDone={() => act({ type: 'discard', cards: drop })} />}
      {ph.kind === 'payback' && ph.thief === me && hand && (
        <DiscardFan title="Caught! Give 1" hand={hand} drop={drop} owe={1} setDrop={setDrop} onDone={() => act({ type: 'payback', card: GOODS.find((r) => drop[r] > 0)! }).then(() => setDrop(emptyHand()))} word="Give" />
      )}
      {progressOwed > 0 && myProgress.length > 0 && (
        <div className="fan-back must">
          <div className="must-head">Discard {progressOwed} progress</div>
          <div className="fan" style={{ ['--n' as string]: myProgress.length }}>
            {myProgress.map((c, i) => (
              <button
                key={i}
                className="fan-card"
                style={{ ['--i' as string]: i - (myProgress.length - 1) / 2, ['--a' as string]: Math.abs(i - (myProgress.length - 1) / 2), backgroundImage: `url(${faceURL(`prog:${c.card}`)})` }}
                onClick={() => act({ type: 'discardProgress', card: c.card })}
                aria-label={c.card}
              />
            ))}
          </div>
        </div>
      )}

      {zoom && (() => {
        const held = zoom.kind === 'dev' ? devs.some((c) => c.card === zoom.card) : myProgress.some((c) => c.card === zoom.card)
        if (!held) return null
        const close = () => setZoom(null)
        // a progress card always offers Play: if it can't be played now, the reason shows right there
        const live = zoom.kind === 'prog' ? zoom.card !== 'townCharter' && zoom.card !== 'press' : playable(zoom.card)
        const word = zoom.kind === 'prog' && progressOwed ? 'Discard' : 'Play'
        return (
          <CardZoom
            look={`${zoom.kind}:${zoom.card}`}
            caption={zoom.kind === 'dev' ? CARD_TEXT[zoom.card] : null}
            onClose={close}
            action={
              live
                ? {
                    word,
                    go: async () => {
                      if (zoom.kind === 'dev') return close(), on.playDev(zoom.card)
                      setBuilding(null)
                      setSelected(null)
                      const why = await tryAct(progressOwed ? { type: 'discardProgress', card: zoom.card } : { type: 'playProgress', card: zoom.card })
                      if (why) setZoomWhy(why)
                      else close()
                    },
                  }
                : null
            }
            why={zoomWhy}
          />
        )
      })()}

      <div className="corner">
        {/* on a phone the tray's buttons are here, big, with words */}
        {tray && layout.marks === 'corner' && trading && deal && (
          <button className="stamp-btn big any" onClick={addAny} aria-label="Any card">
            ?
          </button>
        )}
        {tray && !owe && layout.marks === 'corner' && acts.no && (
          <button className="stamp-btn big no" onClick={acts.no}>
            {acts.noWord}
          </button>
        )}
        {tray && !owe && layout.marks === 'corner' && acts.ok && (
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
          <button className="stamp-btn go big" onClick={() => act({ type: 'endTurn' })}>
            End turn
          </button>
        )}
      </div>

      <button className="history-btn stamp-btn" onClick={() => setHistory((h) => !h)} aria-label="Menu">
        {history ? '✕' : '☰'}
      </button>
      {history && (
        <aside className="drawer paper">
          <div className="drawer-tabs">
            {(['History', 'Costs', 'Rules'] as const).map((t) => (
              <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
                {t}
              </button>
            ))}
          </div>
          {tab === 'History' ? <Chronicle view={view} onCard={setPlayed} /> : tab === 'Costs' ? <Costs view={view} /> : <Rules view={view} />}
          <div className="drawer-foot">
            {host && (
              <button className="link" onClick={() => confirm('End game?') && room.end()}>
                End game
              </button>
            )}
            <button className="link" onClick={() => confirm('Leave?') && room.leave()}>
              Leave
            </button>
          </div>
        </aside>
      )}

      {ph.kind === 'over' && <GameOver view={view} />}
      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}

// ---------------------------------------------------------------- the two lines at the top

function Lines(props: { view: View; plenty: Resource[] | null; monopoly: boolean; owe: number; building: Build | null; selected: number | null; progressOwed: number; toMe: View['offers'][number] | null; armed: boolean }) {
  const { view, plenty, monopoly, owe, building, selected, progressOwed, toMe, armed } = props
  const ph = view.phase
  const mine = view.current === view.you
  const who = <Who view={view} p={view.current} you={false} />
  let todo: React.ReactNode = mine ? 'Your turn' : <>{who}'s turn</>
  if (mine && ph.kind === 'setup') todo = ph.step === 'settlement' ? 'Place settlement' : 'Place road'
  if (ph.kind === 'discard') todo = owe ? `Discard ${owe}` : 'Discarding…'
  if (mine && ph.kind === 'robber') todo = 'Move robber'
  if (mine && ph.kind === 'steal') todo = ph.victims.length > 1 ? 'Pick player to rob' : 'Pick a card'
  if (mine && ph.kind === 'roadBuilding') todo = `Place ${ph.left} road${ph.left > 1 ? 's' : ''}`
  if (mine && plenty) todo = `Pick ${2 - plenty.length} from bank`
  if (mine && monopoly) todo = 'Pick resource'
  // the expansion
  if (mine && building === 'knight') todo = 'Place or upgrade knight'
  if (mine && building === 'wall') todo = 'Pick city'
  if (mine && selected !== null) todo = 'Move knight'
  if (ph.kind === 'main' && view.offers.some((o) => o.from === view.you || o.to === undefined || o.to === view.you)) todo = 'Trade pending'
  let cancel = false
  if (mine && ph.kind === 'pick') {
    todo = (
      <>
        <b>{PROGRESS[ph.card].name}</b> · {PICK_WORDS[ph.need]}
      </>
    )
    // (a choice shown in the middle has its own ✕)
    cancel = ph.step === 0 && !['resource', 'commodity', 'good', 'player', 'number', 'theirCard'].includes(ph.need)
  }
  if (ph.kind === 'progressDiscard') todo = progressOwed ? `Discard ${progressOwed} progress` : 'Discarding…'
  if (ph.kind === 'over') todo = <>{<Who view={view} p={ph.winner} />} wins</>
  if (ph.kind === 'pillage') todo = ph.owed[view.you] ? 'Pick city to lose' : 'Barbarians win'
  if (ph.kind === 'aqueduct') todo = ph.owed[view.you] ? 'Pick a resource' : 'Waterworks…'
  if (ph.kind === 'payback') todo = ph.thief === view.you ? 'Caught! Give a card' : 'Caught!'
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
      <div className={`todo turn-of ${mine ? 'mine' : ''} ${toMe ? 'offer' : ''}`} style={{ ['--pc' as string]: PLAYER[view.players[view.current].color].ui }}>
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

function Labels({ view, layout, hand, tray, onPlayer }: { view: View; layout: ReturnType<typeof layoutFor>; hand: Hand | null; tray: TrayContents | null; onPlayer: (p: number) => void }) {
  const project = useProjector()
  const me = view.you
  // (a stack's top right corner; `base`: what it lies on, e.g. the tray's floor)
  const corner = ([x, z]: Spot, n: number, k = 1, base = 0) => {
    const [sx, sy] = project(x + (CARD.w * k) / 2 - 4, base + n * CARD.t + 2, z - (CARD.d * k) / 2 + 4)
    return { left: sx, top: sy }
  }
  const at = ([x, z]: Spot, y = 4) => {
    const [sx, sy] = project(x, y, z)
    return { left: sx, top: sy }
  }
  const count = (key: string, spot: Spot, n: number, k = 1, base = 0) =>
    n > 1 ? (
      <span key={key} className="count" style={corner(spot, n, k, base)}>
        {n}
      </span>
    ) : null
  const pl = me >= 0 ? view.players[me] : null
  return (
    <div className="labels">
      {/* the tray's stacks: give, get, the wildcard, a discard */}
      {tray && trayStacks(layout, tray, view.x ? GOODS : RESOURCES).map((st) => count(`t${st.side}${st.r ?? ''}`, st.at, st.n, CARD.small, TRAY_FLOOR))}
      {hand && (() => {
        const spots = packHand(layout.hand, view.x ? GOODS : RESOURCES, hand, layout.handEnd)
        // and under a stack you trade with the bank for less than 4 (a harbour, the trader, a charter, trade level 3), its rate
        const ratios = tradeRatios(view, me)
        return (view.x ? GOODS : RESOURCES).flatMap((r) => [
          count(`h${r}`, spots[r], hand[r]),
          hand[r] > 0 && ratios[r] < 4 ? (
            <span key={`rate${r}`} className="rate" style={at([spots[r][0], spots[r][1] + CARD.d / 2 - 2], hand[r] * CARD.t + 2)}>
              {ratios[r]}:1
            </span>
          ) : null,
        ])
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
            {!view.x && count(`kn${p}`, parts.knights, op.knights, parts.small ? CARD.small : 1)}
            {/* their name, points, longest road and knights (a tap: everything else about them) */}
            <span className={`name tappable ${parts.labelStart ? 'start' : ''} ${view.current === p ? 'turn' : ''}`} style={{ ...at(parts.label), ['--pc' as string]: PLAYER[op.color].ui }} onClick={() => onPlayer(p)}>
              {op.name} <b>{op.points}</b>
              <span className="lvs">
                <RoadChip view={view} p={p} />
                <KnightPower view={view} p={p} />
              </span>
            </span>
          </span>
        )
      })}
      {pl && !view.x && layout.armyMine && count('knme', layout.armyMine, pl.knights)}
      {pl && (
        <span className={`name mine tappable ${layout.meLabelStart ? 'start' : ''} ${view.current === me ? 'turn' : ''}`} style={{ ...at(layout.meLabel), ['--pc' as string]: PLAYER[pl.color].ui }} onClick={() => onPlayer(me)}>
          <span className="nm">
            {pl.name} <b>{pl.points}</b>
          </span>
          <span className="chips">
            {pl.hand && <i className="hc">{handSize(pl.hand)}</i>}
            <RoadChip view={view} p={me} />
            <KnightPower view={view} p={me} />
          </span>
        </span>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- the tray's buttons

type TrayActs = { ok: (() => void) | null; no: (() => void) | null; okLive: boolean; okWord: string; noWord: string }
/** what the tray's two buttons do now (and what they say, where there's room to say it) */
/** a tray that is exactly one bank trade (n of one kind at your rate, for one card, nobody picked): what it is */
function bankDeal(view: View, deal: Deal): { give: Good; get: Good } | null {
  if (typeof deal.to === 'number' || deal.any) return null
  const gives = GOODS.filter((r) => deal.give[r] > 0)
  const gets = GOODS.filter((r) => deal.get[r] > 0)
  if (gives.length !== 1 || gets.length !== 1 || deal.get[gets[0]] !== 1 || gives[0] === gets[0]) return null
  return deal.give[gives[0]] === tradeRatios(view, view.you)[gives[0]] && view.bank[gets[0]] > 0 ? { give: gives[0], get: gets[0] } : null
}

function trayActs({ view, deal, setDeal, owe, drop }: { view: View; deal: Deal | null; setDeal: (d: Deal | null) => void; owe: number; drop: Hand }): TrayActs {
  if (owe) return { ok: () => act({ type: 'discard', cards: drop }), okLive: handSize(drop) === owe, okWord: `Discard ${owe}`, no: null, noWord: '' }
  if (deal)
    // the check puts it to everyone, or to the one player picked (by a tap on their cards); the tray then clears
    // for the next one
    return {
      ok: () => {
        // exactly the bank's rate of one kind for one card (and not meant for a player): that's a bank trade
        const bank = bankDeal(view, deal)
        if (bank) return void act({ type: 'bankTrade', ...bank }).then((ok) => ok && setDeal(null))
        void act({ type: 'offerTrade', give: deal.give, get: deal.get, any: deal.any ?? 0, ...(typeof deal.to === 'number' ? { to: deal.to } : {}) }).then((ok) => ok && setDeal(null))
      },
      okLive: handSize(deal.give) > 0 && handSize(deal.get) + (deal.any ?? 0) > 0 && !GOODS.some((r) => deal.give[r] && deal.get[r]),
      okWord: 'Offer',
      no: () => setDeal(null),
      noWord: 'Clear',
    }
  return { ok: null, no: null, okLive: false, okWord: '', noWord: '' }
}

/** an offer's time left: a thin bar along the bottom of its row, running down */
function OfferTimer({ o }: { o: View['offers'][number] }) {
  if (!o.expires) return null
  const left = Math.max(0, o.expires - Date.now())
  return <i className="op-timer" key={o.expires} style={{ animationDuration: `${left}ms`, width: `${(left / OFFER_MS) * 100}%` }} />
}


/**
 * Open offers, one short row each, over the tray: what goes each way, then who. Yours: a chip per player asked, ✓,
 * ✕ or … (tap a ✓ to trade), and ✕ to take it back. One put to you: who it's from, and ✓ / ✕ (with a wildcard,
 * ✓ then the cards from your hand). And a trade you're putting together for one player: who.
 */
function Offers({ view, layout, target, pickFor, onPick }: { view: View; layout: ReturnType<typeof layoutFor>; target: number | null; pickFor: { id: number; need: number; picked: Hand } | null; onPick: (p: { id: number; need: number; picked: Hand } | null) => void }) {
  const project = useProjector()
  const me = view.you
  const pc = (p: number) => ({ ['--pc' as string]: PLAYER[view.players[p].color].ui })
  const chip = (p: number, mark: React.ReactNode = null, cls = '') => (
    <span key={p} className={`pchip ${cls}`} style={pc(p)}>
      {view.players[p].name} {mark !== null && <b>{mark}</b>}
    </span>
  )
  const hand = me >= 0 ? view.players[me].hand : null
  const rows = view.offers
    .filter((o) => o.from === me || (o.from !== me && (o.to === undefined || o.to === me) && !o.declined.includes(me)))
    .map((o) => {
      const mineO = o.from === me
      // what goes which way, from where you sit: what you give, then what you get
      const give = mineO ? o.give : { ...o.get }
      const get = mineO ? o.get : o.give
      const wild = o.any ? <span className="wild">?{o.any > 1 ? <b>{o.any}</b> : null}</span> : null
      const what = (
        <span className="op-what">
          <Bundle of={give} empty="" />
          {!mineO && wild}
          <span className="arrow">→</span>
          <Bundle of={get} empty="" />
          {mineO && wild}
        </span>
      )
      if (mineO) {
        const asked = view.players.map((_, i) => i).filter((i) => i !== me && (o.to === undefined || i === o.to))
        return (
          <div key={o.id} className="op-row">
            <OfferTimer o={o} />
            {what}
            {asked.map((p) => {
              const st = o.accepted.includes(p) ? 'yes' : o.declined.includes(p) ? 'no' : 'wait'
              if (st === 'yes')
                return (
                  <button key={p} className="pchip yes go" style={pc(p)} onClick={() => act({ type: 'confirmTrade', id: o.id, with: p })}>
                    {view.players[p].name} {o.any > 0 && o.picks[p] && <Bundle of={o.picks[p]} empty="" />} <b>⇄</b>
                  </button>
                )
              return chip(p, st === 'no' ? '✕' : <i className="dots" />, st)
            })}
            <button className="op-x" onClick={() => act({ type: 'cancelOffer', id: o.id })} aria-label="Cancel">
              ✕
            </button>
          </div>
        )
      }
      const answered = o.accepted.includes(me)
      const can = !!hand && GOODS.every((r) => hand[r] >= (o.get[r] ?? 0)) && handSize(hand) - handSize(o.get) >= o.any
      const picking = pickFor?.id === o.id
      return (
        <div key={o.id} className="op-row">
          <OfferTimer o={o} />
          {chip(o.from)}
          {what}
          {answered ? (
            <b className="op-done">✓</b>
          ) : picking ? (
            <span className="op-pick">
              <Bundle of={pickFor.picked} empty="" />
              <span className="wild">?<b>{pickFor.need - handSize(pickFor.picked)}</b></span>
              <button className="op-x" onClick={() => onPick(null)} aria-label="Back">
                ✕
              </button>
            </span>
          ) : (
            <span className="op-ans">
              <button className="op-ok" disabled={!can} onClick={() => (o.any ? onPick({ id: o.id, need: o.any, picked: emptyHand() }) : act({ type: 'acceptOffer', id: o.id }))} aria-label="Accept">
                ✓
              </button>
              <button className="op-no" onClick={() => act({ type: 'declineOffer', id: o.id })} aria-label="Decline">
                ✕
              </button>
            </span>
          )}
        </div>
      )
    })
  if (target !== null) rows.push(<div key="target" className="op-row target">{chip(target, '→')}</div>)
  if (!rows.length) return null
  const [x, top] = project(layout.tray[0], 0, layout.tray[1] - TRAY.d / 2)
  return (
    <div className="offers" style={{ left: x, top }}>
      {rows}
    </div>
  )
}

/** the tray's two marks: a green check and a red cross, beside it */
function TrayMarks({ layout, acts, onAny }: { layout: ReturnType<typeof layoutFor>; acts: TrayActs; onAny?: () => void }) {
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
      {onAny && (
        <button className="mark-btn any" onClick={onAny} aria-label="Any card">
          ?
        </button>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- a card of yours being sneaked away

/** a hand reaching for the card that's rising out of your stack: tap your cards to catch it */
function SnatchCue({ layout, hand, r }: { layout: ReturnType<typeof layoutFor>; hand: Hand; r: Good | undefined }) {
  const project = useProjector()
  // (two quick buzzes, where the phone can: someone's hand is in yours)
  useEffect(() => void navigator.vibrate?.([40, 60, 40]), [])
  if (!r) return null
  const kinds = GOODS.filter((g) => hand[g] > 0 || g === r)
  const at = packHand(layout.hand, kinds, hand, layout.handEnd)[r]
  if (!at) return null
  const [x, y] = project(at[0], 30, at[1] - CARD.d / 2)
  const [gx, gy] = project(at[0], 18, at[1])
  return (
    <>
      <div className="snatch-glow" style={{ left: gx, top: gy }} aria-hidden />
      <div className="snatch-cue" style={{ left: x, top: y }} aria-hidden>
        ✋
      </div>
    </>
  )
}

// ---------------------------------------------------------------- knights against the barbarians

/** each player's strength in ready knights */
const defenseOf = (view: View) => view.players.map((_, i) => Object.values(view.x?.knights ?? {}).reduce((n, k) => n + (k.owner === i && k.active ? k.level : 0), 0))

/** on a name tag: their ready knights' strength, and a crown for the one strongest (alone at the top) */
function KnightPower({ view, p }: { view: View; p: number }) {
  // the expansion: ready knights' strength (the one strongest alone glows); the basic game: knights played (Largest
  // Army glows)
  const d = view.x ? defenseOf(view) : view.players.map((pl) => pl.knights)
  const top = Math.max(...d)
  const lead = view.x ? top > 0 && d[p] === top && d.filter((x) => x === top).length === 1 : view.largestArmy === p
  return (
    <i className={`kp ${lead ? 'lead' : ''}`} title={view.x ? 'Ready knights' : 'Knights played'}>
      <svg viewBox="0 0 24 24" className="kp-shield">
        <path d={SHIELD} />
      </svg>
      {d[p]}
    </i>
  )
}

/** on a name tag: their longest road (Longest Road's holder glows gold) */
function RoadChip({ view, p }: { view: View; p: number }) {
  const n = longestRun(view, p)
  return (
    <i className={`kp road ${view.longestRoad === p ? 'lead' : ''}`} title="Longest road">
      <svg viewBox="0 0 24 24">
        <path d="M2 15.5l17-8 3 3.2-17 8z" />
      </svg>
      {n}
    </i>
  )
}

/** a player's tag tapped: their name and points, then everything else about them, small */
function PlayerCard({ view, p, onClose }: { view: View; p: number; onClose: () => void }) {
  const pl = view.players[p]
  const x = view.x
  return (
    <div className="zoom-back" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="player-card" style={{ ['--pc' as string]: PLAYER[pl.color].ui }}>
        <div className="pc-head">
          {pl.name} <b>{pl.points}</b>
        </div>
        <div className="pc-row">
          <RoadChip view={view} p={p} />
          <KnightPower view={view} p={p} />
          <i className="hc" title="Cards in hand">
            {pl.handCount}
          </i>
          {x ? (
            <span className="pc-n">
              <b>{pl.progressCount}</b> progress
            </span>
          ) : (
            <span className="pc-n">
              <b>{pl.cardCount}</b> dev cards
            </span>
          )}
        </div>
        {x && (
          <div className="pc-row">
            {TRACKS.map((t) => (
              <span key={t} className="pc-lv" style={{ ['--tc' as string]: TRACK_COLOR[t] }}>
                <b>{x.levels[p][t]}</b> {TRACK_NAME[t]}
              </span>
            ))}
          </div>
        )}
        <div className="pc-row pc-left">
          <span>
            <PieceIcon what="road" size={16} color={PLAYER[pl.color].ui} /> {pl.pieces.road}
          </span>
          <span>
            <PieceIcon what="settlement" size={16} color={PLAYER[pl.color].ui} /> {pl.pieces.settlement}
          </span>
          <span>
            <PieceIcon what="city" size={16} color={PLAYER[pl.color].ui} /> {pl.pieces.city}
          </span>
          <span className="pc-n">left</span>
        </div>
        <button className="zoom-btn" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </div>
    </div>
  )
}

/** by the barbarians' island: their strength (the cities on the island) against all the ready knights */
function BarbarianOdds({ view, layout }: { view: View; layout: ReturnType<typeof layoutFor> }) {
  const project = useProjector()
  const R = layout.k?.raid
  if (!R) return null
  const strength = Object.values(view.buildings).filter((b) => b.kind === 'city').length
  const defense = defenseOf(view).reduce((a, b) => a + b, 0)
  const [ix, iz] = raidToTable(R, R.island)
  const [x, y] = project(ix, 12, iz)
  return (
    <div className={`raid-odds ${defense >= strength ? 'hold' : 'lose'}`} style={{ left: x, top: y }}>
      <span title="Barbarians">⚔ {strength}</span>
      <span className="vs">vs</span>
      <span title="Ready knights">
        <svg viewBox="0 0 24 24">
          <path d={SHIELD} />
        </svg>
        {defense}
      </span>
    </div>
  )
}

// ---------------------------------------------------------------- something you must do now, big, for a moment

function Flash({ text }: { text: string | null }) {
  const [shown, setShown] = useState<string | null>(null)
  const was = useRef<string | null>(null)
  useEffect(() => {
    if (text && !was.current) setShown(text)
    was.current = text
  }, [text])
  useEffect(() => {
    if (!shown) return
    const t = setTimeout(() => setShown(null), 1300)
    return () => clearTimeout(t)
  }, [shown])
  if (!shown) return null
  return <div className="turn-banner warn">{shown}</div>
}

/**
 * Discarding: your whole hand, big, front and centre. Tap cards to pick them (they rise); tap again to put one back.
 * The button discards once enough are picked.
 */
function DiscardFan({ hand, drop, owe, setDrop, onDone, title, word = 'Discard' }: { hand: Hand; drop: Hand; owe: number; setDrop: (h: Hand) => void; onDone: () => void; title?: string; word?: string }) {
  const cards = GOODS.flatMap((r) => Array.from({ length: hand[r] }, (_, k) => ({ r, k })))
  const n = handSize(drop)
  return (
    <div className="fan-back must">
      <div className="must-head">
        {title ?? (
          <>
            Discard <b>{n}</b>/<b>{owe}</b>
          </>
        )}
      </div>
      <div className="fan" style={{ ['--n' as string]: cards.length }}>
        {cards.map(({ r, k }, i) => {
          const picked = k < drop[r]
          return (
            <button
              key={`${r}${k}`}
              className={`fan-card ${picked ? 'sel' : ''}`}
              style={{ ['--i' as string]: i - (cards.length - 1) / 2, ['--a' as string]: Math.abs(i - (cards.length - 1) / 2), backgroundImage: `url(${faceURL(`res:${r}`)})` }}
              onClick={() => (picked ? setDrop(add(drop, r, -1)) : n < owe && setDrop(add(drop, r)))}
              aria-label={r}
            />
          )
        })}
      </div>
      <button className="zoom-btn go" disabled={n !== owe} onClick={onDone}>
        {word}
      </button>
    </div>
  )
}


// ---------------------------------------------------------------- a city track up close

function TrackZoom({ track, level, onClose, onImprove }: { track: Track; level: number; onClose: () => void; onImprove: (() => void) | null }) {
  const good = TRACK_GOOD[track]
  return (
    <div className="zoom-back" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="track-zoom" style={{ ['--tc' as string]: TRACK_COLOR[track] }}>
        <div className="tz-head">{TRACK_NAME[track]}</div>
        <ol className="tz-levels">
          {TRACK_LEVELS[track].map((name, i) => (
            <li key={i} className={i < level ? 'done' : i === level ? 'next' : ''}>
              <b className="tz-n">{i + 1}</b>
              <span className="tz-name">
                {name}
                {i === 2 && <small>{TRACK_PERK[track]}</small>}
                {i === 3 && <small>First here: metropolis, +2</small>}
              </span>
              <span className="tz-dice" title="Red die rolls that draw a card">
                {Array.from({ length: Math.min(6, i + 2) }, (_, f) => (
                  <DieFace key={f} v={f + 1} kind="red" />
                ))}
              </span>
              <Bundle of={{ [good]: i + 1 }} />
            </li>
          ))}
        </ol>
        <div className="tz-note">
          <span className="tz-gate" /> on the event die + a red die shown: a card
        </div>
        <div className="zoom-row">
          {onImprove && (
            <button className="zoom-btn go" onClick={onImprove}>
              Improve
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

// ---------------------------------------------------------------- the bank, open in the middle (a phone)

function BankPanel({ view, hand, kinds, pick, onPick, onTrade, onClose }: { view: View; hand: Hand; kinds: readonly Good[]; pick: { give: Good | null; get: Good | null }; onPick: (p: { give: Good | null; get: Good | null }) => void; onTrade: () => void; onClose: () => void }) {
  const ratios = tradeRatios(view, view.you)
  const payable = kinds.filter((r) => hand[r] >= ratios[r])
  const gettable = kinds.filter((r) => view.bank[r] > 0)
  const ready = !!pick.give && !!pick.get && pick.give !== pick.get
  return (
    <div className="fan-back must bank-panel" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="must-head">Bank</div>
      <div className="bp-label">Give</div>
      <div className="ch-cards">
        {payable.length ? (
          payable.map((r) => (
            <button key={r} className={`ch-card ${pick.give === r ? 'sel' : ''}`} style={{ backgroundImage: `url(${faceURL(`res:${r}`)})` }} onClick={() => onPick({ give: r, get: pick.get === r ? null : pick.get })} aria-label={`Give ${ratios[r]} ${r}`}>
              <span className="bp-rate">{ratios[r]}:1</span>
            </button>
          ))
        ) : (
          <span className="bp-none">–</span>
        )}
      </div>
      <div className="bp-label">Get</div>
      <div className="ch-cards">
        {gettable.map((r) => (
          <button key={r} className={`ch-card ${pick.get === r ? 'sel' : ''}`} disabled={r === pick.give} style={{ backgroundImage: `url(${faceURL(`res:${r}`)})` }} onClick={() => onPick({ give: pick.give, get: r })} aria-label={`Get ${r}`} />
        ))}
      </div>
      <div className="zoom-row">
        <button className="zoom-btn go" disabled={!ready} onClick={onTrade}>
          {ready ? (
            <>
              {ratios[pick.give!]} <Icon r={pick.give!} size={18} color="#fff" /> → 1 <Icon r={pick.get!} size={18} color="#fff" />
            </>
          ) : (
            'Trade'
          )}
        </button>
        <button className="zoom-btn" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- a choice, in the middle

/** pick one: cards (a resource, a commodity), players, or numbers; ✕ backs out where that's allowed */
function Chooser({ title, cards, players, numbers, view, onCancel }: { title: string; cards?: { key: string; look: string; go: () => void }[]; players?: { p: number; go: () => void }[]; numbers?: { n: number; go: () => void }[]; view?: View; onCancel?: () => void }) {
  return (
    <div className="fan-back must chooser">
      <div className="must-head">{title}</div>
      {cards && (
        <div className="ch-cards">
          {cards.map((c) => (
            <button key={c.key} className="ch-card" style={{ backgroundImage: `url(${faceURL(c.look)})` }} onClick={c.go} aria-label={c.key} />
          ))}
        </div>
      )}
      {players && view && (
        <div className="ch-players">
          {players.map(({ p, go }) => (
            <button key={p} className="ch-player" style={{ ['--pc' as string]: PLAYER[view.players[p].color].ui }} onClick={go}>
              {view.players[p].name}
            </button>
          ))}
        </div>
      )}
      {numbers && (
        <div className="ch-numbers">
          {numbers.map(({ n, go }) => (
            <button key={n} className={`ch-number ${n === 6 || n === 8 ? 'red' : ''}`} onClick={go}>
              {n}
            </button>
          ))}
        </div>
      )}
      {onCancel && (
        <button className="zoom-btn" onClick={onCancel} aria-label="Back">
          ✕
        </button>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- robbing

/** the victim's cards, face down in a fan: tap one to take it */
function StealFan({ n, faces, onPick, onClose }: { n: number; faces?: string[]; onPick: (i: number) => void; onClose?: () => void }) {
  const back = faceURL('res:?')
  return (
    <div className="fan-back" onClick={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className="fan" style={{ ['--n' as string]: n }}>
        {Array.from({ length: n }, (_, i) => (
          <button key={i} className="fan-card" style={{ ['--i' as string]: i - (n - 1) / 2, ['--a' as string]: Math.abs(i - (n - 1) / 2), backgroundImage: `url(${faces?.[i] ? faceURL(faces[i]) : back})` }} onClick={() => onPick(i)} aria-label={`Card ${i + 1}`} />
        ))}
      </div>
    </div>
  )
}

/** being robbed: your cards, face up, in the order the robber sees them face down; tap two to swap them */
function MyFan({ order }: { order: Good[] }) {
  const [sel, setSel] = useState<number | null>(null)
  const tap = (i: number) => {
    if (sel === null) return setSel(i)
    if (sel !== i) {
      const next = [...order]
      ;[next[sel], next[i]] = [next[i], next[sel]]
      act({ type: 'arrange', order: next })
    }
    setSel(null)
  }
  const shuffle = () => {
    const next = [...order]
    for (let i = next.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[next[i], next[j]] = [next[j], next[i]]
    }
    act({ type: 'arrange', order: next })
  }
  return (
    <div className="my-fan">
      <div className="fan small" style={{ ['--n' as string]: order.length }}>
        {order.map((g, i) => (
          <button key={i} className={`fan-card ${sel === i ? 'sel' : ''}`} style={{ ['--i' as string]: i - (order.length - 1) / 2, ['--a' as string]: Math.abs(i - (order.length - 1) / 2), backgroundImage: `url(${faceURL(`res:${g}`)})` }} onClick={() => tap(i)} aria-label={g} />
        ))}
      </div>
      <button className="fan-shuffle" onClick={shuffle} aria-label="Shuffle">
        ⤮
      </button>
    </div>
  )
}

// ---------------------------------------------------------------- your turn, big, for a moment

function TurnBanner({ view }: { view: View }) {
  const mine = view.you >= 0 && view.current === view.you && view.phase.kind !== 'over'
  const [shown, setShown] = useState(0)
  const was = useRef(mine)
  useEffect(() => {
    if (mine && !was.current) {
      setShown((n) => n + 1)
      // (a short buzz, where the phone can)
      navigator.vibrate?.(60)
    }
    was.current = mine
  }, [mine])
  useEffect(() => {
    if (!shown) return
    const t = setTimeout(() => setShown(0), 1300)
    return () => clearTimeout(t)
  }, [shown])
  if (!shown || !mine) return null
  return (
    <div className="turn-banner" key={shown} style={{ ['--pc' as string]: PLAYER[view.players[view.you].color].ui }}>
      Your turn
    </div>
  )
}

// ---------------------------------------------------------------- a card held up close

/** what a played card led to: the events after it, until the next play, roll or turn */
function whatFollowed(view: View, e: View['events'][number]): React.ReactNode {
  const i = view.events.findIndex((x) => x.n === e.n)
  const out: React.ReactNode[] = []
  for (const x of view.events.slice(i + 1)) {
    if (x.k === 'progress' || x.k === 'play' || x.k === 'roll' || x.k === 'turn') break
    const line = describe(view, x)
    if (line) out.push(<div key={x.n}>{line}</div>)
  }
  return out.length ? out : null
}

function CardZoom({ look, caption, after, action, why, onClose }: { look: string; caption: string | null; after?: React.ReactNode; action: { word: string; go: () => void } | null; why?: string | null; onClose: () => void }) {
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
        {after && <div className="zoom-after">{after}</div>}
        {why && <div className="zoom-why">{why}</div>}
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
  // (the results can be put aside to look at the table, and brought back)
  const [away, setAway] = useState(false)
  if (ph.kind !== 'over') return null
  const order = view.players.map((p, i) => ({ p, i })).sort((a, b) => b.p.points - a.p.points)
  if (away)
    return (
      <button className="stamp-btn go results-btn" onClick={() => setAway(false)}>
        Results
      </button>
    )
  return (
    <div className="dialog-back">
      <div className="paper dialog results">
        <div className="dialog-head">{ph.winner === view.you ? 'You win' : `${view.players[ph.winner].name} wins`}</div>
        <div className="scores">
          {order.map(({ p, i }) => (
            <div key={p.id} className="score">
              <Who view={view} p={i} />
              <b>{p.points}</b>
            </div>
          ))}
        </div>
        <GameStats view={view} />
        <div className="dialog-foot">
          <button className="stamp-btn" onClick={() => setAway(true)}>
            Board
          </button>
          <button className="stamp-btn go" onClick={() => room.leave()}>
            Menu
          </button>
        </div>
      </div>
    </div>
  )
}
