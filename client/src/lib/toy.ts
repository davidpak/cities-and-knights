/**
 * The toy shading from the playbook (gf-room's lib/stylize): Lambert with a wide wrap, so light rolls softly
 * round every form with no hard edge and no shine. Every material in the game is a MeshLambertMaterial, so this one
 * patch covers them all.
 */
import { MeshLambertMaterial, ShaderChunk, type Side, type Texture } from 'three'
import { QUALITY } from '../three/quality.ts'

ShaderChunk.lights_lambert_pars_fragment = ShaderChunk.lights_lambert_pars_fragment.replace(
  'float dotNL = saturate( dot( geometryNormal, directLight.direction ) );',
  'float dotNL = smoothstep( -0.35, 1.0, dot( geometryNormal, directLight.direction ) );',
)

/**
 * Cheaper soft shadows. three.js's own takes five samples per pixel, each with a sine, a cosine and a noise term
 * (a heavy price on a weak GPU, paid for every pixel on screen). These take four fixed samples, each filtered by the
 * hardware (so sixteen texels in all, the same softness) with no trigonometry, or on a weak GPU one filtered sample.
 */
const FIVE_TAPS = `shadow = (
					texture( shadowMap, vec3( shadowCoord.xy + vogelDiskSample( 0, 5, phi ) * radius, shadowCoord.z ) ) +
					texture( shadowMap, vec3( shadowCoord.xy + vogelDiskSample( 1, 5, phi ) * radius, shadowCoord.z ) ) +
					texture( shadowMap, vec3( shadowCoord.xy + vogelDiskSample( 2, 5, phi ) * radius, shadowCoord.z ) ) +
					texture( shadowMap, vec3( shadowCoord.xy + vogelDiskSample( 3, 5, phi ) * radius, shadowCoord.z ) ) +
					texture( shadowMap, vec3( shadowCoord.xy + vogelDiskSample( 4, 5, phi ) * radius, shadowCoord.z ) )
				) * 0.2;`
const NOISE = 'float phi = interleavedGradientNoise( gl_FragCoord.xy ) * PI2;'
const chunk = ShaderChunk.shadowmap_pars_fragment
if (chunk.includes(FIVE_TAPS) && chunk.includes(NOISE)) {
  const taps = QUALITY.shadowTaps === 1
    ? 'shadow = texture( shadowMap, shadowCoord.xyz );'
    : `vec2 o = vec2( radius * 0.6 );
				shadow = (
					texture( shadowMap, vec3( shadowCoord.xy + vec2( -o.x, -o.y ), shadowCoord.z ) ) +
					texture( shadowMap, vec3( shadowCoord.xy + vec2( o.x, -o.y ), shadowCoord.z ) ) +
					texture( shadowMap, vec3( shadowCoord.xy + vec2( -o.x, o.y ), shadowCoord.z ) ) +
					texture( shadowMap, vec3( shadowCoord.xy + vec2( o.x, o.y ), shadowCoord.z ) )
				) * 0.25;`
  ShaderChunk.shadowmap_pars_fragment = chunk.replace(NOISE, '').replace(FIVE_TAPS, taps)
}

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
