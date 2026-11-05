/**
 * Only with ?test in the address: lets a browser test find where things are on screen (to click the board the way
 * a person would) and read what the last frame cost. Does nothing otherwise.
 */
import { useThree } from '@react-three/fiber'
import { useEffect } from 'react'
import { Vector3 } from 'three'
import { edgeAt, hexAt, TILE, vertexAt } from './spec.ts'

export const TESTING = typeof location !== 'undefined' && new URLSearchParams(location.search).has('test')

/** the HUD's state, published as it renders */
export function publishState(state: unknown) {
  if (TESTING) (window as unknown as Record<string, unknown>).__state = state
}

export function TestHook() {
  const { camera, size, gl, invalidate, scene } = useThree()
  useEffect(() => {
    if (!TESTING) return
    const w = window as unknown as Record<string, unknown>
    w.__screen = (kind: 'vertex' | 'edge' | 'hex', id: number) => {
      const [x, z] = kind === 'vertex' ? vertexAt(id) : kind === 'edge' ? edgeAt(id) : hexAt(id)
      const v = new Vector3(x, TILE.h + 4, z).project(camera)
      const r = gl.domElement.getBoundingClientRect()
      return [r.left + ((v.x + 1) / 2) * size.width, r.top + ((1 - v.y) / 2) * size.height]
    }
    w.__project = (x: number, y: number, z: number) => {
      const v = new Vector3(x, y, z).project(camera)
      const r = gl.domElement.getBoundingClientRect()
      return [r.left + ((v.x + 1) / 2) * size.width, r.top + ((1 - v.y) / 2) * size.height]
    }
    w.__frames = 0
    gl.info.autoReset = true
    const orig = gl.render.bind(gl)
    const times: number[] = []
    w.__times = times
    gl.render = (...a: Parameters<typeof gl.render>) => {
      orig(...a)
      times.push(performance.now())
      if (times.length > 2000) times.shift()
      w.__frames = (w.__frames as number) + 1
      w.__perf = { calls: gl.info.render.calls, triangles: gl.info.render.triangles, programs: gl.info.programs?.length }
    }
    w.__redraw = () => ((gl.shadowMap.needsUpdate = true), invalidate())
    // the cost of a whole frame (shadows and all), drawn n times and waited for each time: ms per frame
    w.__bench = (n = 30, shadows = true) => {
      const ctx = gl.getContext()
      const px = new Uint8Array(4)
      const t0 = performance.now()
      for (let i = 0; i < n; i++) {
        gl.shadowMap.needsUpdate = shadows
        orig(scene, camera)
        ctx.readPixels(0, 0, 1, 1, ctx.RGBA, ctx.UNSIGNED_BYTE, px)
      }
      return (performance.now() - t0) / n
    }
  }, [camera, size, gl, invalidate, scene])
  return null
}
