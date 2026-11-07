/**
 * The client's one source of truth: what room you're in and your view of the game.
 *
 * Two ways to play behind one interface: online (the server owns the game) and solo (the same rules engine runs
 * here in the browser against bots, no server needed). The UI never knows which.
 */
import { useSyncExternalStore, type ReactNode } from 'react'
import { io, type Socket } from 'socket.io-client'
import { BOT_CAST, botAction, brain, type Brain, type Level } from '../../shared/bot.ts'
import { OFFER_MS, apply, newGame, viewFor, type Action, type GameState, type View } from '../../shared/engine.ts'
import type { Ack, ClientToServer, RoomInfo, ServerToClient } from '../../shared/protocol.ts'
import type { Progress } from '../../shared/rules.ts'

type Store = { room: RoomInfo | null; view: View | null; connected: boolean; serverDown: boolean; solo: boolean; toast: ReactNode }
let store: Store = { room: null, view: null, connected: false, serverDown: false, solo: false, toast: null }
const subs = new Set<() => void>()
const set = (p: Partial<Store>) => {
  store = { ...store, ...p }
  subs.forEach((f) => f())
}
export const useStore = () => useSyncExternalStore((f) => (subs.add(f), () => subs.delete(f)), () => store)

function safeGet(k: string) {
  try {
    return localStorage.getItem(k)
  } catch {
    return null
  }
}
function safeSet(k: string, v: string) {
  try {
    localStorage.setItem(k, v)
  } catch {
    /* private mode: fine, just not remembered */
  }
}

export const myName = () => safeGet('name') ?? ''
export const rememberName = (n: string) => safeSet('name', n)

export const playerId = (() => {
  const had = safeGet('player')
  if (had) return had
  const id = crypto.randomUUID?.() ?? Math.random().toString(36).slice(2) + Date.now().toString(36)
  safeSet('player', id)
  return id
})()

const SERVER = import.meta.env.VITE_SERVER_URL ?? (import.meta.env.DEV ? `${location.protocol}//${location.hostname}:3001` : location.origin)

let socket: Socket<ServerToClient, ClientToServer> | null = null
export function connect() {
  if (socket) return
  // websockets first; where a network blocks them, plain requests instead (slower, but it plays). Reconnecting keeps
  // trying for good, a little apart, so a phone coming back from sleep or a server restarting finds its way back.
  socket = io(SERVER, { auth: { player: playerId }, transports: ['websocket', 'polling'], tryAllTransports: true, reconnectionDelayMax: 4000 })
  let failures = 0
  socket.on('connect', () => ((failures = 0), set({ connected: true, serverDown: false })))
  // no game server here (a static host with no server set): say so, rather than "connecting" forever
  socket.on('connect_error', () => ++failures >= 3 && !store.serverDown && set({ serverDown: true }))
  socket.on('disconnect', () => set({ connected: false }))
  socket.on('room', (room) => {
    if (store.solo) return
    // a new game (or none): the old view goes with the old game
    const same = room?.started && store.room?.started && store.room.code === room.code && store.room.game === room.game
    set(same ? { room } : { room, view: null })
    // a room link (?room=CODE) has done its job once you're in
    if (room && new URLSearchParams(location.search).has('room')) history.replaceState(null, '', location.pathname)
  })
  socket.on('game', (view) => !store.solo && store.room?.started && set({ view }))
}

let toastTimer: ReturnType<typeof setTimeout> | undefined
export function toast(msg: ReactNode) {
  set({ toast: msg })
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => set({ toast: null }), 3200)
}

/** a request the server answers; one it doesn't answer in time (a dropped line) fails rather than hangs */
const call = <A extends unknown[]>(ev: keyof ClientToServer, ...args: A) =>
  new Promise<Ack>((res) => {
    if (!socket?.connected) return res({ ok: false, error: 'Offline' })
    ;(socket.timeout(8000).emit as (...a: unknown[]) => void)(ev, ...args, (err: unknown, a: Ack) => res(err ? { ok: false, error: 'No answer' } : a))
  })

