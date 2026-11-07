/**
 * The real server, end to end: it starts its own (on a spare port, saving to a scratch folder), then two people and a
 * bot play through everything a room goes through:
 *  - create, join by code, add a bot, ready, start; a dropped connection comes back into its seat
 *  - a whole game to the end, then "again": everyone back in the room, and a second game starts
 *  - garbage sent to the server is turned away, and the server carries on
 *  - the server is stopped mid-game and started again: everyone is back in the same game, at the same move
 *  - one player leaves mid-game: they hear nothing more from that room, and a bot plays on in their seat to the end
 * Run: npx tsx shared/server.e2e.ts
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { io, type Socket } from 'socket.io-client'
import { botAction } from './bot.ts'
import type { View } from './engine.ts'
import type { Ack, ClientToServer, RoomInfo, ServerToClient } from './protocol.ts'

const PORT = 3000 + Math.floor(Math.random() * 900) + 100
const URL = `http://localhost:${PORT}`
const DATA = mkdtempSync(join(tmpdir(), 'tp-e2e-'))
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
const check = (ok: unknown, what: string) => {
  if (!ok) throw new Error('FAILED: ' + what)
  console.log('  ok  ' + what)
}

let server: ChildProcess
async function startServer() {
  server = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], { env: { ...process.env, PORT: String(PORT), DATA_DIR: DATA, BOT_PACE: '0.02' }, stdio: ['ignore', 'pipe', 'inherit'] })
  await new Promise<void>((res, rej) => {
    const t = setTimeout(() => rej(new Error('server did not start')), 30_000)
    server.stdout!.on('data', (d: Buffer) => /listening/.test(String(d)) && (clearTimeout(t), res()))
  })
}
async function stopServer() {
  const done = new Promise((r) => server.once('exit', r))
  server.kill('SIGTERM')
  await done
}

type C = { s: Socket<ServerToClient, ClientToServer>; view: View | null; room: RoomInfo | null; name: string; heard: number }
const mk = (id: string, name: string): C => {
  const c: C = { s: io(URL, { auth: { player: id }, transports: ['websocket'], reconnectionDelay: 200, reconnectionDelayMax: 500 }), view: null, room: null, name, heard: 0 }
  c.s.on('game', (v) => ((c.view = v), c.heard++))
  c.s.on('room', (r) => ((c.room = r), c.heard++, r === null && (c.view = null)))
  return c
}
const ask = (c: C, ev: string, ...args: unknown[]) => new Promise<Ack>((res) => (c.s.emit as (...a: unknown[]) => void)(ev, ...args, res))
async function until(f: () => unknown, what: string, ms = 10_000) {
  const t0 = Date.now()
  while (!f()) {
    if (Date.now() - t0 > ms) throw new Error('timed out: ' + what)
    await wait(20)
  }
}

/** the people move like bots until the game ends (or `stop` says so) */
async function play(cs: C[], stop: () => boolean = () => false) {
  const t0 = Date.now()
  let moves = 0
  while (Date.now() - t0 < 300_000) {
    const live = cs.filter((c) => c.view && c.room?.started)
    if (!live.length) return moves
    if (live[0].view!.phase.kind === 'over' || stop()) return moves
    let acted = false
    for (const c of live) {
      const cv = c.view!
      const act = botAction(cv, cv.you, Math.random)
      if (!act) continue
      const r = await ask(c, 'game:action', act)
      // (a move can be overtaken by a bot's, or a timer's: the next view sorts it out)
      if (r.ok) (acted = true), moves++
      for (let k = 0; k < 100 && c.view === cv; k++) await wait(5)
    }
    if (!acted) await wait(40)
  }
  throw new Error('game took too long')
}

await startServer()
console.log(`server on ${URL}, saving to ${DATA}`)
const a = mk('alice-' + Date.now(), 'Alice')
const b = mk('bobby-' + Date.now(), 'Bob')
await until(() => a.s.connected && b.s.connected, 'connect')

