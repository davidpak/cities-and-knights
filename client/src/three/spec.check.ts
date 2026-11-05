declare const process: { exit(code: number): never }
import { SEA, checkBoard } from './spec.ts'
import { checkLayouts } from './table/layout.ts'
const r = [...checkBoard(), ...checkLayouts(SEA.inner + SEA.rim)]
for (const c of r) console.log(`${c.ok ? '✓' : '✗'} ${c.what}: ${c.value}`)
process.exit(r.every((c) => c.ok) ? 0 : 1)
