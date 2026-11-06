/**
 * Everything loose on the table as real bodies in one physics world (Rapier): every card, every piece, the robber.
 *
 * The game says how many of what lie where ("piles"); this keeps the bodies matching it:
 *   - each thing belongs to a pile and has a home there (its slot: the nth card up a stack, a spot in the supply)
 *   - when the game changes, things that must move fly to their new home in a short arc, then are let go there and
 *     settle as real bodies
 *   - things only move between piles of one family (resource cards, development cards, one player's roads...), the
 *     nearest one of the right look first; a hidden card can be any card of its family, so a card you can't see
 *     shows its face only once it is somewhere everyone can see it
 *   - you can pick a thing up, carry it, drop it, toss it into the others. Whatever comes to rest away from home
 *     flies back after a moment: nothing stays misplaced for long
 *   - at rest, bodies sleep and nothing steps or draws
 *
 * Stacks of cards are done the way table-top simulators do them: a settled stack is one solid block in the world
 * (as tall as its cards), and a card is a body of its own only while it's loose (held, tossed, lying where it
 * landed). Paper-thin bodies piled twenty high can't be kept still by any physics engine; one block can.
 * Pieces are bodies of their own all the time (they're chunky; they stack and topple for real).
 * While flying home a thing has no body: it's in the hand, and passes over everything.
 *
 * Millimetres, seconds. The game never reads anything back from here: what a click does is decided by the pile the
 * clicked thing belongs to, not by where it lies.
 */
import type * as RAPIER from '@dimforge/rapier3d-compat'
import { Euler, Quaternion, Vector3 } from 'three'

type R = typeof RAPIER

export type ThingKind = 'card' | 'road' | 'settlement' | 'city' | 'robber' | 'knight1' | 'knight2' | 'knight3' | 'wall'
export type Home = { x: number; y: number; z: number; yaw: number; flip?: boolean }
export type PileSpec = {
  id: string
  kind: ThingKind
  /** things move only between piles of one family */
  family: string
  /** what this pile's things show: a card's face ('res:grain', 'res:?' for unseen), a piece's colour */
  look: string
  n: number
  /** where slot i rests */
  home: (i: number) => Home
  /** cards: drawn smaller (on the tray) */
  small?: boolean
  /** where new things come from when no loose one fits (else from above); where leftovers go (else up and away) */
  from?: [number, number]
  to?: [number, number]
  /** new things start at this height there (below a tile's top: they come up out of it) */
  fromY?: number
  /** new things wait this long (s) before they set off (cards from a roll wait for the dice) */
  wait?: number
  /** leftovers arrive there at this height and turned this way (a piece going onto the board) */
  toY?: number
  toYaw?: number
  /** the pile's cards are face down and nobody may know them: once landed, they forget their face */
  hidden?: boolean
  enabled?: boolean
  onClick?: () => void
  /** may be picked up (default true) */
  grab?: boolean
  /** shown raised by this many mm (ready to play, the piece being built) */
  lift?: number
  /** shown greyed (there, but not to be had now) */
  dim?: boolean
}

export type Pose = { p: Vector3; q: Quaternion }
export type Thing = {
  id: number
  kind: ThingKind
  family: string
  look: string
  small: boolean
  pile: string | null
  slot: number
  home: Pose
  /** current pose (what is drawn), and the last step's (drawn between the two) */
  pose: Pose
  prev: Pose
  body: RAPIER.RigidBody | null
  /** settled: at home and still (a card then is part of its stack's block); fly: on its way; held: in the hand;
   *  loose: a free body somewhere (falling, tossed, lying where it landed) */
  mode: 'settled' | 'fly' | 'held' | 'loose'
  fly: { from: Pose; to: Pose; t0: number; dur: number; arc: number; vanish: boolean } | null
  /** when it came to rest away from home */
  away: number | null
  /** how long it has been barely moving (it's put to sleep soon after) */
  still: number
  /** where it goes when nothing wants it */
  sink: [number, number] | null
  sinkPose: { y?: number; yaw?: number }
  /** the look it takes on landing (a card landing face down in a hidden pile) */
  forget: string | null
  /** a settled card's height in its stack */
  stackY: number
  gone?: boolean
}

