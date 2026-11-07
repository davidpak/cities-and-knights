import { lazy, Suspense, useEffect } from 'react'
import { connect, playerId, useStore } from './net.ts'
import { Home } from './ui/Home.tsx'
import { Lobby } from './ui/Lobby.tsx'

/** pieces and the board on their own pages (?part=…), for building and checking them alone */
const Parts = lazy(() => import('./ui/Parts.tsx'))
/** the board (and three.js with it) loads only once a game starts, so the home screen opens instantly */
const Game = lazy(() => import('./ui/Game.tsx').then((m) => ({ default: m.Game })))
// start fetching it in the background straight away; the physics engine (the biggest part) a moment later
void import('./ui/Game.tsx')
setTimeout(() => void import('./three/physics.ts').then((m) => m.loadRapier()), 1200)

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
  if (!view) return <div className="menu"><div className="menu-col">Loading the table…</div></div>
  return (
    <Suspense fallback={<div className="menu">Loading the table…</div>}>
      <Game key={`${room.code}:${room.game}`} view={view} />
    </Suspense>
  )
}
