/** What the server and clients say to each other over the socket. */
import type { Action, View } from './engine.ts'
import type { Level, Persona } from './bot.ts'

/** a bot's seat also says how well it plays (level) and how (persona) */
export type Seat = { id: string; name: string; ready: boolean; bot: boolean; connected: boolean; level?: Level; persona?: Persona; /** a bot holding the seat of someone who left mid-game */ standIn?: boolean }
/** knights: play with the expansion (knights, barbarians, commodities, city improvements, progress cards) */
/** game: which game this is in the room (a new number each time one starts) */
export type RoomInfo = { code: string; host: string; seats: Seat[]; started: boolean; knights: boolean; game: number }
export type Ack = { ok: true; code?: string } | { ok: false; error: string }

export interface ServerToClient {
  room: (r: RoomInfo | null) => void
  game: (v: View | null) => void
}

export interface ClientToServer {
  'room:create': (name: string, ack: (a: Ack) => void) => void
  'room:join': (code: string, name: string, ack: (a: Ack) => void) => void
  'room:leave': () => void
  'room:rename': (name: string) => void
  'room:ready': () => void
  'room:addBot': (level?: Level) => void
  /** the host changes a bot's level */
  'room:botLevel': (id: string, level: Level) => void
  'room:removeSeat': (id: string) => void
  'room:start': (ack: (a: Ack) => void) => void
  'room:end': () => void
  'room:knights': (on: boolean) => void
  'game:action': (a: Action, ack: (a: Ack) => void) => void
}

export const MAX_SEATS = 4
export const NAME_MAX = 16
