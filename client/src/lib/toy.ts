/**
 * The toy shading from the playbook (gf-room's lib/stylize): Lambert with a wide wrap, so light rolls softly
 * round every form with no hard edge and no shine. Every material in the game is a MeshLambertMaterial, so this one
 * patch covers them all.
 */
import { MeshLambertMaterial, ShaderChunk, type Side, type Texture } from 'three'

ShaderChunk.lights_lambert_pars_fragment = ShaderChunk.lights_lambert_pars_fragment.replace(
  'float dotNL = saturate( dot( geometryNormal, directLight.direction ) );',
  'float dotNL = smoothstep( -0.35, 1.0, dot( geometryNormal, directLight.direction ) );',
)

const cache = new Map<string, MeshLambertMaterial>()

/** a shared matte material */
export function mat(color: string, opts: { map?: Texture; opacity?: number; side?: Side } = {}) {
  const key = `${color}|${opts.map?.uuid ?? ''}|${opts.opacity ?? 1}|${opts.side ?? 0}`
  let m = cache.get(key)
  if (!m) {
    m = new MeshLambertMaterial({ color })
    if (opts.map) m.map = opts.map
    if (opts.side !== undefined) m.side = opts.side
    if (opts.opacity !== undefined && opts.opacity < 1) {
      m.transparent = true
      m.opacity = opts.opacity
      m.depthWrite = false
    }
    cache.set(key, m)
  }
  return m
}
