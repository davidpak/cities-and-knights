declare const process: { exit(code: number): never }
import { checkBoard } from './spec.ts'
const r = checkBoard()
for (const c of r) console.log(`${c.ok ? '✓' : '✗'} ${c.what}: ${c.value}`)
process.exit(r.every((c) => c.ok) ? 0 : 1)