export const room = {
  create: (name: string) => call('room:create', name),
  join: (code: string, name: string) => call('room:join', code, name),
  leave: () => {
    if (store.solo) return endSolo()
    socket?.emit('room:leave')
  },
  rename: (name: string) => socket?.emit('room:rename', name),
  ready: () => socket?.emit('room:ready'),
  addBot: (level?: Level) => socket?.emit('room:addBot', level),
  botLevel: (id: string, level: Level) => socket?.emit('room:botLevel', id, level),
  knights: (on: boolean) => socket?.emit('room:knights', on),
  removeSeat: (id: string) => socket?.emit('room:removeSeat', id),
  start: () => call('room:start'),
  /** the host ends the game for everyone (solo: back to the start) */
  end: () => {
    if (store.solo) return endSolo()
    socket?.emit('room:end')
  },
  /** after a game: another one (online, back to the room with everyone; solo, a fresh game the same way) */
  again: () => {
    if (store.solo && lastSolo) return startSolo(...lastSolo)
    socket?.emit('room:end')
  },
}

/** does a move; with the reason when it can't (nothing is toasted: the caller shows it) */
export async function tryAct(a: Action): Promise<string | null> {
  if (store.solo) {
    if (!solo) return 'No game.'
    const who = solo.players.findIndex((x) => x.id === 'you')
    const r = apply(solo, who, a)
    if (!r.ok) return r.error.replace(/\.$/, '')
    solo = r.state
    soloPublish()
    return null
  }
  const r = await call('game:action', a)
  return r.ok ? null : r.error.replace(/\.$/, '')
}

/** does a move; says why not when it can't */
export async function act(a: Action): Promise<boolean> {
  if (store.solo) {
    if (a.type === 'snatchEnd') return false
    const ok = soloAct(0, a)
    if (ok && a.type === 'snatch') armSoloSnatch()
    return ok
  }
  const r = await call('game:action', a)
  if (!r.ok) toast(r.error.replace(/\.$/, ''))
  return r.ok
}

// ---------------------------------------------------------------- solo: you against bots, all in the browser

let solo: GameState | null = null
const BOT_OFFER_MS = 10_000
const AUTO = typeof location !== 'undefined' && /[?&]auto/.test(location.search) && /[?&]test/.test(location.search)
/** ?test&auto=N: stop playing your seat at turn N */
const autoStop = () => {
  const n = Number(new URLSearchParams(location.search).get('auto'))
  return n > 0 && (solo?.turn ?? 0) >= n
}
let soloTimer: ReturnType<typeof setTimeout> | undefined
/** (?test: a browser test may hold the bots still, to look at a moment) */
let held = false
if (typeof window !== 'undefined' && /[?&]test/.test(location.search))
  (window as unknown as { __hold: (on: boolean) => void }).__hold = (on) => {
    held = on
    soloPublish()
  }

function soloPublish() {
  if (!solo) return
  // a new offer gets its time; when that runs out (and it's still open), it closes
  for (const o of solo.offers) {
    if (o.expires) continue
    // (a bot's offer waits less: it has a turn to get on with)
    const ms = solo.players[o.from].id === 'you' ? OFFER_MS : BOT_OFFER_MS
    o.expires = Date.now() + ms
    setTimeout(() => {
      if (!solo?.offers.some((x) => x.id === o.id)) return
      const r = apply(solo, o.from, { type: 'cancelOffer', id: o.id })
      if (!r.ok) return
      solo = r.state
      soloPublish()
    }, ms)
  }
  const you = solo.players.findIndex((p) => p.id === 'you')
  set({ view: viewFor(solo, you) })
  clearTimeout(soloTimer)
  if (solo.phase.kind === 'over') return
  const g = solo
  // (?test&auto: a bot plays your seat too, for looking at a game in progress)
  const auto = AUTO && !autoStop()
  const next = g.players.map((_, i) => i).find((i) => (auto || i !== you) && botAction(viewFor(g, i), i, Math.random, soloBrain(i)) !== null)
  if (next === undefined || held) return
  soloTimer = setTimeout(() => {
    if (!solo) return
    const a = botAction(viewFor(solo, next), next, Math.random, soloBrain(next))
    if (a && soloAct(next, a, true) && a.type === 'snatch') armSoloSnatch()
  }, AUTO ? 40 : solo.phase.kind === 'setup' ? 450 : solo.phase.kind === 'steal' ? 2500 : 700)
}

