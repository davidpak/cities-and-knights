/**
 * The game server: rooms, the lobby, and the one real copy of each game.
 *
 * Players are known by an id their browser keeps (not by their socket), so a refresh or a dropped connection puts
 * them straight back in their seat. Every move goes through the shared rules engine; each player is then sent their
 * own view of the game (other hands as counts). Bots fill empty seats and move on a short delay, so people can see
 * what they did.
 *
 * Solid by design:
 *  - Updates go only to people still in the room. Leaving a game hands the seat to a bot under a new id, so the one
 *    who left is never pulled back to the table.
 *  - Each game in a room has its own number; a timer from an old game (an offer running out, a bot about to move, a
 *    card being sneaked) does nothing to the next one.
 *  - Rooms are saved to disk as they change and loaded on start, so a restart or a redeploy loses nothing: people
 *    reconnect into their seats. (DATA_DIR sets where; on a host, point it at a persistent volume.)
 *  - A bad message, or a bug in a handler, is caught and logged; it never takes the server down.
 *  - Seats of people who are gone are swept: in a lobby after a minute, a game nobody's at after an hour.
 */
import express from 'express'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Server, type Socket } from 'socket.io'
import { BOT_CAST, LEVELS, botAction, brain, type Brain, type Level } from '../shared/bot.ts'
import { OFFER_MS, apply, newGame, viewFor, type Action, type GameState } from '../shared/engine.ts'
import { MAX_SEATS, NAME_MAX, type Ack, type ClientToServer, type RoomInfo, type Seat, type ServerToClient } from '../shared/protocol.ts'

type Room = {
  code: string
  host: string
  seats: Seat[]
  game: GameState | null
  knights: boolean
  /** which game this is in the room (1, 2, …): timers from an earlier one check it and stand down */
  gen: number
  brains: Record<string, Brain>
  emptySince?: number
  botTimer?: NodeJS.Timeout
}
type Sock = Socket<ClientToServer, ServerToClient, Record<string, never>, { player: string }>

const rooms = new Map<string, Room>()
const roomOf = new Map<string, string>() // player id -> room code
const sockets = new Map<string, Set<Sock>>() // player id -> its open sockets
const goneSince = new Map<string, number>() // player id -> when their last socket closed

/** how long a victim has to catch a card being sneaked away */
const SNATCH_MS = 2000
/** a bot's own offer waits less: it has a turn to get on with */
const BOT_OFFER_MS = 10_000
/** bots' pace (1: as people see it; tests run them faster) */
const BOT_PACE = Number(process.env.BOT_PACE) || 1
/** a lobby seat whose player has been gone this long is freed */
const LOBBY_GONE_MS = 60_000
/** a game nobody has been at for this long is dropped (a finished one sooner) */
const GAME_GONE_MS = 60 * 60_000
const OVER_GONE_MS = 10 * 60_000

const here = dirname(fileURLToPath(import.meta.url))
const DATA = process.env.DATA_DIR ?? join(here, 'data')
const SAVE = join(DATA, 'rooms.json')

const log = (...a: unknown[]) => console.log(new Date().toISOString(), ...a)

// ---------------------------------------------------------------- http: the built client, and a health check

const app = express()
const http = createServer(app)
const io = new Server<ClientToServer, ServerToClient>(http, { cors: { origin: '*' }, pingInterval: 20_000, pingTimeout: 25_000 })

// ---------------------------------------------------------------- the lab: where training reports its progress
// GET /api/lab: the status (phases, and once training runs, each generation). POST /api/lab with
// "Authorization: Bearer <LAB_TOKEN>" replaces it: the trainer does this after each generation.
const LAB_FILE = () => join(DATA, 'lab.json')
const LAB_START = join(here, 'lab-start.json')
app.get('/api/lab', (_req, res) => {
  res.setHeader('Cache-Control', 'no-cache')
  const file = existsSync(LAB_FILE()) ? LAB_FILE() : LAB_START
  try {
    res.type('json').send(readFileSync(file, 'utf8'))
  } catch {
    res.status(500).json({ error: 'no lab status' })
  }
})
app.post('/api/lab', express.json({ limit: '4mb' }), (req, res) => {
  const token = process.env.LAB_TOKEN
  if (!token || req.headers.authorization !== `Bearer ${token}`) return void res.status(401).json({ error: 'not allowed' })
  try {
    mkdirSync(DATA, { recursive: true })
    writeFileSync(LAB_FILE() + '.tmp', JSON.stringify({ ...req.body, updated: new Date().toISOString() }))
    renameSync(LAB_FILE() + '.tmp', LAB_FILE())
    res.json({ ok: true })
  } catch (e) {
    log('lab write failed', e)
    res.status(500).json({ error: 'could not save' })
  }
})