/** body shapes, by kind (sizes and hull points in mm, from the spec) */
export type Shapes = {
  card: { w: number; d: number; t: number; small: number }
  hull: Record<Exclude<ThingKind, 'card'>, Float32Array[]>
}
export type StaticPart = { box: [number, number, number]; at: [number, number, number]; yaw?: number } | { hull: Float32Array } | { cyl: [number, number]; at: [number, number, number] }

const UP = new Vector3(0, 1, 0)
// 120 steps a second: firm contacts stay steady (a tall pile of roads rocks for ever at 60), and it's cheap: at rest,
// nothing steps at all
const STEP = 1 / 120
const MAX_STEPS = 6
/** how long a piece takes from your supply to the board */
export const VANISH = 0.55
const GRAVITY = 6000
/** a loose card's body is a little thicker than the card (paper-thin bodies sink into things) */
const LOOSE_CARD = 1.6
const tmpV = new Vector3()
const tmpW = new Vector3()
const tmpQ = new Quaternion()
const tmpE = new Euler()

function hash(s: string) {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507)
    h = Math.imul(h ^ (h >>> 13), 3266489909)
    return ((h ^= h >>> 16) >>> 0) / 4294967296
  }
}
export { hash as seeded }

export function poseOf(h: Home, out?: Pose): Pose {
  const o = out ?? { p: new Vector3(), q: new Quaternion() }
  o.p.set(h.x, h.y, h.z)
  o.q.setFromEuler(tmpE.set(0, h.yaw, h.flip ? Math.PI : 0, 'YXZ'))
  return o
}
const clone = (p: Pose): Pose => ({ p: p.p.clone(), q: p.q.clone() })

export class Table {
  things: Thing[] = []
  specs = new Map<string, PileSpec>()
  R: R | null = null
  world: RAPIER.World | null = null
  /** the pile under the pointer (drawn a little raised when clickable) */
  hover: string | null = null
  /** something changed that must be drawn */
  dirty = true
  private nextId = 1
  private acc = 0
  private started = false
  /** the fixed things, by group (the base first: bodies are only made once it exists) */
  private groups = new Map<string, RAPIER.RigidBody>()
  private based = false
  /** each card stack's block */
  private stacks = new Map<string, { body: RAPIER.RigidBody; collider: RAPIER.Collider }>()
  private stacksDirty = true
  private held: { thing: Thing; target: Vector3 } | null = null

  constructor(private shapes: Shapes) {}

  // ---------------------------------------------------------------- the world

  attach(R: R) {
    this.R = R
    const world = new R.World({ x: 0, y: -GRAVITY, z: 0 })
    world.lengthUnit = 1000
    world.numSolverIterations = 8
    // things may sink into each other by 0.1 mm at most (the default is a whole mm)
    world.integrationParameters.normalizedAllowedLinearError = 0.0001
    // firm contacts (the default 30 lets a card flung at the table sink half a millimetre into it for a moment)
    world.integrationParameters.contact_natural_frequency = 120
    world.timestep = STEP
    this.world = world
    this.dirty = true
  }

  dispose() {
    this.world?.free()
    this.world = null
    this.based = false
    this.groups.clear()
    this.stacks.clear()
    for (const t of this.things) t.body = null
  }

  /** a group of fixed things bodies rest on and bump into (a body made before what it rests on is flung off it, so
   *  nothing is made till the base exists) */
  setStatics(group: string, parts: StaticPart[]) {
    const { R, world } = this
    if (!R || !world) return
    const old = this.groups.get(group)
    if (old) world.removeRigidBody(old)
    const body = world.createRigidBody(R.RigidBodyDesc.fixed())
    for (const part of parts) {
      let desc: RAPIER.ColliderDesc | null
      if ('box' in part) {
        desc = R.ColliderDesc.cuboid(...part.box).setTranslation(...part.at)
        if (part.yaw) desc.setRotation(tmpQ.setFromAxisAngle(UP, part.yaw))
      } else if ('cyl' in part) desc = R.ColliderDesc.cylinder(...part.cyl).setTranslation(...part.at)
      else desc = R.ColliderDesc.convexHull(part.hull)
      if (desc) world.createCollider(desc.setFriction(0.8), body)
    }
    this.groups.set(group, body)
    if (group === 'base' && !this.based) {
      this.based = true
      for (const t of this.things) if (t.kind !== 'card' && t.mode === 'settled') this.makeBody(t, true)
      this.stacksDirty = true
    }
    this.dirty = true
  }

