import { layoutFor } from './table/layout.ts'
const F = 344
const inFrame = (x: number, z: number) => Math.abs(z) <= (Math.sqrt(3) / 2) * F && Math.sqrt(3) * Math.abs(x) + Math.abs(z) <= Math.sqrt(3) * F
for (const a of [1.6, 0.46]) { const R = layoutFor(4, 0, a, true).k!.raid; console.log(a, R.len.toFixed(0), R.wid.toFixed(0), R.corners.map(([x, z]) => `(${x.toFixed(0)},${z.toFixed(0)}) ${inFrame(x, z)}`).join(' ')) }