app.get('/health', (_req, res) =>
  void res.json({ ok: true, rooms: rooms.size, games: [...rooms.values()].filter((r) => r.game).length, online: sockets.size }),
)

const dist = join(here, '..', 'client', 'dist')
if (existsSync(dist)) {
  // hashed files never change (cache them for good); the page itself is always checked, so a new deploy shows at once
  app.use(
    express.static(dist, {
      setHeaders: (res, path) => res.setHeader('Cache-Control', /[\\/]assets[\\/]/.test(path) ? 'public, max-age=31536000, immutable' : 'no-cache'),
    }),
  )
  app.get(/^\/(?!socket\.io).*/, (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache')
    res.sendFile(join(dist, 'index.html'))
  })
} else app.get('/', (_req, res) => void res.send('Server is running.'))

// ---------------------------------------------------------------- saving and loading

let saveTimer: NodeJS.Timeout | undefined
function save() {
  if (saveTimer) return
  saveTimer = setTimeout(saveNow, 500)
}
function saveNow() {
  clearTimeout(saveTimer)
  saveTimer = undefined
  try {
    mkdirSync(DATA, { recursive: true })
    const data = { rooms: [...rooms.values()].map(({ botTimer: _t, ...r }) => r), roomOf: [...roomOf] }
    // (written aside, then swapped in: a crash mid-write never leaves half a file)
    writeFileSync(SAVE + '.tmp', JSON.stringify(data))
    renameSync(SAVE + '.tmp', SAVE)
  } catch (e) {
    log('save failed', e)
  }
}
function load() {
  if (!existsSync(SAVE)) return
  try {
    const data = JSON.parse(readFileSync(SAVE, 'utf8')) as { rooms: Room[]; roomOf: [string, string][] }
    const now = Date.now()
    for (const r of data.rooms) {
      r.brains ??= {}
      r.gen ??= 1
      for (const s of r.seats) if (!s.bot) (s.connected = false), goneSince.set(s.id, now)
      rooms.set(r.code, r)
    }
    for (const [p, c] of data.roomOf) if (rooms.has(c)) roomOf.set(p, c)
    // pick up where things were: offers get their time back, a sneak in progress gets away, bots move on
    for (const r of rooms.values()) {
      if (!r.game) continue
      if (r.game.snatch) settle(r, r.game.snatch.thief, { type: 'snatchEnd' })
      armOffers(r)
      scheduleBots(r)
    }
    log(`loaded ${rooms.size} rooms`)
  } catch (e) {
    log('load failed (starting empty)', e)
  }
}

// ---------------------------------------------------------------- rooms

const cleanName = (n: unknown) => (typeof n === 'string' ? n.replace(/\s+/g, ' ').trim().slice(0, NAME_MAX) : '') || 'Player'
const newCode = () => {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
  for (;;) {
    const c = Array.from({ length: 5 }, () => A[Math.floor(Math.random() * A.length)]).join('')
    if (!rooms.has(c)) return c
  }
}
const here_ = (r: Room, id: string) => roomOf.get(id) === r.code
const people = (r: Room) => r.seats.filter((s) => !s.bot && here_(r, s.id))

function info(r: Room): RoomInfo {
  return { code: r.code, host: r.host, seats: r.seats, started: r.game !== null, knights: r.knights, game: r.gen }
}

/** everyone still in the room gets the room, and their own view of the game */
function send(r: Room) {
  for (const seat of r.seats) {
    if (seat.bot || !here_(r, seat.id)) continue
    const view = r.game ? viewFor(r.game, r.game.players.findIndex((p) => p.id === seat.id)) : null
    for (const s of sockets.get(seat.id) ?? []) {
      s.emit('room', info(r))
      if (view) s.emit('game', view)
    }
  }
  armOffers(r)
  scheduleBots(r)
  save()
}

/** a move, by anyone (a person, a bot, the server's own timers); the room hears of it */
function settle(r: Room, p: number, a: Action): { ok: true } | { ok: false; error: string } {
  if (!r.game) return { ok: false, error: 'No game.' }
  let res
  try {
    res = apply(r.game, p, a)
  } catch (e) {
    log(`room ${r.code}: ${JSON.stringify(a)} by ${p} threw`, e)
    return { ok: false, error: 'That move failed.' }
  }
  if (!res.ok) return res
  r.game = res.state
  send(r)
  if (a.type === 'snatch') armSnatch(r)
  return { ok: true }
}