  private makeBody(t: Thing, asleep = false) {
    const { R, world } = this
    if (!R || !world || !this.based || t.body) return
    const body = world.createRigidBody(
      R.RigidBodyDesc.dynamic()
        .setTranslation(t.pose.p.x, t.pose.p.y, t.pose.p.z)
        .setRotation(t.pose.q)
        .setLinearDamping(0.4)
        .setAngularDamping(2)
        .setCanSleep(true)
        // a tossed card is thin and quick: swept, so it can never pass into the table or a stack
        .setCcdEnabled(true),
    )
    if (t.kind === 'card') {
      const c = this.shapes.card
      const s = t.small ? c.small : 1
      world.createCollider(R.ColliderDesc.cuboid((c.w * s) / 2, LOOSE_CARD / 2, (c.d * s) / 2).setFriction(0.7).setRestitution(0).setDensity(0.4), body)
    } else
      for (const pts of this.shapes.hull[t.kind]) {
        const d = R.ColliderDesc.convexHull(pts)
        if (d) world.createCollider(d.setFriction(0.8).setRestitution(0.05).setDensity(0.7), body)
      }
    if (asleep) body.sleep()
    t.body = body
    t.still = 0
  }

  private dropBody(t: Thing) {
    if (t.body && this.world) this.world.removeRigidBody(t.body)
    t.body = null
  }

  /** each card stack is one block, as tall as its settled cards; settled cards sit up it in order */
  private syncStacks() {
    this.stacksDirty = false
    const { R, world } = this
    const piles = new Map<string, Thing[]>()
    for (const t of this.things) if (t.kind === 'card' && t.mode === 'settled' && t.pile) (piles.get(t.pile) ?? piles.set(t.pile, []).get(t.pile)!).push(t)
    for (const [id, list] of piles) {
      list.sort((a, b) => a.slot - b.slot)
      const spec = this.specs.get(id)
      const base = spec ? spec.home(0).y - this.shapes.card.t / 2 : 0
      list.forEach((t, i) => (t.stackY = base + this.shapes.card.t * (i + 0.5)))
    }
    if (!R || !world || !this.based) return
    for (const [id, s] of this.stacks)
      if (!piles.has(id) || !this.specs.has(id)) {
        world.removeRigidBody(s.body)
        this.stacks.delete(id)
      }
    for (const [id, list] of piles) {
      const spec = this.specs.get(id)
      if (!spec) continue
      const h0 = spec.home(0)
      const c = this.shapes.card
      const k = spec.small ? c.small : 1
      const h = list.length * c.t
      const half = { x: (c.w * k) / 2, y: Math.max(0.2, h / 2), z: (c.d * k) / 2 }
      const at = { x: h0.x, y: h0.y - c.t / 2 + h / 2, z: h0.z }
      let s = this.stacks.get(id)
      if (!s) {
        const body = world.createRigidBody(R.RigidBodyDesc.fixed().setTranslation(at.x, at.y, at.z).setRotation(tmpQ.setFromAxisAngle(UP, h0.yaw)))
        const collider = world.createCollider(R.ColliderDesc.cuboid(half.x, half.y, half.z).setFriction(0.7), body)
        this.stacks.set(id, (s = { body, collider }))
      } else {
        s.body.setTranslation(at, true)
        s.body.setRotation(tmpQ.setFromAxisAngle(UP, h0.yaw), true)
        s.collider.setHalfExtents(half)
      }
    }
  }

  // ---------------------------------------------------------------- matching the game

