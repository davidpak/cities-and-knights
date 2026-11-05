import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import './ui/styles.css'

// numbers and signs are painted with the game's font, so wait for it (briefly)
const fonts = Promise.race([
  Promise.all([document.fonts.load('700 100px Gaegu'), document.fonts.load('800 100px Nunito')]),
  new Promise((r) => setTimeout(r, 2500)),
])
fonts.finally(() =>
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  ),
)
