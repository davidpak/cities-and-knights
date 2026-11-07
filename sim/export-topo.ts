// Writes the board's layout (and the rules' fixed sets) for the Rust simulator: npx tsx sim/export-topo.ts
import { writeFileSync } from 'node:fs'
import { TOPO } from '../shared/board.ts'
import { CARD_SET, HARBOR_SET, NUMBER_SET, TILE_SET } from '../shared/rules.ts'
const out = {
  hexes: TOPO.hexes.map((h) => ({ vertices: h.vertices, neighbors: h.neighbors })),
  vertices: TOPO.vertices.map((v) => ({ hexes: v.hexes, neighbors: v.neighbors, edges: v.edges })),
  edges: TOPO.edges.map((e) => [e.a, e.b]),
  harbors: TOPO.harbors,
  tileSet: TILE_SET,
  numberSet: NUMBER_SET,
  harborSet: HARBOR_SET,
  cardSet: CARD_SET,
}
writeFileSync(new URL('./topo.json', import.meta.url), JSON.stringify(out))
console.log('hexes', out.hexes.length, 'vertices', out.vertices.length, 'edges', out.edges.length, 'harbors', out.harbors.length)