  /** the game's piles now: move, add and remove things to match */
  setPiles(specs: PileSpec[], now: number) {
    const first = !this.started
    this.started = true
    this.specs = new Map(specs.map((s) => [s.id, s]))
    const byPile = new Map<string, Thing[]>()
    const free: Thing[] = []
    for (const t of this.things) {
      const spec = t.pile ? this.specs.get(t.pile) : undefined
      if (!spec || spec.family !== t.family) {
        t.pile = null
        free.push(t)
        continue
      }
      ;(byPile.get(spec.id) ?? byPile.set(spec.id, []).get(spec.id)!).push(t)
    }
    // too many in a pile: the top ones come loose
    for (const [id, list] of byPile) {
      list.sort((a, b) => a.slot - b.slot)
      const n = this.specs.get(id)!.n
      while (list.length > n) {
        const t = list.pop()!
        t.pile = null
        free.push(t)
      }
      list.forEach((t, i) => (t.slot = i))
    }
    // too few: the nearest loose thing of the family (the right look first), else a new one
    let stagger = 0
    const fresh = new Set<Thing>()
    for (const spec of specs) {
      const list = byPile.get(spec.id) ?? []
      byPile.set(spec.id, list)
      while (list.length < spec.n) {
        const slot = list.length
        const h = spec.home(slot)
        let best = -1
        let bestScore = Infinity
        free.forEach((t, i) => {
          if (t.family !== spec.family) return
          const score = (t.look === spec.look ? 0 : 5000) + Math.hypot(t.pose.p.x - h.x, t.pose.p.z - h.z)
          if (score < bestScore) {
            bestScore = score
            best = i
          }
        })
        let t: Thing
        if (best >= 0) t = free.splice(best, 1)[0]
        else {
          t = this.spawn(spec, h, first)
          fresh.add(t)
        }
        t.pile = spec.id
        t.slot = slot
        t.sink = spec.to ?? null
        t.sinkPose = { y: spec.toY, yaw: spec.toYaw }
        list.push(t)
        // a card's face: shown as the pile's (unseen ones take the face they're given); one going into hiding keeps
        // its face till it lands face down, then forgets it
        if (!spec.look.endsWith(':?')) t.look = spec.look
        t.forget = spec.hidden ? spec.look : null
        t.small = !!spec.small
      }
    }
    // everyone's home; whoever isn't there goes
    for (const [id, list] of byPile) {
      const spec = this.specs.get(id)!
      for (const t of list) {
        const want = poseOf(spec.home(t.slot))
        const moved = want.p.distanceTo(t.home.p) > 0.3 || want.q.angleTo(t.home.q) > 0.01
        t.home = want
        if (first) {
          this.place(t)
          continue
        }
        if (fresh.has(t) || (moved && t.mode !== 'held') || (t.mode === 'fly' && t.fly?.vanish))
          this.flyTo(t, want, now + Math.min(0.6, stagger++ * 0.045) + (fresh.has(t) ? spec.wait ?? 0 : 0), false)
      }
    }
    // nothing wants these: back where they came from, and gone
    for (const t of free) {
      if (t.fly?.vanish) continue
      const [x, z] = t.sink ?? [t.pose.p.x, t.pose.p.z]
      const { y, yaw } = t.sinkPose
      const q = yaw !== undefined ? new Quaternion().setFromAxisAngle(UP, yaw) : t.pose.q.clone()
      this.flyTo(t, { p: new Vector3(x, t.sink ? (y ?? 10) : t.pose.p.y + 260, z), q }, now, true)
    }
    this.stacksDirty = true
    this.dirty = true
  }

  private spawn(spec: PileSpec, h: Home, first: boolean): Thing {
    const home = poseOf(h)
    const start = clone(home)
    if (!first) {
      if (spec.from) start.p.set(spec.from[0], spec.fromY ?? 30, spec.from[1])
      else start.p.y += 220
    }
    const t: Thing = {
      id: this.nextId++,
      kind: spec.kind,
      family: spec.family,
      look: spec.look,
      small: !!spec.small,
      pile: spec.id,
      slot: 0,
      home,
      pose: start,
      prev: clone(start),
      body: null,
      mode: 'loose',
      fly: null,
      away: null,
      still: 0,
      sink: spec.to ?? null,
      sinkPose: { y: spec.toY, yaw: spec.toYaw },
      forget: null,
      stackY: h.y,
    }
    this.things.push(t)
    return t
  }

