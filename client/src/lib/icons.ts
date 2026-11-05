/**
 * Resource icons, drawn once as 24 x 24 paths so the same shapes appear in the HUD (as SVG) and painted onto
 * harbour tokens in 3D (as canvas Path2D).
 */
import type { Resource } from '../../../shared/rules.ts'

const grain = () => {
  let d = 'M11.2 22V8.5h1.6V22z M12 2.5c1.6 1.2 1.6 3.6 0 4.8c-1.6-1.2-1.6-3.6 0-4.8z'
  for (const y of [0, 4, 8]) {
    d += ` M11.4 ${10 + y}c-2.2.2-3.8-1.4-3.6-3.6c2.2-.2 3.8 1.4 3.6 3.6z`
    d += ` M12.6 ${10 + y}c2.2.2 3.8-1.4 3.6-3.6c-2.2-.2-3.8 1.4-3.6 3.6z`
  }
  return d
}

export const ICON: Record<Resource, string> = {
  lumber: 'M12 1.5L5 10.5h3.5L4 16.5h6.5V22h3v-5.5H20l-4.5-6H19z',
  brick: 'M2 5h9v5.5H2z M13 5h9v5.5h-9z M2 12.5h4.5V18H2z M8.5 12.5h7V18h-7z M17.5 12.5H22V18h-4.5z',
  wool:
    'M6.5 9.2a3 3 0 0 1 4.6-2.4a3 3 0 0 1 4.8.6a3 3 0 0 1 2.4 4.9a3 3 0 0 1-2.6 4.2H8a3 3 0 0 1-3.2-3.1a3 3 0 0 1 1.7-4.2z ' +
    'M7.6 16h1.9v4.5H7.6z M14 16h1.9v4.5H14z M19.4 7.6a2.4 2.4 0 1 1 0 4.8a2.4 2.4 0 0 1 0-4.8z',
  grain: grain(),
  ore: 'M3.5 15l3.2-7.2L12 4.5l6.2 3.2 2.3 7.3-4.3 4.5H8z',
}

/** paints an icon into a canvas, centred at (x, y), `size` px across */
export function paintIcon(ctx: CanvasRenderingContext2D, r: Resource, x: number, y: number, size: number, color: string) {
  ctx.save()
  ctx.translate(x - size / 2, y - size / 2)
  ctx.scale(size / 24, size / 24)
  ctx.fillStyle = color
  ctx.fill(new Path2D(ICON[r]))
  ctx.restore()
}
