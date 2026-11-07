import { useState } from 'react'
import type { RoomInfo } from '../../../shared/protocol.ts'
import { MAX_SEATS } from '../../../shared/protocol.ts'
import { LEVELS, LEVEL_NAME, PERSONA_TAG } from '../../../shared/bot.ts'
import { room, toast, useStore } from '../net.ts'
import { Title } from './Title.tsx'

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
    <div className="menu">
      <div className="menu-col">
        <Title small />
        <div className="room-code">
          <span>Room</span> <b>{info.code}</b>
          <button className="link" onClick={() => navigator.clipboard?.writeText(link).then(() => toast('Link copied'))}>
            Copy link
          </button>
        </div>
        <div className="menu-acts">
          {host ? (
            <span className="choices wide">
              <button className={info.knights ? 'on' : ''} onClick={() => room.knights(true)}>
                Knights and barbarians
              </button>
              <button className={!info.knights ? 'on' : ''} onClick={() => room.knights(false)}>
                Basic
              </button>
            </span>
          ) : (
            <small>{info.knights ? 'Knights & barbarians · 13 points' : 'Classic · 10 points'}</small>
          )}
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
              {s.bot && s.persona && <span className="persona">{PERSONA_TAG[s.persona]}</span>}
              {s.bot &&
                (host ? (
                  <button className="level" title="Level" onClick={() => room.botLevel(s.id, LEVELS[(LEVELS.indexOf(s.level ?? 'normal') + 1) % LEVELS.length])}>
                    {LEVEL_NAME[s.level ?? 'normal']}
                  </button>
                ) : (
                  <span className="level">{LEVEL_NAME[s.level ?? 'normal']}</span>
                ))}
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
        <div className="menu-acts">
          {!host && (
            <button className={seat?.ready ? '' : 'go'} onClick={() => room.ready()}>
              {seat?.ready ? "Not ready" : "Ready"}
            </button>
          )}
          {host && info.seats.length < MAX_SEATS && <button onClick={() => room.addBot((LEVELS.find((l) => l === localStorage.getItem('tp.level')) ?? 'normal'))}>Add a bot</button>}
          {host && (
            <button
              className="go"
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
        {host && info.seats.length < 2 && <small>Share the code or add a bot</small>}
        {host && info.seats.length >= 2 && !allReady && <small>Waiting for players…</small>}
      </div>
      {msg && <div className="toast">{msg}</div>}
    </div>
  )
}