  /** put straight at home, still */
  private place(t: Thing) {
    t.pose = clone(t.home)
    t.prev = clone(t.home)
    t.fly = null
    t.mode = 'settled'
    if (t.forget) t.look = t.forget
    if (t.kind === 'card') this.dropBody(t)
    else this.makeBody(t, true)
  }

  private flyTo(t: Thing, to: Pose, t0: number, vanish: boolean) {
    if (this.held?.thing === t) this.held = null
    // what it looks like where it is now (a settled card: its place up the stack)
    if (t.mode === 'settled' && t.kind === 'card') t.pose.p.y = t.stackY
    const from = clone(t.pose)
    const d = from.p.distanceTo(to.p)
    // (a leftover piece goes onto the board in a fixed time: the board's own piece appears as it arrives)
    const dur = vanish && t.kind !== 'card' && t.sink ? VANISH : Math.min(0.85, 0.28 + d / 1400)
    t.fly = { from, to: clone(to), t0, dur, arc: Math.min(90, 8 + d * 0.16), vanish }
    t.mode = 'fly'
    t.away = null
    this.dropBody(t)
    this.stacksDirty = true
  }

  // ---------------------------------------------------------------- the hand

  /** pick up a thing (from a stack: its top card) */
  grab(picked: Thing) {
    if (!this.world || !this.based) return null
    let t = picked
    if (t.kind === 'card' && t.mode === 'settled' && t.pile) {
      const top = this.things.filter((x) => x.pile === t.pile && x.mode === 'settled').sort((a, b) => b.slot - a.slot)[0]
      if (top) t = top
    }
    const spec = t.pile ? this.specs.get(t.pile) : undefined
    if (spec?.grab === false || t.fly?.vanish) return null
    if (t.mode === 'settled' && t.kind === 'card') {
      // out of its stack: the block shrinks first, and the card starts just clear of it
      t.mode = 'held'
      this.syncStacks()
      t.pose.p.y = t.stackY + (LOOSE_CARD - this.shapes.card.t) / 2 + 0.2
      t.prev.p.copy(t.pose.p)
    }
    t.fly = null
    this.makeBody(t)
    const b = t.body!
    b.setGravityScale(0, true)
    b.setEnabledRotations(false, true, false, true)
    b.setAngvel({ x: 0, y: 0, z: 0 }, true)
    b.wakeUp()
    t.mode = 'held'
    t.away = null
    this.held = { thing: t, target: t.pose.p.clone() }
    this.stacksDirty = true
    this.dirty = true
    return t
  }

  /** where the held thing is pulled to */
  carry(x: number, y: number, z: number) {
    if (this.held) this.held.target.set(x, y, z)
    this.dirty = true
  }

  /** let go: it falls, as anything does */
  release() {
    const h = this.held
    this.held = null
    if (!h) return null
    const b = h.thing.body
    if (b) {
      b.setGravityScale(1, true)
      b.setEnabledRotations(true, true, true, true)
      // it keeps a little of its speed, and turns a little as it goes
      const v = b.linvel()
      b.setLinvel({ x: v.x * 0.6, y: Math.min(v.y, 0), z: v.z * 0.6 }, true)
      b.setAngvel({ x: v.z * 0.004, y: 0, z: -v.x * 0.004 }, true)
    }
    h.thing.mode = 'loose'
    h.thing.still = 0
    this.dirty = true
    return h.thing
  }

  get holding() {
    return this.held?.thing ?? null
  }

  // ---------------------------------------------------------------- time

