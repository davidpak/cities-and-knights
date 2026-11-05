/**
 * Every card on the table in one draw: a thin box per card (an instance), its top and bottom faces picking their
 * pictures out of the card atlas by instance (attribute aTiles: top cell, bottom cell), its edges plain paper.
 */
import { BoxGeometry, BufferAttribute, InstancedBufferAttribute, MeshLambertMaterial } from 'three'
import '../../lib/toy.ts'
import { ATLAS, EDGE_TILE, cardAtlas } from './faces.ts'

/** a unit box whose vertices know which side they're on (0 top, 1 bottom, 2 edge) */
export function cardGeometry() {
  const g = new BoxGeometry(1, 1, 1)
  // BoxGeometry's faces, 4 vertices each, in the order +x, -x, +y, -y, +z, -z
  const side = new Float32Array(24)
  for (let i = 0; i < 24; i++) side[i] = i >= 8 && i < 12 ? 0 : i >= 12 && i < 16 ? 1 : 2
  g.setAttribute('aSide', new BufferAttribute(side, 1))
  g.clearGroups()
  return g
}

export function cardTiles(capacity: number) {
  return new InstancedBufferAttribute(new Float32Array(capacity * 2), 2)
}

let material: MeshLambertMaterial | null = null
export function cardMaterial() {
  if (material) return material
  const m = new MeshLambertMaterial({ map: cardAtlas() })
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute float aSide;
        attribute vec2 aTiles;`,
      )
      .replace(
        '#include <uv_vertex>',
        `#include <uv_vertex>
        {
          float tile = aSide < 0.5 ? aTiles.x : (aSide < 1.5 ? aTiles.y : ${EDGE_TILE.toFixed(1)});
          vec2 cell = vec2(mod(tile, ${ATLAS.cols.toFixed(1)}), floor(tile / ${ATLAS.cols.toFixed(1)}));
          vec2 u = aSide > 1.5 ? vec2(0.5) : mix(vec2(0.006), vec2(0.994), uv);
          // the bottom face, seen when the card lies face down: printed so it reads the right way up
          if (aSide > 0.5 && aSide < 1.5) u = vec2(1.0) - u;
          vMapUv = vec2((cell.x + u.x) / ${ATLAS.cols.toFixed(1)}, 1.0 - (cell.y + 1.0 - u.y) / ${ATLAS.rows.toFixed(1)});
        }`,
      )
  }
  m.customProgramCacheKey = () => 'card-atlas'
  material = m
  return m
}

/** a material for instanced pictures out of one atlas (attribute aTile: which cell), e.g. the flip charts' pages */
export function atlasMaterial(map: import('three').Texture, cols: number, rows: number, key: string) {
  const m = new MeshLambertMaterial({ map, side: 2 })
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n        attribute float aTile;`)
      .replace(
        '#include <uv_vertex>',
        `#include <uv_vertex>
        {
          vec2 cell = vec2(mod(aTile, ${cols.toFixed(1)}), floor(aTile / ${cols.toFixed(1)}));
          vec2 u = mix(vec2(0.004), vec2(0.996), uv);
          vMapUv = vec2((cell.x + u.x) / ${cols.toFixed(1)}, 1.0 - (cell.y + 1.0 - u.y) / ${rows.toFixed(1)});
        }`,
      )
  }
  m.customProgramCacheKey = () => `atlas-${key}`
  return m
}
