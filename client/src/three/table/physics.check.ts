/**
 * The physical table, headless: pieces and stacks laid out lie still; cards moved between piles fly and settle at
 * their new homes; a card picked up and tossed comes to rest and goes back home by itself; everything falls asleep.
 *   npx tsx src/three/table/physics.check.ts
 */
import RAPIER from '@dimforge/rapier3d-compat'
import { CITY_OUTLINE, SETTLEMENT_OUTLINE } from '../geometry.ts'
import { CITY, ROAD, SETTLEMENT } from '../spec.ts'
import { Table, type PileSpec, type Shapes } from './things.ts'

const prism = (o: [number, number][], d: number) => new Float32Array(o.flatMap(([x, y]) => [x, y, -d / 2, x, y, d / 2]))
const box = (w: number, h: number, d: number, x = 0) => prism([[x - w / 2, 0], [x + w / 2, 0], [x + w / 2, h], [x - w / 2, h]], d)
const shapes: Shapes = {
  card: { w: 54, d: 76, t: 0.9, small: 0.62 },
  hull: {
    settlement: [prism(SETTLEMENT_OUTLINE(), SETTLEMENT.d)],
    city: [prism(CITY_OUTLINE(), CITY.d)],
    road: [box(ROAD.len, ROAD.h, ROAD.w)],
    robber: [box(10, 10, 10)],
  },
}
await RAPIER.init()
const results: { what: string; ok: boolean; value: string }[] = []
const check = (what: string, ok: boolean, value: string) => results.push({ what, ok, value })

const t = new Table(shapes)
t.attach(RAPIER as never)
t.setStatics('base', [{ box: [5000, 50, 5000], at: [0, -50, 0] }])
let now = 0
const run = (s: number) => {
  for (let i = 0; i < s * 60; i++) {
    now += 1 / 60
    t.update(now, 1 / 60)
  }
}
const cards = (id: string, x: number, n: number): PileSpec => ({ id, kind: 'card', family: 'res', look: 'res:grain', n, home: (i) => ({ x, y: 0.45 + i * 0.9, z: 0, yaw: 0 }) })
const pieces: PileSpec[] = [
  { id: 'roads', kind: 'road', family: 'r', look: 'red', n: 9, home: (i) => { const layer = Math.floor(i / 3); const across = layer % 2 === 1; const off = ((i % 3) - 1) * 10; return { x: 300 + (across ? off : 0), y: layer * ROAD.h, z: across ? 0 : off, yaw: across ? Math.PI / 2 : 0 } } },
  { id: 'houses', kind: 'settlement', family: 's', look: 'red', n: 5, home: (i) => ({ x: 400 + i * 21, y: 0, z: 0, yaw: 0 }) },
  { id: 'cities', kind: 'city', family: 'c', look: 'red', n: 4, home: (i) => ({ x: 560 + i * 33, y: 0, z: 0, yaw: 0 }) },
]
const offHome = () => Math.max(...t.things.map((x) => (x.mode === 'settled' && x.kind === 'card' ? 0 : x.pose.p.distanceTo(x.home.p))))
const asleep = () => t.things.every((x) => !x.body || x.body.isSleeping()) && t.things.every((x) => x.mode === 'settled')

t.setPiles([cards('bank', -200, 19), cards('hand', 0, 0), ...pieces], now)
run(3)
check('laid out, everything stays put', offHome() < 1, `${offHome().toFixed(2)} mm off at most`)
check('and is asleep', asleep(), `${t.things.filter((x) => x.body && !x.body.isSleeping()).length} awake`)

t.setPiles([cards('bank', -200, 15), cards('hand', 0, 4), ...pieces], now)
run(0.2)
check('four cards are on their way', t.things.filter((x) => x.mode === 'fly').length === 4, `${t.things.filter((x) => x.mode === 'fly').length} flying`)
run(2)
const hand = t.things.filter((x) => x.pile === 'hand')
check('they land in the hand, settled', hand.length === 4 && hand.every((x) => x.mode === 'settled'), hand.map((x) => x.mode).join(','))
check('stacked up in order', hand.every((x) => Math.abs(x.stackY - (0.45 + x.slot * 0.9)) < 0.01), hand.map((x) => x.stackY.toFixed(2)).join(','))

// pick the top card off the hand, carry it off, toss it
const top = t.grab(hand[0])!
check('picking from a stack takes its top card', top.slot === 3, `slot ${top.slot}`)
for (let i = 0; i < 30; i++) {
  t.carry(150, 40, 120)
  run(1 / 60)
}
check('the hand carries it', top.pose.p.distanceTo({ x: 150, y: 40, z: 120 } as never) < 15, top.pose.p.toArray().map((v) => v.toFixed(0)).join(','))
t.release()
run(0.6)
check('let go, it falls to the table', top.pose.p.y < 2, `y ${top.pose.p.y.toFixed(2)}`)
run(3)
check('and goes back home by itself', top.mode === 'settled' && top.pile === 'hand' && Math.abs(top.stackY - (0.45 + 3 * 0.9)) < 0.01, `${top.mode}, y ${top.stackY.toFixed(2)}`)

// knock into the houses with a carried road
t.grab(t.things.find((x) => x.kind === 'road' && x.slot === 8)!)!
for (let i = 0; i < 60; i++) {
  t.carry(400 + (i / 60) * 120, 8, 0)
  run(1 / 60)
}
t.release()
run(0.5)
const moved = t.things.filter((x) => x.kind === 'settlement' && x.pose.p.distanceTo(x.home.p) > 3).length
check('a road shoved through the houses moves them', moved > 0, `${moved} moved`)
run(5)
check('then everything is home again', offHome() < 4.5, `${offHome().toFixed(2)} mm off at most`)
check('and asleep', asleep(), `${t.things.filter((x) => (x.body && !x.body.isSleeping()) || x.mode !== 'settled').map((x) => `${x.kind}:${x.mode}`).join(' ') || 'all'}`)

let bad = 0
for (const r of results) {
  if (!r.ok) bad++
  console.log(`${r.ok ? '✓' : '✗'} ${r.what}: ${r.value}`)
}
;(globalThis as unknown as { process: { exit: (n: number) => void } }).process.exit(bad ? 1 : 0)
