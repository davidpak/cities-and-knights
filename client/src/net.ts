/**
 * The client's one source of truth: what room you're in and your view of the game.
 *
 * Two ways to play behind one interface: online (the server owns the game) and solo (the same rules engine runs
 * here in the browser against bots, no server needed). The UI never knows which.
 */
import { useSyncExternalStore } from 'react'
import { io, type Socket } from 'socket.io-client'
import { botAction } from '../../shared/bot.ts'
import { apply, newGame, viewFor, type Action, type GameState, type View } from '../../shared/engine.ts'
import type { Ack, ClientToServer, RoomInfo, ServerToClient } from '../../shared/protocol.ts'

type Store = { room: RoomInfo | null; view: View | null; connected: boolean; solo: boolean; toast: string | null }
let store: Store = { room: null, view: null, connected: false, solo: false, toast: null }
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
  socket = io(SERVER, { auth: { player: playerId }, transports: ['websocket', 'polling'] })
  socket.on('connect', () => set({ connected: true }))
  socket.on('disconnect', () => set({ connected: false }))
  socket.on('room', (room) => !store.solo && set({ room }))
  socket.on('game', (view) => !store.solo && set({ view }))
}

let toastTimer: ReturnType<typeof setTimeout> | undefined
export function toast(msg: string) {
  set({ toast: msg })
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => set({ toast: null }), 3200)
}

const call = <A extends unknown[]>(ev: keyof ClientToServer, ...args: A) =>
  new Promise<Ack>((res) => {
    if (!socket?.connected) return res({ ok: false, error: 'Not connected to the server.' })
    ;(socket.emit as (...a: unknown[]) => void)(ev, ...args, res)
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
  addBot: () => socket?.emit('room:addBot'),
  removeSeat: (id: string) => socket?.emit('room:removeSeat', id),
  start: () => call('room:start'),
}

/** does a move; says why not when it can't */
export async function act(a: Action): Promise<boolean> {
  if (store.solo) return soloAct(0, a)
  const r = await call('game:action', a)
  if (!r.ok) toast(r.error)
  return r.ok
}

// ---------------------------------------------------------------- solo: you against bots, all in the browser

let solo: GameState | null = null
let soloTimer: ReturnType<typeof setTimeout> | undefined

function soloPublish() {
  if (!solo) return
  const you = solo.players.findIndex((p) => p.id === 'you')
  set({ view: viewFor(solo, you) })
  clearTimeout(soloTimer)
  if (solo.phase.kind === 'over') return
  const g = solo
  const next = g.players.map((_, i) => i).find((i) => i !== you && botAction(viewFor(g, i), i, Math.random) !== null)
  if (next === undefined) return
  soloTimer = setTimeout(() => {
    if (!solo) return
    const a = botAction(viewFor(solo, next), next, Math.random)
    if (a) soloAct(next, a, true)
  }, solo.phase.kind === 'setup' ? 450 : 700)
}

function soloAct(p: number, a: Action, bot = false): boolean {
  if (!solo) return false
  const who = bot ? p : solo.players.findIndex((x) => x.id === 'you')
  const r = apply(solo, who, a)
  if (!r.ok) {
    if (!bot) toast(r.error)
    return false
  }
  solo = r.state
  soloPublish()
  return true
}

export function startSolo(name: string, bots: number) {
  const names = ['Bramble', 'Pip', 'Juniper']
  const seats = [{ id: 'you', name: name || 'You' }, ...names.slice(0, bots).map((n, i) => ({ id: `bot${i}`, name: n }))]
  solo = newGame(seats, (Math.random() * 2 ** 31) | 0)
  set({
    solo: true,
    room: { code: 'SOLO', host: 'you', started: true, seats: seats.map((s) => ({ ...s, ready: true, bot: s.id !== 'you', connected: true })) },
  })
  soloPublish()
}

function endSolo() {
  clearTimeout(soloTimer)
  solo = null
  set({ solo: false, room: null, view: null })
}
