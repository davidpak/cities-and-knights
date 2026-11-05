/**
 * How hard the table works, chosen once per device (and overridable in the address for measuring:
 * ?dpr=1&aa=0&shadow=0&shmap=1024).
 *
 *   resolution    the screen's own pixel density, at most 2 (1.5 on a weak GPU); the game lowers it by itself if
 *                 frames run long (Adaptive.tsx), never below one pixel per CSS pixel (below that it's blurry),
 *                 remembers what this device managed, and starts there next time
 *   antialiasing  multisampling on ordinary screens (edges stay clean); not on a high-density screen, where the
 *                 pixels are too small to see stairs and multisampling would be the costliest thing to ask for
 *   shadows       one shadow map, drawn again only when something moves
 */
const q = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams()
const screenDpr = typeof devicePixelRatio !== 'undefined' ? devicePixelRatio : 1
const num = (k: string) => (q.has(k) ? Number(q.get(k)) : undefined)

/**
 * A weak GPU, by name (as PlayCanvas and others do): integrated Intel graphics, phone and tablet GPUs, and software
 * renderers. These get the cheapest soft shadows and a smaller shadow map, and at most one and a half pixels per CSS
 * pixel; the frame-time watcher (Adaptive.tsx) takes them lower if it must.
 */
function gpuName() {
  try {
    const c = document.createElement('canvas')
    const gl = c.getContext('webgl2') ?? c.getContext('webgl')
    if (!gl) return ''
    const ext = gl.getExtension('WEBGL_debug_renderer_info')
    const name = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER))
    gl.getExtension('WEBGL_lose_context')?.loseContext()
    return name
  } catch {
    return ''
  }
}
const GPU = typeof document !== 'undefined' ? gpuName() : ''
const weak = q.has('weak') ? q.get('weak') === '1' : /intel|hd graphics|uhd|iris|mali|adreno|powervr|videocore|swiftshader|llvmpipe|software|basic render/i.test(GPU) && !/arc/i.test(GPU)

let learned: number | undefined
try {
  const v = Number(localStorage.getItem('tp.dpr2'))
  if (v > 0) learned = v
} catch {
  // private window: start from the top each time
}

const top = Math.min(screenDpr, weak ? 1.5 : 2)
export const QUALITY = {
  gpu: GPU,
  weak,
  /** the most pixels per CSS pixel worth drawing here */
  maxDpr: num('dpr') ?? top,
  /** where to start (what this device managed last time) */
  startDpr: num('dpr') ?? Math.min(top, learned ?? top),
  /** never below this */
  minDpr: num('dpr') ?? Math.min(screenDpr, 1),
  antialias: q.has('aa') ? q.get('aa') === '1' : screenDpr < 1.5,
  shadows: q.get('shadow') !== '0',
  shadowSize: num('shmap') ?? (weak ? 1024 : 2048),
  /** samples per pixel for soft shadows: 4 (each hardware-filtered), or 1 on a weak GPU */
  shadowTaps: num('taps') ?? (weak ? 1 : 4),
  /** texture filtering at a slant (the table is seen nearly from above: a little is plenty) */
  aniso: weak ? 4 : 8,
  /** adapt the resolution to the frame time (off when it's pinned in the address) */
  adapt: !q.has('dpr'),
}

export function rememberDpr(dpr: number) {
  try {
    localStorage.setItem('tp.dpr2', dpr.toFixed(2))
  } catch {
    // nowhere to keep it
  }
}
