import { useState } from 'react'
import { myName, rememberName, room, startSolo, toast, useStore } from '../net.ts'
import { Title } from './Title.tsx'

export function Home() {
  const { connected, serverDown, toast: msg } = useStore()
  const [name, setName] = useState(myName())
  const [code, setCode] = useState(() => new URLSearchParams(location.search).get('room') ?? '')
  const [bots, setBots] = useState(2)
  const named = name.trim()
  const keep = () => rememberName(named)

  return (
    <div className="menu">
      <div className="menu-col">
        <Title />

        <label className="menu-name">
          <span>Your name</span>
          <input value={name} maxLength={16} placeholder="Name" onChange={(e) => setName(e.target.value)} />
        </label>

        <section className="menu-row">
          <h2>Solo</h2>
          <div className="menu-acts">
            <span className="choices">
              {[1, 2, 3].map((n) => (
                <button key={n} className={bots === n ? 'on' : ''} onClick={() => setBots(n)}>
                  {n}
                </button>
              ))}
              <span className="after">{bots > 1 ? 'bots' : 'bot'}</span>
            </span>
            <button
              className="go"
              onClick={() => {
                keep()
                startSolo(named, bots)
              }}
            >
              Start
            </button>
          </div>
        </section>

        <section className="menu-row">
          <h2>With friends</h2>
          <div className="menu-acts">
            <button
              disabled={!connected || !named}
              onClick={async () => {
                keep()
                const r = await room.create(named)
                if (!r.ok) toast(r.error)
              }}
            >
              Create a room
            </button>
            <span className="or">or</span>
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
          {!connected && !serverDown && <small>Connecting…</small>}
          {!connected && serverDown && <small>The server can't be reached. Solo still works.</small>}
        </section>
      </div>
      {msg && <div className="toast">{msg}</div>}
    </div>
  )
}
