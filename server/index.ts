/**
 * The game server: rooms, the lobby, and the one real copy of each game.
 *
 * Players are known by an id their browser keeps (not by their socket), so a refresh or a dropped connection puts
 * them straight back in their seat. Every move goes through the shared rules engine; each player is then sent their
 * own view of the game (other hands as counts). Bots fill empty seats and move on a short delay, so people can see
 * what they did.
 */
import express from 'express'
import { existsSync } from 'node:fs'
import { createServer } from 'node:http'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Server, type Socket } from 'socket.io'
import { botAction } from '../shared/bot.ts'
import { OFFER_MS, apply, newGame, viewFor, type GameState } from '../shared/engine.ts'
import { MAX_SEATS, NAME_MAX, type ClientToServer, type RoomInfo, type Seat, type ServerToClient } from '../shared/protocol.ts'

type Room = { code: string; host: string; seats: Seat[]; game: GameState | null; knights: boolean; botTimer?: NodeJS.Timeout; emptySince?: number }
type Sock = Socket<ClientToServer, ServerToClient, Record<string, never>, { player: string }>

const rooms = new Map<string, Room>()
const roomOf = new Map<string, string>() // player id -> room code
const sockets = new Map<string, Set<Sock>>() // player id -> its open sockets

const app = express()
const http = createServer(app)
const io = new Server<ClientToServer, ServerToClient>(http, { cors: { origin: '*' } })

app.get('/health', (_req, res) => void res.json({ ok: true, rooms: rooms.size }))

// the built client, when there is one (one deploy serves both)
const here = dirname(fileURLToPath(import.meta.url))
const dist = join(here, '..', 'client', 'dist')
if (existsSync(dist)) {
  app.use(express.static(dist))
  app.get(/^\/(?!socket\.io).*/, (_req, res) => res.sendFile(join(dist, 'index.html')))
} else app.get('/', (_req, res) => void res.send('Server is running.'))

const cleanName = (n: unknown) => (typeof n === 'string' ? n.trim().slice(0, NAME_MAX) : '') || 'Player'
const newCode = () => {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
  for (;;) {
    const c = Array.from({ length: 5 }, () => A[Math.floor(Math.random() * A.length)]).join('')
    if (!rooms.has(c)) return c
  }
}
/** how long a victim has to catch a card being sneaked away */
const SNATCH_MS = 2000
const BOT_NAMES = ['Bramble', 'Pip', 'Juniper', 'Moss', 'Clover', 'Wren']

function info(r: Room): RoomInfo {
  return { code: r.code, host: r.host, seats: r.seats, started: r.game !== null, knights: r.knights }
}

/** a new offer gets its time: when that runs out (and it's still open), it closes */
function armOffers(r: Room) {
  for (const o of r.game?.offers ?? []) {
    if (o.expires) continue
    o.expires = Date.now() + OFFER_MS
    setTimeout(() => {
      const g = r.game
      if (!g || !g.offers.some((x) => x.id === o.id)) return
      const res = apply(g, o.from, { type: 'cancelOffer', id: o.id })
      if (!res.ok) return
      r.game = res.state
      send(r)
    }, OFFER_MS)
  }
}

function send(r: Room) {
  armOffers(r)
  for (const seat of r.seats) {
    for (const s of sockets.get(seat.id) ?? []) {
      s.emit('room', info(r))
      if (r.game) s.emit('game', viewFor(r.game, r.game.players.findIndex((p) => p.id === seat.id)))
    }
  }
  scheduleBots(r)
}

function scheduleBots(r: Room) {
  if (!r.game || r.botTimer || r.game.phase.kind === 'over') return
  const g = r.game
  const bots = g.players.map((p, i) => ({ p, i })).filter(({ p }) => r.seats.find((s) => s.id === p.id)?.bot)
  // a discard or an answer to an offer can be anyone's; otherwise only the current player moves
  const next = bots.find(({ i }) => botAction(viewFor(g, i), i, Math.random) !== null)
  if (!next) return
  r.botTimer = setTimeout(() => {
    r.botTimer = undefined
    if (!r.game) return
    const a = botAction(viewFor(r.game, next.i), next.i, Math.random)
    if (!a) return
    const res = apply(r.game, next.i, a)
    if (res.ok) r.game = res.state
    else console.warn(`bot ${next.p.name} tried ${a.type}: ${res.error}`)
    send(r)
  }, r.game.phase.kind === 'setup' ? 500 : r.game.phase.kind === 'steal' ? 2500 : 750)
}

