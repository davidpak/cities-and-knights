/**
 * Small HTML labels pinned to things on the table (counts on stacks, names, the tray's buttons). The camera never
 * moves except when the window changes size, so positions are worked out then, not every frame.
 */
import { useSyncExternalStore } from 'react'

type Project = (x: number, y: number, z: number) => [number, number]
let project: Project = () => [-999, -999]
let version = 0
const subs = new Set<() => void>()

export function setProjector(p: Project) {
  project = p
  version++
  subs.forEach((f) => f())
}

/** the current projector (world mm to pixels in the board's box); re-renders when it changes */
export function useProjector(): Project {
  useSyncExternalStore((f) => (subs.add(f), () => subs.delete(f)), () => version)
  return project
}