/** a timer for this game only: if the room has moved on to another game (or none), it does nothing */
function later(r: Room, ms: number, f: () => void) {
  const gen = r.gen
  return setTimeout(() => {
    if (rooms.get(r.code) !== r || r.gen !== gen || !r.game) return
    try {
      f()
    } catch (e) {
      log(`room ${r.code}: timer failed`, e)
    }
  }, ms)
}

/** a new offer gets its time: when that runs out (and it's still open), it closes */
const armed = new Set<string>()
function armOffers(r: Room) {
  for (const o of r.game?.offers ?? []) {
    const key = `${r.code}:${r.gen}:${o.id}`
    if (armed.has(key)) continue
    armed.add(key)
    const bot = r.seats.find((x) => x.id === r.game!.players[o.from].id)?.bot
    o.expires ??= Date.now() + (bot ? BOT_OFFER_MS : OFFER_MS)
    later(r, Math.max(500, o.expires - Date.now()), () => {
      armed.delete(key)
      if (r.game!.offers.some((x) => x.id === o.id)) settle(r, o.from, { type: 'cancelOffer', id: o.id })
    })
  }
}

/** a card being sneaked: the victim has a moment to catch it, then the thief gets away with it */
function armSnatch(r: Room) {
  const sn = r.game?.snatch
  if (sn) later(r, SNATCH_MS, () => r.game!.snatch?.id === sn.id && settle(r, sn.thief, { type: 'snatchEnd' }))
}

/** each bot's mind for this game: its level, its persona, and what it remembers */
function brainOf(r: Room, seat: Seat): Brain {
  const b = (r.brains[seat.id] ??= brain(seat.level ?? 'normal', seat.persona ?? 'steady'))
  b.people = r.game ? r.game.players.map((pl, i) => (r.seats.find((x) => x.id === pl.id)?.bot ? -1 : i)).filter((i) => i >= 0) : []
  return b
}

function botMove(r: Room): { i: number; a: Action } | null {
  const g = r.game!
  for (let i = 0; i < g.players.length; i++) {
    const seat = r.seats.find((s) => s.id === g.players[i].id)
    if (!seat?.bot) continue
    try {
      const a = botAction(viewFor(g, i), i, Math.random, brainOf(r, seat))
      if (a) return { i, a }
    } catch (e) {
      log(`room ${r.code}: bot ${seat.name} failed`, e)
    }
  }
  return null
}

function scheduleBots(r: Room) {
  if (!r.game || r.botTimer || r.game.phase.kind === 'over') return
  // a discard or an answer to an offer can be anyone's; otherwise only the current player moves
  if (!botMove(r)) return
  const ph = r.game.phase.kind
  r.botTimer = later(r, (ph === 'setup' ? 500 : ph === 'steal' ? 2500 : 750) * BOT_PACE, () => {
    r.botTimer = undefined
    const m = botMove(r)
    if (!m) return
    const res = settle(r, m.i, m.a)
    if (!res.ok) {
      log(`room ${r.code}: bot ${r.game!.players[m.i].name} tried ${m.a.type}: ${res.error}`)
      // (don't spin on a move that won't go: try again in a moment)
      r.botTimer = later(r, 2000, () => ((r.botTimer = undefined), scheduleBots(r)))
    }
  })
}

const forget = (r: Room) => {
  for (const k of armed) if (k.startsWith(`${r.code}:`)) armed.delete(k)
}

function dropRoom(r: Room) {
  clearTimeout(r.botTimer)
  forget(r)
  for (const [p, c] of roomOf) if (c === r.code) roomOf.delete(p)
  rooms.delete(r.code)
  save()
}

/** a player leaves their room for good */
function leave(player: string) {
  const code = roomOf.get(player)
  roomOf.delete(player)
  for (const s of sockets.get(player) ?? []) {
    s.emit('room', null)
    s.emit('game', null)
  }
  const r = code ? rooms.get(code) : undefined
  if (!r) return
  const seat = r.seats.find((s) => s.id === player)
  if (seat && r.game && r.game.phase.kind !== 'over') {
    // mid-game: a bot takes the seat (under its own id), so the game goes on and the one who left is left alone
    const id = `bot-${Math.random().toString(36).slice(2, 10)}`
    const gp = r.game.players.find((p) => p.id === player)
    if (gp) gp.id = id
    Object.assign(seat, { id, bot: true, connected: true, ready: true, level: 'normal', persona: 'steady', standIn: true })
  } else r.seats = r.seats.filter((s) => s.id !== player)
  if (r.host === player) r.host = people(r)[0]?.id ?? r.host
  if (!people(r).length) return dropRoom(r)
  send(r)
}

