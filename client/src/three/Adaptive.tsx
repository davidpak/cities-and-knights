/**
 * Keeps the table at the display's frame rate on whatever it runs on.
 *
 * It watches the time between frames while things move (the table draws nothing when nothing moves, so there's
 * nothing to watch otherwise). If frames run long, it draws fewer pixels: the resolution steps down a fifth at a
 * time, to one pixel per CSS pixel at the least (any lower is blurry), and if that's still not enough the shadow
 * map halves.
 * Long smooth stretches let it step back up, one step, and never again to a step it already had to leave.
 * What a device managed is remembered for next time (quality.ts), so a weak machine starts where it can keep up.
 *
 * Steps happen at most every second and a half: a change of resolution re-makes the drawing surface, and doing
 * that often would itself be a stutter.
 */
import { useFrame, useThree } from '@react-three/fiber'
import { useRef } from 'react'
import type { DirectionalLight } from 'three'
import { QUALITY, rememberDpr } from './quality.ts'

const SLOW = 20 // ms between frames: dropping frames on a 60 Hz display
const SMOOTH = 17.6 // keeping up
const WINDOW = 30 // frames per judgement

export function Adaptive() {
  const { gl, scene, invalidate } = useThree()
  const setDpr = useThree((s) => s.setDpr)
  const st = useRef({ last: 0, n: 0, sum: 0, good: 0, at: 0, dpr: QUALITY.startDpr, shadow: QUALITY.shadowSize, ceiling: QUALITY.maxDpr, before: 0, from: 0, locked: false })

  useFrame(() => {
    const s = st.current
    if (!QUALITY.adapt || s.locked) return
    const now = performance.now()
    const dt = now - s.last
    s.last = now
    // a pause: this frame starts a new run of motion
    if (dt > 120) {
      s.n = 0
      s.sum = 0
      return
    }
    s.n++
    s.sum += dt
    if (s.n < WINDOW) return
    const avg = s.sum / s.n
    s.n = 0
    s.sum = 0
    if (now - s.at < 1500) return
    // the last step down didn't help (the display or the browser is what's slow, not the drawing): undo it, and
    // leave the resolution alone from now on
    if (s.before && s.dpr < s.from) {
      const helped = avg < s.before * 0.88
      s.before = 0
      if (!helped) {
        s.dpr = s.from
        setDpr(s.dpr)
        rememberDpr(s.dpr)
        s.locked = true
        return
      }
    }
    s.before = 0
    if (avg > SLOW) {
      s.good = 0
      if (s.dpr > QUALITY.minDpr + 0.01) {
        s.ceiling = s.dpr - 0.01
        s.before = avg
        s.from = s.dpr
        s.dpr = Math.max(QUALITY.minDpr, Math.round(s.dpr * 0.8 * 100) / 100)
        setDpr(s.dpr)
        rememberDpr(s.dpr)
      } else if (s.shadow > 512) {
        s.shadow /= 2
        scene.traverse((o) => {
          const l = o as DirectionalLight
          if (!l.isDirectionalLight || !l.castShadow) return
          l.shadow.mapSize.set(s.shadow, s.shadow)
          l.shadow.map?.dispose()
          l.shadow.map = null
        })
        gl.shadowMap.needsUpdate = true
      } else return
      s.at = now
      invalidate()
    } else if (avg < SMOOTH && ++s.good >= 10 && s.dpr < s.ceiling) {
      // ten smooth judgements in a row (about five seconds of motion): try a step up
      s.good = 0
      s.dpr = Math.min(s.ceiling, QUALITY.maxDpr, Math.round(s.dpr * 1.15 * 100) / 100)
      setDpr(s.dpr)
      rememberDpr(s.dpr)
      s.at = now
      invalidate()
    }
  })
  return null
}
