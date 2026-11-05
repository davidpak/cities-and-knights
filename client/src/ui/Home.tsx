import { useState } from 'react'
import { GAME_NAME } from '../lib/palette.ts'
import { myName, rememberName, room, startSolo, toast, useStore } from '../net.ts'

export function Home() {
  const { connected, toast: msg } = useStore()
  const [name, setName] = useState(myName())
  const [code, setCode] = useState(() => new URLSearchParams(location.search).get('room') ?? '')
  const [bots, setBots] = useState(2)
  const named = name.trim()
  const keep = () => rememberName(named)

  return (
    <div className="home">
      <div className="plate home-card">
        <h1>{GAME_NAME}</h1>
        <p className="sub">Settle the island. Trade, build, and race to 10 points.</p>

        <label className="field">
          <span>Your name</span>
          <input value={name} maxLength={16} placeholder="Name" onChange={(e) => setName(e.target.value)} />
        </label>

        <div className="home-grid">
          <div className="home-box">
            <h3>Play with friends</h3>
            <button
              className="primary"
              disabled={!connected || !named}
              onClick={async () => {
                keep()
                const r = await room.create(named)
                if (!r.ok) toast(r.error)
              }}
            >
              Create a room
            </button>
            <div className="row">
              <input value={code} maxLength={5} placeholder="CODE" className="code" onChange={(e) => setCode(e.target.value.toUpperCase())} />
              <button
                disabled={!connected || !named || code.length < 5}
                onClick={async () => {
                  keep()
                  const r = await room.join(code, named)
                  if (!r.ok) toast(r.error)
                }}
              >
                Join
              </button>
            </div>
            {!connected && <small className="warn">Connecting to the server…</small>}
          </div>
          <div className="home-box">
            <h3>Play solo</h3>
            <div className="row">
              {[1, 2, 3].map((n) => (
                <button key={n} className={`mini-choice ${bots === n ? 'on' : ''}`} onClick={() => setBots(n)}>
                  {n} bot{n > 1 ? 's' : ''}
                </button>
              ))}
            </div>
            <button
              className="primary"
              onClick={() => {
                keep()
                startSolo(named, bots)
              }}
            >
              Start
            </button>
            <small>Runs in your browser, no server needed.</small>
          </div>
        </div>
      </div>
      {msg && <div className="toast plate">{msg}</div>}
    </div>
  )
}