/** back to the room after a game: the same people, ready to go again (stand-in bots go) */
function toLobby(r: Room) {
  clearTimeout(r.botTimer)
  r.botTimer = undefined
  r.game = null
  forget(r)
  r.gen++
  r.brains = {}
  r.seats = r.seats.filter((s) => !s.standIn)
  for (const s of r.seats) s.ready = !!s.bot
  send(r)
}

// ---------------------------------------------------------------- the sockets

io.on('connection', (raw) => {
  const socket = raw as Sock
  const auth = socket.handshake.auth?.player
  const player = typeof auth === 'string' && auth.length >= 8 ? auth.slice(0, 64) : socket.id
  socket.data.player = player
  if (!sockets.has(player)) sockets.set(player, new Set())
  sockets.get(player)!.add(socket)
  goneSince.delete(player)

  const myRoom = () => {
    const c = roomOf.get(player)
    return c ? rooms.get(c) : undefined
  }

  // back in your seat after a refresh, a dropped connection, or a server restart
  const r = myRoom()
  if (r) {
    const seat = r.seats.find((s) => s.id === player)
    if (seat) seat.connected = true
    r.emptySince = undefined
    send(r)
  } else {
    roomOf.delete(player)
    socket.emit('room', null)
    socket.emit('game', null)
  }

  /** a handler that can't take the server down: anything thrown is logged (and answered, when it wants an answer) */
  function on<E extends keyof ClientToServer>(event: E, f: ClientToServer[E]) {
    socket.on(event, ((...args: unknown[]) => {
      try {
        ;(f as (...a: unknown[]) => void)(...args)
      } catch (e) {
        log(`${event} from ${player} failed`, e)
        const ack = args[args.length - 1]
        if (typeof ack === 'function') (ack as (a: Ack) => void)({ ok: false, error: 'Something went wrong.' })
      }
    }) as never)
  }
  /** answers only once, and only to a real callback */
  const reply = (ack: unknown, a: Ack) => typeof ack === 'function' && (ack as (a: Ack) => void)(a)

  on('room:create', (name, ack) => {
    if (myRoom()) leave(player)
    const code = newCode()
    const room: Room = { code, host: player, seats: [{ id: player, name: cleanName(name), ready: false, bot: false, connected: true }], game: null, knights: true, gen: 1, brains: {} }
    rooms.set(code, room)
    roomOf.set(player, code)
    reply(ack, { ok: true, code })
    send(room)
  })

  on('room:join', (rawCode, name, ack) => {
    const code = String(rawCode ?? '').trim().toUpperCase()
    const room = rooms.get(code)
    if (!room) return reply(ack, { ok: false, error: 'No room with that code.' })
    if (room.seats.some((s) => s.id === player)) {
      roomOf.set(player, code)
      reply(ack, { ok: true, code })
      return send(room)
    }
    if (room.game) return reply(ack, { ok: false, error: 'That game has already started.' })
    if (room.seats.length >= MAX_SEATS) return reply(ack, { ok: false, error: 'That room is full.' })
    if (myRoom()) leave(player)
    room.seats.push({ id: player, name: cleanName(name), ready: false, bot: false, connected: true })
    roomOf.set(player, code)
    reply(ack, { ok: true, code })
    send(room)
  })

  on('room:leave', () => leave(player))

  on('room:rename', (name) => {
    const room = myRoom()
    const seat = room?.seats.find((s) => s.id === player)
    if (!room || !seat || room.game) return
    seat.name = cleanName(name)
    send(room)
  })

  on('room:ready', () => {
    const room = myRoom()
    const seat = room?.seats.find((s) => s.id === player)
    if (!room || !seat || room.game) return
    seat.ready = !seat.ready
    send(room)
  })

  on('room:addBot', (level) => {
    const room = myRoom()
    if (!room || room.host !== player || room.game || room.seats.length >= MAX_SEATS) return
    const used = new Set(room.seats.map((s) => s.name))
    const free = BOT_CAST.filter((c) => !used.has(c.name))
    const cast = free.length ? free[Math.floor(Math.random() * free.length)] : { name: 'Bot', persona: 'steady' as const }
    const lv: Level = LEVELS.includes(level as Level) ? (level as Level) : 'normal'
    room.seats.push({ id: `bot-${Math.random().toString(36).slice(2, 10)}`, name: cast.name, ready: true, bot: true, connected: true, level: lv, persona: cast.persona })
    send(room)
  })

  on('room:botLevel', (id, level) => {
    const room = myRoom()
    const seat = room?.seats.find((s) => s.id === id && s.bot)
    if (!room || !seat || room.host !== player || room.game || !LEVELS.includes(level)) return
    seat.level = level
    send(room)
  })

  on('room:removeSeat', (id) => {
    const room = myRoom()
    if (!room || room.host !== player || room.game || id === player) return
    room.seats = room.seats.filter((s) => s.id !== id || !s.bot)
    send(room)
  })

  on('room:knights', (knights) => {
    const room = myRoom()
    if (!room || room.host !== player || room.game) return
    room.knights = !!knights
    send(room)
  })

  on('room:start', (ack) => {
    const room = myRoom()
    if (!room) return reply(ack, { ok: false, error: 'You are not in a room.' })
    if (room.host !== player) return reply(ack, { ok: false, error: 'Only the host can start.' })
    if (room.game) return reply(ack, { ok: false, error: 'Already started.' })
    if (room.seats.length < 2) return reply(ack, { ok: false, error: 'You need at least 2 players (add a bot?).' })
    if (!room.seats.every((s) => s.ready || s.id === player)) return reply(ack, { ok: false, error: 'Everyone needs to be ready.' })
    room.gen++
    room.brains = {}
    room.game = newGame(room.seats.map((s) => ({ id: s.id, name: s.name })), (Math.random() * 2 ** 31) | 0, { knights: room.knights })
    log(`room ${room.code}: game ${room.gen} starts (${room.seats.map((s) => (s.bot ? `${s.name}[${s.level}]` : s.name)).join(', ')})`)
    reply(ack, { ok: true })
    send(room)
  })

  // the host ends the game (or, once it's over, takes everyone back to the room to play again)
  on('room:end', () => {
    const room = myRoom()
    if (!room || room.host !== player || !room.game) return
    toLobby(room)
  })

  on('game:action', (action, ack) => {
    const room = myRoom()
    if (!room?.game) return reply(ack, { ok: false, error: 'No game.' })
    if (!action || typeof action !== 'object' || typeof (action as { type?: unknown }).type !== 'string') return reply(ack, { ok: false, error: 'Bad move.' })
    const p = room.game.players.findIndex((x) => x.id === player)
    if (p < 0) return reply(ack, { ok: false, error: 'You are not playing.' })
    // (only the server ends a snatch, when its moment is up)
    if (action.type === 'snatchEnd') return reply(ack, { ok: false, error: 'Not yours to do.' })
    reply(ack, settle(room, p, action))
  })

  socket.on('disconnect', () => {
    sockets.get(player)?.delete(socket)
    if (sockets.get(player)?.size) return
    sockets.delete(player)
    goneSince.set(player, Date.now())
    const room = myRoom()
    const seat = room?.seats.find((s) => s.id === player)
    if (!room || !seat) return
    seat.connected = false
    send(room)
  })
})

