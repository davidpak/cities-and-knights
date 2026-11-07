import { useEffect, useRef, useState } from 'react'
import { LEVELS, LEVEL_NAME, type Level } from '../../../shared/bot.ts'
import { myName, rememberName, room, startSolo, toast, useStore } from '../net.ts'
import { Title } from './Title.tsx'

export function Home() {
  const { connected, serverDown, toast: msg } = useStore()
  const [name, setName] = useState(myName())
  const [code, setCode] = useState(() => new URLSearchParams(location.search).get('room') ?? '')
  const [bots, setBots] = useState(2)
  const [level, setLevel] = useState<Level>(() => (LEVELS.find((l) => l === localStorage.getItem('tp.level')) ?? 'normal'))
  const [knights, setKnights] = useState(() => localStorage.getItem('tp.knights') !== '0')
  const named = name.trim()
  const keep = () => rememberName(named)
  const join = async () => {
    keep()
    const r = await room.join(code, named)
    if (!r.ok) toast(r.error)
  }
  // a room link: straight in, once connected (a name first, if there isn't one yet)
  const linked = useRef(!!code)
  const nameBox = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (!linked.current || !connected || code.length < 5) return
    if (!named) return nameBox.current?.focus()
    linked.current = false
    void join()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected])

  return (
    <div className="menu home">
      <div className="home-grid">
        <div className="home-side">
          <Title />

          <label className="field">
            <span className="label">Your name</span>
            <input ref={nameBox} value={name} maxLength={16} placeholder="Name" onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && named && code.length === 5 && void join()} />
          </label>

          <div className="field">
            <span className="label">Game</span>
            <div className="modes">
              {(
                [
                  [true, 'Knights & barbarians', '13 points'],
                  [false, 'Basic', '10 points'],
                ] as const
              ).map(([on, title, sub]) => (
                <button key={title} className={`mode ${knights === on ? 'on' : ''}`} onClick={() => (setKnights(on), localStorage.setItem('tp.knights', on ? '1' : '0'))}>
                  <b>{title}</b>
                  <small>{sub}</small>
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="home-panels">
          <section className="home-panel">
            <h2>Solo</h2>
            <div className="field">
              <span className="label">Bots</span>
              <div className="seg">
                {[1, 2, 3].map((n) => (
                  <button key={n} className={bots === n ? 'on' : ''} onClick={() => setBots(n)}>
                    {n}
                  </button>
                ))}
              </div>
            </div>
            <div className="field">
              <span className="label">Level</span>
              <div className="seg">
                {LEVELS.map((l) => (
                  <button key={l} className={level === l ? 'on' : ''} onClick={() => (setLevel(l), localStorage.setItem('tp.level', l))}>
                    {LEVEL_NAME[l]}
                  </button>
                ))}
              </div>
            </div>
            <button
              className="go wide"
              onClick={() => {
                keep()
                startSolo(named, bots, knights, level)
              }}
            >
              Start
            </button>
          </section>

          <section className="home-panel">
            <h2>With friends</h2>
            <button
              className="wide"
              disabled={!connected || !named}
              onClick={async () => {
                keep()
                const r = await room.create(named)
                if (!r.ok) toast(r.error)
                else room.knights(knights)
              }}
            >
              Create a room
            </button>
            <div className="or-line">
              <span>or</span>
            </div>
            <div className="join-row">
              <input value={code} maxLength={5} placeholder="CODE" className="code" onChange={(e) => setCode(e.target.value.toUpperCase())} />
              <button disabled={!connected || !named || code.length < 5} className={code.length === 5 ? 'go' : ''} onClick={join}>
                Join
              </button>
            </div>
            {!connected && <small className="note">{serverDown ? 'Offline · solo only' : 'Connecting…'}</small>}
          </section>
        </div>
      </div>
      {msg && <div className="toast">{msg}</div>}
    </div>
  )
}
