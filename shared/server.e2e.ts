// Two people and a bot play a whole game through the real server. Run: npx tsx shared/server.e2e.ts (server on :3001)
import { io, type Socket } from 'socket.io-client'
import { botAction } from './bot.ts'
import type { View } from './engine.ts'
import type { Ack, ClientToServer, RoomInfo, ServerToClient } from './protocol.ts'

const URL = process.env.URL ?? 'http://localhost:3001'
type C = { s: Socket<ServerToClient, ClientToServer>; view: View | null; room: RoomInfo | null; name: string }
const mk = (id: string, name: string): C => {
  const c: C = { s: io(URL, { auth: { player: id }, transports: ['websocket'] }), view: null, room: null, name }
  c.s.on('game', (v) => (c.view = v))
  c.s.on('room', (r) => (c.room = r))
  return c
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
const ack = <T extends unknown[]>(f: (...a: [...T, (a: Ack) => void]) => void, ...args: T) => new Promise<Ack>((res) => f(...args, res))

const a = mk('alice-' + Date.now(), 'Alice')
const b = mk('bob-' + Date.now(), 'Bob')
await wait(300)
const made = await ack(a.s.emit.bind(a.s, 'room:create') as never, 'Alice')
if (!made.ok || !made.code) throw new Error('create failed')
console.log('room', made.code)
const joined = await ack(b.s.emit.bind(b.s, 'room:join') as never, made.code, 'Bob')
if (!joined.ok) throw new Error('join failed')
a.s.emit('room:addBot')
b.s.emit('room:ready')
await wait(300)
console.log('seats', a.room?.seats.map((s) => s.name))
const started = await ack(a.s.emit.bind(a.s, 'room:start') as never)
if (!started.ok) throw new Error('start failed ' + JSON.stringify(started))
await wait(300)

// Bob drops and comes back halfway through setup
let reconnected = false
const t0 = Date.now()
let moves = 0
while (Date.now() - t0 < 240_000) {
  const v = a.view
  if (!v) { await wait(50); continue }
  if (v.phase.kind === 'over') break
  let acted = false
  for (const c of [a, b]) {
    const cv = c.view
    if (!cv) continue
    const act = botAction(cv, cv.you, Math.random)
    if (!act) continue
    const r = await ack(c.s.emit.bind(c.s, 'game:action') as never, act)
    if (!r.ok) throw new Error(`${c.name} ${act.type}: ${r.error}`)
    acted = true
    moves++
    // (the answer comes before the new view: wait for it, so the next move isn't made on the old one)
    for (let k = 0; k < 100 && c.view === cv; k++) await wait(5)
  }
  if (!reconnected && moves === 3) {
    b.s.disconnect(); b.view = null
    await wait(200)
    b.s.connect()
    await wait(300)
    if (!b.view) throw new Error('no view after reconnect')
    console.log('bob reconnected into his seat:', (b.view as View).players[(b.view as View).you].name)
    reconnected = true
  }
  if (!acted) await wait(60) // the bot's turn
}
const v = a.view!
if (v.phase.kind !== 'over') throw new Error('game did not finish: ' + v.phase.kind)
console.log('winner', v.players[v.phase.winner].name, 'after', moves, 'human moves; points', v.players.map((p) => `${p.name}:${p.points}`).join(' '))
console.log('alice sees bob hand?', v.players.find((p) => p.name === 'Bob')?.hand === null ? 'no (good)' : 'YES (bad)')
a.s.close(); b.s.close()
process.exit(0)