// ---------------------------------------------------------------- sweeping up

setInterval(() => {
  const now = Date.now()
  for (const r of [...rooms.values()]) {
    // a lobby seat whose player is gone a while is freed (the host passes on)
    if (!r.game) for (const s of r.seats) if (!s.bot && !sockets.has(s.id) && now - (goneSince.get(s.id) ?? now) > LOBBY_GONE_MS) leave(s.id)
    if (!rooms.has(r.code)) continue
    // a game with nobody at it
    if (r.game && !r.seats.some((s) => !s.bot && sockets.has(s.id))) {
      r.emptySince ??= now
      if (now - r.emptySince > (r.game.phase.kind === 'over' ? OVER_GONE_MS : GAME_GONE_MS)) {
        log(`room ${r.code}: dropped (empty)`)
        dropRoom(r)
      }
    } else r.emptySince = undefined
  }
  for (const [p, t] of goneSince) if (now - t > 2 * GAME_GONE_MS && !roomOf.has(p)) goneSince.delete(p)
}, 15_000).unref()

// ---------------------------------------------------------------- start, and stop cleanly

process.on('uncaughtException', (e) => log('uncaught', e))
process.on('unhandledRejection', (e) => log('unhandled', e))
for (const sig of ['SIGTERM', 'SIGINT'] as const)
  process.on(sig, () => {
    log(`${sig}: saving and stopping`)
    saveNow()
    io.close()
    process.exit(0)
  })

load()
const port = Number(process.env.PORT) || 3001
http.listen(port, '0.0.0.0', () => log(`Server listening on port ${port} (saves to ${SAVE})`))