function leave(player: string) {
  const code = roomOf.get(player)
  const r = code ? rooms.get(code) : undefined
  roomOf.delete(player)
  for (const s of sockets.get(player) ?? []) {
    if (code) s.leave(code)
    s.emit('room', null)
    s.emit('game', null)
  }
  if (!r) return
  if (r.game) {
    // in a game the seat stays (a bot takes it over), so the game can go on
    const seat = r.seats.find((s) => s.id === player)
    if (seat) {
      seat.bot = true
      seat.connected = true
      seat.name = `${seat.name} (bot)`
      const gp = r.game.players.find((p) => p.id === player)
      if (gp) gp.name = seat.name
    }
  } else r.seats = r.seats.filter((s) => s.id !== player)
  if (r.host === player) r.host = r.seats.find((s) => !s.bot && roomOf.get(s.id) === r.code)?.id ?? r.host
  if (!r.seats.some((s) => !s.bot && roomOf.get(s.id) === r.code)) {
    clearTimeout(r.botTimer)
    rooms.delete(r.code)
    return
  }
  send(r)
}

io.on('connection', (raw) => {
  const socket = raw as Sock
  const player = typeof socket.handshake.auth?.player === 'string' ? socket.handshake.auth.player.slice(0, 64) : socket.id
  socket.data.player = player
  if (!sockets.has(player)) sockets.set(player, new Set())
  sockets.get(player)!.add(socket)

  // back in your seat after a refresh
  const code = roomOf.get(player)
  const r = code ? rooms.get(code) : undefined
  if (r) {
    socket.join(r.code)
    const seat = r.seats.find((s) => s.id === player)
    if (seat) seat.connected = true
    r.emptySince = undefined
    send(r)
  } else {
    socket.emit('room', null)
    socket.emit('game', null)
  }

  const myRoom = () => {
    const c = roomOf.get(player)
    return c ? rooms.get(c) : undefined
  }

  socket.on('room:create', (name, ack) => {
    if (myRoom()) leave(player)
    const code = newCode()
    const room: Room = { code, host: player, seats: [{ id: player, name: cleanName(name), ready: false, bot: false, connected: true }], game: null, knights: true }
    rooms.set(code, room)
    roomOf.set(player, code)
    for (const s of sockets.get(player) ?? []) s.join(code)
    ack({ ok: true, code })
    send(room)
  })

  socket.on('room:join', (rawCode, name, ack) => {
    const code = String(rawCode ?? '').trim().toUpperCase()
    const room = rooms.get(code)
    if (!room) return ack({ ok: false, error: 'No room with that code.' })
    if (room.seats.some((s) => s.id === player)) {
      roomOf.set(player, code)
      for (const s of sockets.get(player) ?? []) s.join(code)
      ack({ ok: true, code })
      return send(room)
    }
    if (room.game) return ack({ ok: false, error: 'That game has already started.' })
    if (room.seats.length >= MAX_SEATS) return ack({ ok: false, error: 'That room is full.' })
    if (myRoom()) leave(player)
    room.seats.push({ id: player, name: cleanName(name), ready: false, bot: false, connected: true })
    roomOf.set(player, code)
    for (const s of sockets.get(player) ?? []) s.join(code)
    ack({ ok: true, code })
    send(room)
  })

  socket.on('room:leave', () => leave(player))

  socket.on('room:rename', (name) => {
    const room = myRoom()
    const seat = room?.seats.find((s) => s.id === player)
    if (!room || !seat || room.game) return
    seat.name = cleanName(name)
    send(room)
  })

  socket.on('room:ready', () => {
    const room = myRoom()
    const seat = room?.seats.find((s) => s.id === player)
    if (!room || !seat || room.game) return
    seat.ready = !seat.ready
    send(room)
  })

  socket.on('room:addBot', () => {
    const room = myRoom()
    if (!room || room.host !== player || room.game || room.seats.length >= MAX_SEATS) return
    const used = new Set(room.seats.map((s) => s.name))
    const name = BOT_NAMES.find((n) => !used.has(n)) ?? 'Bot'
    room.seats.push({ id: `bot-${Math.random().toString(36).slice(2, 10)}`, name, ready: true, bot: true, connected: true })
    send(room)
  })

  socket.on('room:removeSeat', (id) => {
    const room = myRoom()
    if (!room || room.host !== player || room.game || id === player) return
    room.seats = room.seats.filter((s) => s.id !== id || !s.bot)
    send(room)
  })

  socket.on('room:knights', (on) => {
    const code = roomOf.get(player)
    const room = code ? rooms.get(code) : undefined
    if (!room || room.host !== player || room.game) return
    room.knights = !!on
    send(room)
  })
  socket.on('room:start', (ack) => {
    const room = myRoom()
    if (!room) return ack({ ok: false, error: 'You are not in a room.' })
    if (room.host !== player) return ack({ ok: false, error: 'Only the host can start.' })
    if (room.game) return ack({ ok: false, error: 'Already started.' })
    if (room.seats.length < 2) return ack({ ok: false, error: 'You need at least 2 players (add a bot?).' })
    if (!room.seats.every((s) => s.ready || s.id === player)) return ack({ ok: false, error: 'Everyone needs to be ready.' })
    room.game = newGame(room.seats.map((s) => ({ id: s.id, name: s.name })), (Math.random() * 2 ** 31) | 0, { knights: room.knights })
    ack({ ok: true })
    send(room)
  })

  // the host ends the game: everyone is back in the room, to play again
  socket.on('room:end', () => {
    const room = myRoom()
    if (!room || room.host !== player || !room.game) return
    clearTimeout(room.botTimer)
    room.botTimer = undefined
    room.game = null
    for (const s of room.seats) s.ready = !!s.bot
    send(room)
  })

  socket.on('game:action', (action, ack) => {
    const room = myRoom()
    if (!room?.game) return ack({ ok: false, error: 'No game.' })
    const p = room.game.players.findIndex((x) => x.id === player)
    if (p < 0) return ack({ ok: false, error: 'You are not playing.' })
    // (only the server ends a snatch, when its moment is up)
    if (action?.type === 'snatchEnd') return ack({ ok: false, error: 'Not yours to do.' })
    const res = apply(room.game, p, action)
    if (!res.ok) return ack(res)
    room.game = res.state
    ack({ ok: true })
    send(room)
    // a card being sneaked: the victim has a moment to catch it, then the thief gets away with it
    const sn = room.game.snatch
    if (action.type === 'snatch' && sn) {
      setTimeout(() => {
        if (!room.game || room.game.snatch?.id !== sn.id) return
        const end = apply(room.game, sn.thief, { type: 'snatchEnd' })
        if (end.ok) {
          room.game = end.state
          send(room)
        }
      }, SNATCH_MS)
    }
  })

  socket.on('disconnect', () => {
    sockets.get(player)?.delete(socket)
    if (sockets.get(player)?.size) return
    sockets.delete(player)
    const room = myRoom()
    const seat = room?.seats.find((s) => s.id === player)
    if (!room || !seat) return
    seat.connected = false
    send(room)
    // in the lobby a seat is freed if they don't come back soon; a game keeps it
    setTimeout(() => {
      if (sockets.has(player) || roomOf.get(player) !== room.code) return
      if (!room.game) leave(player)
      else if (!room.seats.some((s) => !s.bot && sockets.has(s.id))) room.emptySince = Date.now()
    }, 30_000)
  })
})

// games nobody has been in for an hour are dropped
setInterval(() => {
  for (const r of rooms.values()) {
    if (r.emptySince && Date.now() - r.emptySince > 60 * 60_000) {
      clearTimeout(r.botTimer)
      for (const s of r.seats) roomOf.delete(s.id)
      rooms.delete(r.code)
    }
  }
}, 5 * 60_000).unref()

const port = Number(process.env.PORT) || 3001
http.listen(port, '0.0.0.0', () => console.log(`Server listening on port ${port}`))