  /** advance to `now` (s); true while anything is moving */
  update(now: number, dt: number) {
    let moving = this.dirty
    this.dirty = false
    // flights follow their path
    for (const t of this.things) {
      const f = t.fly
      if (!f) continue
      moving = true
      const k = Math.max(0, Math.min(1, (now - f.t0) / f.dur))
      const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2
      t.pose.p.lerpVectors(f.from.p, f.to.p, e)
      t.pose.p.y += Math.sin(Math.PI * e) * f.arc
      t.pose.q.slerpQuaternions(f.from.q, f.to.q, e)
      // turning over on the way, its edges would dip: lift it so no corner goes below the surfaces it's between
      const low = this.lowest(t)
      const under = Math.min(f.from.p.y, f.to.p.y) - this.restLow(t)
      if (low < under) t.pose.p.y += under - low
      t.prev.p.copy(t.pose.p)
      t.prev.q.copy(t.pose.q)
      if (k >= 1) this.land(t)
    }
    if (this.things.some((t) => t.gone)) this.things = this.things.filter((t) => !t.gone)
    // spawned before the world arrived (or while it was away): give them bodies now
    for (const t of this.things) if (t.mode === 'loose' && !t.body) this.makeBody(t)
    if (this.stacksDirty) this.syncStacks()
    const { world } = this
    if (!world) return moving
    // the hand pulls what it holds, like a soft spring
    if (this.held?.thing.body) {
      const b = this.held.thing.body
      const p = b.translation()
      const tg = this.held.target
      const k = 14
      const v = { x: (tg.x - p.x) * k, y: (tg.y - p.y) * k, z: (tg.z - p.z) * k }
      const s = Math.hypot(v.x, v.y, v.z)
      const max = 3500
      if (s > max) (v.x *= max / s), (v.y *= max / s), (v.z *= max / s)
      b.setLinvel(v, true)
      moving = true
    }
    const awake = this.things.some((t) => t.body && !t.body.isSleeping())
    if (!awake) {
      this.acc = 0
      // asleep, but something lies out of place: keep the clock going till it's sent home
      this.tidy(now, 0)
      if (this.stacksDirty) this.syncStacks()
      return moving || this.things.some((t) => t.away !== null || t.fly)
    }
    this.acc += Math.min(dt, STEP * MAX_STEPS)
    let steps = 0
    while (this.acc >= STEP && steps < MAX_STEPS) {
      for (const t of this.things) {
        if (!t.body) continue
        t.prev.p.copy(t.pose.p)
        t.prev.q.copy(t.pose.q)
      }
      world.step()
      for (const t of this.things) {
        if (!t.body) continue
        const p = t.body.translation()
        const q = t.body.rotation()
        t.pose.p.set(p.x, p.y, p.z)
        t.pose.q.set(q.x, q.y, q.z, q.w)
      }
      this.acc -= STEP
      steps++
    }
    this.tidy(now, steps * STEP)
    if (this.stacksDirty) this.syncStacks()
    return true
  }