// (?test: a browser test may hand your seat some cards from the bank, to try things that cost them)
if (typeof window !== 'undefined' && /[?&]test/.test(location.search))
  (window as unknown as { __grant: (h: Partial<Record<string, number>>) => void }).__grant = (h) => {
    if (!solo) return
    const you = solo.players.findIndex((p) => p.id === 'you')
    const g = structuredClone(solo)
    for (const [k, n] of Object.entries(h)) {
      const take = Math.min(n ?? 0, g.bank[k as keyof typeof g.bank])
      g.bank[k as keyof typeof g.bank] -= take
      g.players[you].hand[k as keyof typeof g.bank] += take
    }
    solo = g
    soloPublish()
  }
// (or change the game any way at all, to set up a moment to look at)
if (typeof window !== 'undefined' && /[?&]test/.test(location.search))
  (window as unknown as { __edit: (f: (g: GameState, you: number) => void) => void }).__edit = (f) => {
    if (!solo) return
    const g = structuredClone(solo)
    f(g, g.players.findIndex((p) => p.id === 'you'))
    solo = g
    soloPublish()
  }
// (and some progress cards, by name, out of their decks)
if (typeof window !== 'undefined' && /[?&]test/.test(location.search))
  (window as unknown as { __grantProgress: (cards: string[]) => void }).__grantProgress = (cards) => {
    if (!solo?.x) return
    const you = solo.players.findIndex((p) => p.id === 'you')
    const g = structuredClone(solo)
    for (const c of cards)
      for (const d of Object.values(g.x!.decks)) {
        const i = d.indexOf(c as (typeof d)[number])
        if (i < 0) continue
        d.splice(i, 1)
        g.players[you].progress.push({ card: c as Progress, turn: -1 })
        break
      }
    solo = g
    soloPublish()
  }

function soloAct(p: number, a: Action, bot = false): boolean {
  if (!solo) return false
  const who = bot ? p : solo.players.findIndex((x) => x.id === 'you')
  const r = apply(solo, who, a)
  if (!r.ok) {
    if (!bot) toast(r.error.replace(/\.$/, ''))
    return false
  }
  solo = r.state
  soloPublish()
  return true
}

/** each bot's mind: its level, its persona, what it remembers (your seat, under ?test&auto, plays as a normal bot) */
let soloBrains: Brain[] = []
let soloGames = 0
const soloBrain = (i: number) => (soloBrains[i] ??= brain())

/** a card being sneaked: the moment to catch it, then the thief has it */
function armSoloSnatch() {
  const sn = solo?.snatch
  if (sn)
    setTimeout(() => {
      if (!solo || solo.snatch?.id !== sn.id) return
      soloAct(sn.thief, { type: 'snatchEnd' }, true)
    }, 2000)
}

let lastSolo: [string, number, boolean, Level] | null = null
export function startSolo(name: string, bots: number, knights = true, level: Level = 'normal') {
  lastSolo = [name, bots, knights, level]
  // a random few from the cast, each with its own way of playing
  const cast = [...BOT_CAST].sort(() => Math.random() - 0.5).slice(0, bots)
  const seats = [{ id: 'you', name: name || 'You' }, ...cast.map((c, i) => ({ id: `bot${i}`, name: c.name }))]
  solo = newGame(seats, (Math.random() * 2 ** 31) | 0, { knights })
  soloBrains = [brain(), ...cast.map((c) => ({ ...brain(level, c.persona), people: [0] }))]
  set({
    solo: true,
    room: {
      code: 'SOLO',
      host: 'you',
      started: true,
      game: ++soloGames,
      knights,
      seats: seats.map((s, i) => ({ ...s, ready: true, bot: s.id !== 'you', connected: true, ...(i ? { level, persona: cast[i - 1].persona } : {}) })),
    },
  })
  soloPublish()
}

function endSolo() {
  clearTimeout(soloTimer)
  solo = null
  set({ solo: false, room: null, view: null })
}
