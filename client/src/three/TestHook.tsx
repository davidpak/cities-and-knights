/**
 * Only with ?test in the address: lets a browser test find where things are on screen, so it can click the board
 * the way a person would. Does nothing otherwise.
 */
import { useThree } from '@react-three/fiber'
import { useEffect } from 'react'
import { Vector3 } from 'three'
import { edgeAt, hexAt, TILE, vertexAt } from './spec.ts'

/** the HUD's state, published as it renders (outside the canvas, so it is never a frame behind the buttons) */
export function publishState(state: unknown) {
  if (TESTING) (window as unknown as Record<string, unknown>).__state = state
}

export const TESTING = typeof location !== 'undefined' && new URLSearchParams(location.search).has('test')

/** the screen position of a board spot (lives inside the canvas, where the camera is) */
export function TestHook() {
  const { camera, size } = useThree()
  useEffect(() => {
    if (!TESTING) return
    const w = window as unknown as Record<string, unknown>
    w.__screen = (kind: 'vertex' | 'edge' | 'hex', id: number) => {
      const [x, z] = kind === 'vertex' ? vertexAt(id) : kind === 'edge' ? edgeAt(id) : hexAt(id)
      const v = new Vector3(x, TILE.h + (kind === 'hex' ? 8 : 4), z).project(camera)
      return [((v.x + 1) / 2) * size.width, ((1 - v.y) / 2) * size.height]
    }
  })
  return null
}
