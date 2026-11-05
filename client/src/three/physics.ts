/**
 * The physics engine (Rapier, WebAssembly), fetched once and only when the table opens. Everything that needs it
 * draws without it till it arrives (things at rest where they belong, the dice where they lie).
 */
import type * as RAPIER from '@dimforge/rapier3d-compat'
import { useEffect, useState } from 'react'

export type Rapier = typeof RAPIER
let loading: Promise<Rapier> | null = null
let ready: Rapier | null = null

export function loadRapier() {
  return (loading ??= import('@dimforge/rapier3d-compat').then(async (m) => {
    const R = (m as unknown as { default?: Rapier }).default ?? m
    await R.init()
    ready = R
    return R
  }))
}

export function useRapier() {
  const [R, setR] = useState<Rapier | null>(ready)
  useEffect(() => {
    if (R) return
    let live = true
    loadRapier().then((r) => live && setR(r))
    return () => {
      live = false
    }
  }, [R])
  return R
}
