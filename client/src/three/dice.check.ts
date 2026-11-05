/** Real throws of the dice: every one lands flat in the tray, showing what was rolled. npx tsx src/three/dice.check.ts */
import RAPIER from '@dimforge/rapier3d-compat'
import { Quaternion, Vector3 } from 'three'
import { throwDice } from './diceSim.ts'
import { DIE_FACES } from './geometry.ts'
import { DICE } from './spec.ts'

await RAPIER.init()
const NORMALS = [new Vector3(1, 0, 0), new Vector3(-1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, -1, 0), new Vector3(0, 0, 1), new Vector3(0, 0, -1)]
let bad = 0
let frames = 0
const t0 = performance.now()
for (let roll = 1; roll <= 30; roll++) {
  const values: [number, number] = [((roll * 7) % 6) + 1, ((roll * 11) % 6) + 1]
  const at: [number, number] = [528, 232]
  const th = throwDice(RAPIER as never, roll, at, values)
  frames += th.count
  const last = (th.count - 1) * 14
  for (let i = 0; i < 2; i++) {
    const f = th.frames.subarray(last + i * 7, last + i * 7 + 7)
    const q = new Quaternion(f[3], f[4], f[5], f[6]).multiply(th.fix[i])
    let shown = 0
    let best = -2
    NORMALS.forEach((n, k) => {
      const d = n.clone().applyQuaternion(q).y
      if (d > best) (best = d), (shown = DIE_FACES[k])
    })
    const inTray = Math.abs(f[0] - at[0]) < DICE.tray.w / 2 && Math.abs(f[2] - at[1]) < DICE.tray.d / 2
    if (shown !== values[i] || best < 0.98 || !inTray) {
      bad++
      console.log(`✗ roll ${roll} die ${i}: shows ${shown} (wanted ${values[i]}), flat ${best.toFixed(3)}, in tray ${inTray}`)
    }
  }
}
const ms = (performance.now() - t0) / 30
console.log(`${bad ? '✗' : '✓'} 30 throws land flat in the tray showing the roll (${(frames / 30 / 60).toFixed(2)} s each on average, ${ms.toFixed(1)} ms to work out)`)
;(globalThis as unknown as { process: { exit: (n: number) => void } }).process.exit(bad ? 1 : 0)