  /** a thing's bounding corners in its own frame */
  private corners(t: Thing) {
    const key = t.kind === 'card' ? (t.small ? 'card-s' : 'card') : t.kind
    let c = this.cornerCache.get(key)
    if (!c) {
      let min = new Vector3(Infinity, Infinity, Infinity)
      let max = new Vector3(-Infinity, -Infinity, -Infinity)
      if (t.kind === 'card') {
        const k = t.small ? this.shapes.card.small : 1
        max = new Vector3((this.shapes.card.w * k) / 2, this.shapes.card.t / 2, (this.shapes.card.d * k) / 2)
        min = max.clone().negate()
      } else
        for (const pts of this.shapes.hull[t.kind])
          for (let i = 0; i < pts.length; i += 3) {
            tmpV.set(pts[i], pts[i + 1], pts[i + 2])
            min.min(tmpV)
            max.max(tmpV)
          }
      c = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => new Vector3(i & 1 ? max.x : min.x, i & 2 ? max.y : min.y, i & 4 ? max.z : min.z))
      this.cornerCache.set(key, c)
    }
    return c
  }
  /** the lowest point of a thing as it's posed now (world height) */
  private lowest(t: Thing) {
    let low = Infinity
    for (const c of this.corners(t)) low = Math.min(low, tmpW.copy(c).applyQuaternion(t.pose.q).y)
    return t.pose.p.y + low
  }
  /** how far its lowest point is below its centre when lying as it should */
  private restLow(t: Thing) {
    let low = Infinity
    for (const c of this.corners(t)) low = Math.min(low, tmpW.copy(c).applyQuaternion(t.home.q).y)
    return -low
  }
  private cornerCache = new Map<string, Vector3[]>()

  /** how far between the last two steps to draw (0..1) */
  get alpha() {
    return Math.min(1, this.acc / STEP)
  }

  private land(t: Thing) {
    const f = t.fly!
    t.fly = null
    if (f.vanish) {
      t.gone = true
      return
    }
    if (t.forget) t.look = t.forget
    t.pose = clone(f.to)
    t.prev = clone(f.to)
    if (t.kind === 'card') {
      // a card joins its stack
      t.mode = 'settled'
      this.stacksDirty = true
      return
    }
    // a piece is let go a hair above its spot and settles there as a body
    t.mode = 'loose'
    t.pose.p.y += 0.8
    t.prev.p.y += 0.8
    this.makeBody(t)
    t.body?.setLinvel({ x: 0, y: -60, z: 0 }, true)
  }

  /** what comes to rest: at home, it stays; away from home, it goes back after a moment */
  /** everything awake has been barely moving for a quarter second: all of it sleeps at once (bodies resting on each
   *  other would only wake each other again if put to sleep one by one) */
  private restAll() {
    const awake = this.things.filter((t) => t.body && t.mode !== 'held' && t.mode !== 'fly' && !t.body.isSleeping())
    if (awake.length && awake.every((t) => t.still > 0.25)) for (const t of awake) t.body!.sleep()
  }

  private tidy(now: number, dt: number) {
    this.restAll()
    for (const t of this.things) {
      const b = t.body
      if (!b || t.mode === 'held' || t.mode === 'fly') continue
      // the engine waits two seconds to put a still body to sleep; a quarter is plenty here (see restAll too)
      if (!b.isSleeping()) {
        const v = b.linvel()
        const w = b.angvel()
        if (Math.hypot(v.x, v.y, v.z) < 15 && Math.hypot(w.x, w.y, w.z) < 0.5) t.still += dt
        else t.still = 0
      }
      const fell = t.pose.p.y < -100
      if (!fell && !b.isSleeping()) continue
      if (!t.pile) continue
      if (!fell && !this.offHome(t)) {
        t.away = null
        if (t.mode === 'loose') {
          t.mode = 'settled'
          // a card back on its stack becomes part of the block
          if (t.kind === 'card') {
            this.dropBody(t)
            this.stacksDirty = true
          }
        }
        continue
      }
      t.away ??= now
      if (fell || now - t.away > 1.1) this.flyTo(t, t.home, now, false)
    }
  }

  private offHome(t: Thing) {
    const dx = t.pose.p.x - t.home.p.x
    const dz = t.pose.p.z - t.home.p.z
    const tol = t.kind === 'card' ? 8 : 4
    if (Math.hypot(dx, dz) > tol) return true
    // cards: anywhere up their own stack is home; pieces: their own height
    if (t.kind !== 'card' && Math.abs(t.pose.p.y - t.home.p.y) > tol) return true
    if (t.kind === 'card' && t.pose.p.y - t.home.p.y > 30) return true
    // turned over, or turned round
    const up = tmpV.copy(UP).applyQuaternion(t.pose.q)
    const want = tmpW.copy(UP).applyQuaternion(t.home.q)
    return up.dot(want) < 0.9 || t.pose.q.angleTo(t.home.q) > 0.45
  }

  /** the pose to draw now, between the last two steps */
  drawn(t: Thing, out: Pose) {
    if (t.mode === 'settled' && t.kind === 'card') {
      out.p.copy(t.home.p)
      out.p.y = t.stackY
      out.q.copy(t.home.q)
    } else if (!t.body) {
      out.p.copy(t.pose.p)
      out.q.copy(t.pose.q)
    } else {
      const a = this.alpha
      out.p.lerpVectors(t.prev.p, t.pose.p, a)
      out.q.slerpQuaternions(t.prev.q, t.pose.q, a)
    }
    const spec = t.pile ? this.specs.get(t.pile) : undefined
    if (spec && t.mode === 'settled') out.p.y += (spec.lift ?? 0) + (this.hover === spec.id && spec.enabled ? 4 : 0)
    return out
  }
}
