/**
 * A real throw of the two dice, worked out in a little world of its own (the dice tray and the two dice) the moment
 * they're rolled, then played back. The server has already said what they show, so once the throw has come to rest
 * each die's printing is turned (by one of the cube's own turns: its shape doesn't change) so the face on top is the
 * one rolled. The throw is seeded by the roll's number, so everyone at the table sees the same one.
 */
import type * as RAPIER from '@dimforge/rapier3d-compat'
import { Quaternion, Vector3 } from 'three'
import { DIE_FACES } from './geometry.ts'
import { DICE } from './spec.ts'

const NORMALS = [new Vector3(1, 0, 0), new Vector3(-1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, -1, 0), new Vector3(0, 0, 1), new Vector3(0, 0, -1)]
const UP = new Vector3(0, 1, 0)
export const FPS = 60

export type Throw = {
  /** per frame, per die: x y z qx qy qz qw */
  frames: Float32Array
  count: number
  /** the turn of each die's printing that puts its rolled face on top */
  fix: [Quaternion, Quaternion]
}

function seeded(n: number) {
  let t = (n * 2654435761) | 0
  return () => {
    t = (t + 0x6d2b79f5) | 0
    let x = Math.imul(t ^ (t >>> 15), t | 1)
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61)
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296
  }
}

/** which face (index into NORMALS) points up, and how squarely */
function upFace(q: Quaternion) {
  let best = 0
  let dot = -2
  NORMALS.forEach((n, i) => {
    const d = n.clone().applyQuaternion(q).dot(UP)
    if (d > dot) {
      dot = d
      best = i
    }
  })
  return { face: best, dot }
}

/** the cube's turn taking face `from`'s direction to face `to`'s */
function cubeTurn(from: number, to: number) {
  const a = NORMALS[from]
  const b = NORMALS[to]
  if (from === to) return new Quaternion()
  if (a.dot(b) < -0.5) {
    // opposite faces: half a turn about an axis across them
    const axis = Math.abs(a.x) > 0.5 ? new Vector3(0, 1, 0) : new Vector3(1, 0, 0)
    return new Quaternion().setFromAxisAngle(axis, Math.PI)
  }
  return new Quaternion().setFromUnitVectors(a, b)
}

export function throwDice(R: typeof RAPIER, roll: number, at: [number, number], values: [number, number]): Throw {
  const T = DICE.tray
  for (let attempt = 0; attempt < 6; attempt++) {
    const rnd = seeded(roll * 7 + attempt * 101 + 3)
    const world = new R.World({ x: 0, y: -9810, z: 0 })
    world.lengthUnit = 1000
    world.timestep = 1 / 120
    const fixed = world.createRigidBody(R.RigidBodyDesc.fixed())
    const [x0, z0] = at
    const inW = T.w - 2 * T.rim
    const inD = T.d - 2 * T.rim
    world.createCollider(R.ColliderDesc.cuboid(T.w / 2, 5, T.d / 2).setTranslation(x0, T.felt - 5, z0).setFriction(0.7).setRestitution(0.3), fixed)
    // the rim, and above it a little more than you see, so a lively throw stays in the tray
    const wallH = 70
    for (const [dx, dz, hx, hz] of [
      [0, -(inD / 2 + 5), T.w / 2, 5],
      [0, inD / 2 + 5, T.w / 2, 5],
      [-(inW / 2 + 5), 0, 5, T.d / 2],
      [inW / 2 + 5, 0, 5, T.d / 2],
    ])
      world.createCollider(R.ColliderDesc.cuboid(hx, wallH / 2, hz).setTranslation(x0 + dx, wallH / 2, z0 + dz).setFriction(0.4).setRestitution(0.35), fixed)
    const h = DICE.size / 2
    const r = DICE.round * 0.8
    const dice = [0, 1].map((i) => {
      const q = new Quaternion().setFromAxisAngle(new Vector3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).normalize(), rnd() * Math.PI * 2)
      const b = world.createRigidBody(
        R.RigidBodyDesc.dynamic()
          .setTranslation(x0 - inW / 2 + 12 + i * 10 + rnd() * 6, 34 + i * 10 + rnd() * 10, z0 + (i - 0.5) * 18 + (rnd() - 0.5) * 6)
          .setRotation(q)
          .setLinvel(380 + rnd() * 260, -150, (rnd() - 0.5) * 220)
          .setAngvel({ x: (rnd() - 0.5) * 40, y: (rnd() - 0.5) * 30, z: (rnd() - 0.5) * 40 })
          .setLinearDamping(0.1)
          .setAngularDamping(0.6),
      )
      world.createCollider(R.ColliderDesc.roundCuboid(h - r, h - r, h - r, r).setFriction(0.6).setRestitution(0.3).setDensity(1.2), b)
      return b
    })
    const max = FPS * 3
    const frames = new Float32Array(max * 14)
    let count = 0
    let quiet = 0
    for (let step = 0; step < max * 2; step++) {
      world.step()
      if (step % 2) continue
      dice.forEach((b, i) => {
        const p = b.translation()
        const q = b.rotation()
        frames.set([p.x, p.y, p.z, q.x, q.y, q.z, q.w], count * 14 + i * 7)
      })
      count++
      const still = dice.every((b) => Math.hypot(...Object.values(b.linvel())) < 6 && Math.hypot(...Object.values(b.angvel())) < 0.2)
      quiet = still ? quiet + 1 : 0
      if (quiet > 8 && count > 30) break
    }
    // a good throw: both flat on the felt, inside the tray
    const ends = dice.map((b) => {
      const p = b.translation()
      const q = b.rotation()
      return { p, q: new Quaternion(q.x, q.y, q.z, q.w) }
    })
    world.free()
    const ok = ends.every(({ p, q }) => upFace(q).dot > 0.985 && Math.abs(p.x - x0) < inW / 2 && Math.abs(p.z - z0) < inD / 2 && p.y < T.felt + h + 1.5)
    if (!ok && attempt < 5) continue
    const fix = ends.map(({ q }, i) => cubeTurn(DIE_FACES.indexOf(values[i]), upFace(q).face)) as [Quaternion, Quaternion]
    return { frames: frames.slice(0, count * 14), count, fix }
  }
  throw new Error('unreachable')
}