console.log('a room')
const made = await ask(a, 'room:create', 'Alice')
check(made.ok && made.code, 'created a room')
const code = (made as { code: string }).code
check((await ask(b, 'room:join', code.toLowerCase(), 'Bob')).ok, 'joined by code (any case)')
check(!(await ask(b, 'room:join', 'ZZZZZ', 'Bob')).ok, 'a wrong code is turned away')
a.s.emit('room:addBot', 'hard')
b.s.emit('room:ready')
await until(() => a.room?.seats.length === 3 && a.room.seats.every((s) => s.ready || s.id === a.room!.host), 'seats ready')
check(a.room!.seats.find((s) => s.bot)?.level === 'hard', 'the bot has the level asked for')
check((await ask(a, 'room:start')).ok, 'started')
await until(() => a.view && b.view, 'views')
const game1 = a.room!.game

console.log('a dropped connection')
b.s.disconnect()
b.view = null
await wait(200)
b.s.connect()
await until(() => b.view, 'view after reconnect')
check(b.view!.players[b.view!.you].name === 'Bob', 'Bob is back in his seat')

console.log('garbage')
for (const junk of [null, 42, 'x', {}, { type: 7 }, { type: 'buildRoad', edge: 99999 }, { type: 'nonsense' }]) {
  const r = await ask(a, 'game:action', junk)
  if (r.ok) throw new Error('junk accepted: ' + JSON.stringify(junk))
}
check(true, 'every bad move turned away')
check(((await (await fetch(URL + '/health')).json()) as { ok: boolean }).ok, 'the server is still up')

console.log('game 1')
const moves1 = await play([a, b])
check(a.view!.phase.kind === 'over', `game 1 ends (${moves1} moves by people)`)
check(b.view!.phase.kind === 'over', 'Bob sees it end too')
check(a.view!.players.find((p) => p.name === 'Bob')?.hand === null, "Alice can't see Bob's hand")

console.log('again')
check(!(await new Promise((r) => (b.s.emit('room:end'), setTimeout(() => r(b.room?.started === false), 400)))), 'only the host can call it')
a.s.emit('room:end')
await until(() => a.room && !a.room.started && b.room && !b.room.started, 'back in the room')
check(a.view === null || a.room!.started === false, 'the old table is gone')
check(a.room!.code === code && a.room!.seats.length === 3, 'same room, same seats')
b.s.emit('room:ready')
await until(() => a.room?.seats.every((s) => s.ready || s.id === a.room!.host), 'ready again')
check((await ask(a, 'room:start')).ok, 'game 2 starts')
await until(() => a.room!.game !== game1 && a.view && a.view.phase.kind === 'setup' && b.view, 'game 2 views')
check(a.room!.game > game1, 'a new game number')

console.log('a restart mid-game')
await play([a, b], () => (a.view?.turn ?? 0) >= 4)
const before = a.view!
await stopServer()
await until(() => !a.s.connected, 'clients notice')
await startServer()
await until(() => a.s.connected && b.s.connected, 'clients reconnect', 20_000)
await until(() => a.view && a.room?.started, 'game back after restart')
check(a.view!.turn === before.turn && JSON.stringify(a.view!.buildings) === JSON.stringify(before.buildings), `same game, same move (turn ${before.turn})`)
check(b.view!.players[b.view!.you].name === 'Bob', 'Bob too')

console.log('leaving mid-game')
await play([a, b], () => (a.view?.turn ?? 0) >= 8)
b.s.emit('room:leave')
await until(() => b.room === null, 'Bob is out')
const heard = b.heard
const moves2 = await play([a])
check(a.view!.phase.kind === 'over', `game 2 ends with a bot in Bob's seat (${moves2} more moves by Alice)`)
await wait(500)
check(b.heard === heard, 'Bob heard nothing more from that room')
check(a.room!.seats.some((s) => s.standIn), "a stand-in holds Bob's seat")
a.s.emit('room:end')
await until(() => a.room && !a.room.started, 'Alice back in the room')
check(a.room!.seats.length === 2 && !a.room!.seats.some((s) => s.standIn), 'the stand-in goes with the game')
check((await ask(b, 'room:join', code, 'Bob')).ok, 'Bob can come back for the next one')

a.s.close()
b.s.close()
await stopServer()
console.log('all good')
process.exit(0)
