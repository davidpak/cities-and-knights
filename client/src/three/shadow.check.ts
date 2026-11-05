/** The cheaper soft shadows (lib/toy.ts) still apply to this three.js: its five-sample shadows are replaced. */
import { ShaderChunk } from 'three'
import '../lib/toy.ts'
const s = ShaderChunk.shadowmap_pars_fragment
const ok = !s.includes('vogelDiskSample( 4, 5, phi ) * radius, shadowCoord.z ) )\n\t\t\t\t) * 0.2;') && s.includes('vec2 o = vec2( radius * 0.6 );')
console.log(`${ok ? '✓' : '✗'} soft shadows take four plain samples, not five turned ones`)
;(globalThis as unknown as { process: { exit: (n: number) => void } }).process.exit(ok ? 0 : 1)
