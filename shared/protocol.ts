/** What the server and clients say to each other over the socket. */
import type { Action, View } from './engine.ts'

export type Seat = { id: string; name: string; ready: boolean; bot: boolean; connected: boolean }
export type RoomInfo = { code: string; host: string; seats: Seat[]; started: boolean }
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
  'room:addBot': () => void
  'room:removeSeat': (id: string) => void
  'room:start': (ack: (a: Ack) => void) => void
  'game:action': (a: Action, ack: (a: Ack) => void) => void
}

export const MAX_SEATS = 4
export const NAME_MAX = 16
