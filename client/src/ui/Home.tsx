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
    <div className="menu">
      <div className="menu-col">
        <Title />

        <label className="menu-name">
          <span>Your name</span>
          <input ref={nameBox} value={name} maxLength={16} placeholder="Name" onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && named && code.length === 5 && void join()} />
        </label>

        <section className="menu-row">
          <h2>Game</h2>
          <div className="menu-acts">
            <span className="choices wide">
              <button className={knights ? 'on' : ''} onClick={() => (setKnights(true), localStorage.setItem('tp.knights', '1'))}>
                Knights and barbarians
              </button>
              <button className={!knights ? 'on' : ''} onClick={() => (setKnights(false), localStorage.setItem('tp.knights', '0'))}>
                Basic
              </button>
            </span>
          </div>
          <small>{knights ? 'Knights, barbarians, city upgrades · 13 points' : 'Classic · 10 points'}</small>
        </section>

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
            <span className="choices">
              {LEVELS.map((l) => (
                <button key={l} className={level === l ? 'on' : ''} onClick={() => (setLevel(l), localStorage.setItem('tp.level', l))}>
                  {LEVEL_NAME[l]}
                </button>
              ))}
            </span>
            <button
              className="go"
              onClick={() => {
                keep()
                startSolo(named, bots, knights, level)
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
                else room.knights(knights)
              }}
            >
              Create a room
            </button>
            <span className="or">or</span>
            <input value={code} maxLength={5} placeholder="CODE" className="code" onChange={(e) => setCode(e.target.value.toUpperCase())} />
            <button
              disabled={!connected || !named || code.length < 5}
              className={code.length === 5 ? 'go' : ''}
              onClick={join}
            >
              Join
            </button>
          </div>
          {!connected && !serverDown && <small>Connecting…</small>}
          {!connected && serverDown && <small>Server offline · solo only</small>}
        </section>
      </div>
      {msg && <div className="toast">{msg}</div>}
    </div>
  )
}
