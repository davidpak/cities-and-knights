import { useState } from 'react'
import type { RoomInfo } from '../../../shared/protocol.ts'
import { MAX_SEATS } from '../../../shared/protocol.ts'
import { GAME_NAME } from '../lib/palette.ts'
import { room, toast, useStore } from '../net.ts'

export function Lobby({ info, me }: { info: RoomInfo; me: string }) {
  const { toast: msg } = useStore()
  const host = info.host === me
  const seat = info.seats.find((s) => s.id === me)
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(seat?.name ?? '')
  const others = info.seats.filter((s) => s.id !== info.host)
  const allReady = others.every((s) => s.ready)
  const link = `${location.origin}${location.pathname}?room=${info.code}`

  return (
    <div className="home">
      <div className="plate home-card">
        <h1>{GAME_NAME}</h1>
        <div className="room-code">
          Room <b>{info.code}</b>
          <button className="mini" onClick={() => navigator.clipboard?.writeText(link).then(() => toast('Invite link copied'))}>
            Copy invite link
          </button>
        </div>
        <ul className="seats">
          {info.seats.map((s) => (
            <li key={s.id} className="seat">
              <span className="seat-name">
                {s.id === me && editing ? (
                  <input
                    autoFocus
                    value={name}
                    maxLength={16}
                    onChange={(e) => setName(e.target.value)}
                    onBlur={() => (room.rename(name), setEditing(false))}
                    onKeyDown={(e) => e.key === 'Enter' && (room.rename(name), setEditing(false))}
                  />
                ) : (
                  <>
                    {s.name}
                    {s.id === info.host && <span className="tag">host</span>}
                    {s.bot && <span className="tag">bot</span>}
                    {!s.connected && <span className="tag warn">away</span>}
                    {s.id === me && (
                      <button className="link" onClick={() => (setName(s.name), setEditing(true))}>
                        rename
                      </button>
                    )}
                  </>
                )}
              </span>
              <span className={`ready ${s.ready || s.id === info.host ? 'yes' : ''}`}>{s.id === info.host ? 'host' : s.ready ? 'ready' : 'not ready'}</span>
              {host && s.bot && (
                <button className="link" onClick={() => room.removeSeat(s.id)}>
                  remove
                </button>
              )}
            </li>
          ))}
          {Array.from({ length: MAX_SEATS - info.seats.length }, (_, i) => (
            <li key={`e${i}`} className="seat empty">
              <span>Empty seat</span>
            </li>
          ))}
        </ul>
        <div className="row">
          {!host && (
            <button className={seat?.ready ? '' : 'primary'} onClick={() => room.ready()}>
              {seat?.ready ? 'Not ready' : "I'm ready"}
            </button>
          )}
          {host && info.seats.length < MAX_SEATS && <button onClick={() => room.addBot()}>Add a bot</button>}
          {host && (
            <button
              className="primary"
              disabled={info.seats.length < 2 || !allReady}
              onClick={async () => {
                const r = await room.start()
                if (!r.ok) toast(r.error)
              }}
            >
              Start the game
            </button>
          )}
          <button className="link" onClick={() => room.leave()}>
            Leave
          </button>
        </div>
        {host && info.seats.length < 2 && <small>Share the code, or add a bot to play.</small>}
        {host && info.seats.length >= 2 && !allReady && <small>Waiting for everyone to be ready…</small>}
      </div>
      {msg && <div className="toast plate">{msg}</div>}
    </div>
  )
}
