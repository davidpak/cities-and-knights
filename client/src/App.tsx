import { lazy, Suspense, useEffect } from 'react'
import { connect, playerId, useStore } from './net.ts'
import { Game } from './ui/Game.tsx'
import { Home } from './ui/Home.tsx'
import { Lobby } from './ui/Lobby.tsx'

/** pieces and the board on their own pages (?part=…), for building and checking them alone */
const Parts = lazy(() => import('./ui/Parts.tsx'))

export default function App() {
  const part = new URLSearchParams(location.search).get('part')
  if (part)
    return (
      <Suspense fallback={null}>
        <Parts part={part} />
      </Suspense>
    )
  return <Play />
}

function Play() {
  const { room, view, solo } = useStore()
  useEffect(() => connect(), [])
  if (!room) return <Home />
  if (!room.started) return <Lobby info={room} me={solo ? 'you' : playerId} />
  if (!view) return <div className="home"><div className="plate home-card">Loading the table…</div></div>
  return <Game view={view} />
}
