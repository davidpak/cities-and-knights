/**
 * Resource icons, drawn once as 24 x 24 paths so the same shapes appear in the HUD (as SVG) and painted onto
 * harbour tokens in 3D (as canvas Path2D).
 */
import type { Good } from '../../../shared/rules.ts'

const grain = () => {
  let d = 'M11.2 22V8.5h1.6V22z M12 2.5c1.6 1.2 1.6 3.6 0 4.8c-1.6-1.2-1.6-3.6 0-4.8z'
  for (const y of [0, 4, 8]) {
    d += ` M11.4 ${10 + y}c-2.2.2-3.8-1.4-3.6-3.6c2.2-.2 3.8 1.4 3.6 3.6z`
    d += ` M12.6 ${10 + y}c2.2.2 3.8-1.4 3.6-3.6c-2.2-.2-3.8 1.4-3.6 3.6z`
  }
  return d
}

export const ICON: Record<Good, string> = {
  lumber: 'M12 1.5L5 10.5h3.5L4 16.5h6.5V22h3v-5.5H20l-4.5-6H19z',
  brick: 'M2 5h9v5.5H2z M13 5h9v5.5h-9z M2 12.5h4.5V18H2z M8.5 12.5h7V18h-7z M17.5 12.5H22V18h-4.5z',
  wool:
    'M6.5 9.2a3 3 0 0 1 4.6-2.4a3 3 0 0 1 4.8.6a3 3 0 0 1 2.4 4.9a3 3 0 0 1-2.6 4.2H8a3 3 0 0 1-3.2-3.1a3 3 0 0 1 1.7-4.2z ' +
    'M7.6 16h1.9v4.5H7.6z M14 16h1.9v4.5H14z M19.4 7.6a2.4 2.4 0 1 1 0 4.8a2.4 2.4 0 0 1 0-4.8z',
  grain: grain(),
  ore: 'M3.5 15l3.2-7.2L12 4.5l6.2 3.2 2.3 7.3-4.3 4.5H8z',
  // the expansion's commodities: a scroll of paper, a bolt of cloth, a stack of coins
  paper: 'M6 3h10.5a2.5 2.5 0 0 1 0 5H18v11a2 2 0 0 1-2 2H6.5a2.5 2.5 0 0 1 0-5H6z M8.5 8v8h7V8z',
  cloth: 'M3 6.5c3-2 6 2 9 0s6-2 9 0v4c-3-2-6 2-9 0s-6-2-9 0z M3 13.5c3-2 6 2 9 0s6-2 9 0v4c-3-2-6 2-9 0s-6-2-9 0z',
  coin: 'M12 3.5c4.7 0 8.5 1.6 8.5 3.5S16.7 10.5 12 10.5 3.5 8.9 3.5 7 7.3 3.5 12 3.5z M3.5 9.6c1.6 1.4 4.8 2.4 8.5 2.4s6.9-1 8.5-2.4V12c0 1.9-3.8 3.5-8.5 3.5S3.5 13.9 3.5 12z M3.5 14.6c1.6 1.4 4.8 2.4 8.5 2.4s6.9-1 8.5-2.4V17c0 1.9-3.8 3.5-8.5 3.5S3.5 18.9 3.5 17z',
}

/** paints an icon into a canvas, centred at (x, y), `size` px across */
export function paintIcon(ctx: CanvasRenderingContext2D, r: Good, x: number, y: number, size: number, color: string) {
  ctx.save()
  ctx.translate(x - size / 2, y - size / 2)
  ctx.scale(size / 24, size / 24)
  ctx.fillStyle = color
  ctx.fill(new Path2D(ICON[r]))
  ctx.restore()
}

/** development card pictures, same 24 x 24 frame */
export const CARD_ICON: Record<import('../../../shared/rules.ts').Card, string> = {
  knight: 'M12 2l8 3v6c0 5-3.4 9-8 11c-4.6-2-8-6-8-11V5z',
  roadBuilding: 'M9.2 3h2l-.7 18H5.6z M12.8 3h2l3.6 18h-4.9z',
  yearOfPlenty: 'M10.5 3h3v7.5H21v3h-7.5V21h-3v-7.5H3v-3h7.5z',
  monopoly: 'M3 17.5h18V21H3z M3 15.5l1.6-9.5 4.6 4.6L12 3.5l2.8 7.1 4.6-4.6 1.6 9.5z',
  victoryPoint: 'M12 2l2.9 6.6 7.1.6-5.4 4.7 1.6 7.1L12 17.3 5.8 21l1.6-7.1L2 9.2l7.1-.6z',
}

/** the expansion's progress card pictures, same 24 x 24 frame */
export const PROGRESS_ICON: Record<import('../../../shared/rules.ts').Progress, string> = {
  trader: 'M12 2.5a3 3 0 1 1 0 6a3 3 0 0 1 0-6z M8 21l1.5-10h5L16 21z',
  charter: 'M6 3h10.5a2.5 2.5 0 0 1 0 5H18v11a2 2 0 0 1-2 2H6.5a2.5 2.5 0 0 1 0-5H6z M8.5 10h7v1.6h-7z M8.5 13.5h7v1.6h-7z',
  corner: 'M3 17.5h18V21H3z M3 15.5l1.6-9.5 4.6 4.6L12 3.5l2.8 7.1 4.6-4.6 1.6 9.5z',
  guild: 'M12 3.5c4.7 0 8.5 1.6 8.5 3.5S16.7 10.5 12 10.5 3.5 8.9 3.5 7 7.3 3.5 12 3.5z M3.5 9.6c1.6 1.4 4.8 2.4 8.5 2.4s6.9-1 8.5-2.4V12c0 1.9-3.8 3.5-8.5 3.5S3.5 13.9 3.5 12z',
  bargain: 'M3 8h12l-3-3 1.4-1.4L19 9l-5.6 5.4L12 13l3-3H3z M21 16H9l3 3-1.4 1.4L5 15l5.6-5.4L12 11l-3 3h12z',
  caravan: 'M2 8h13v8H2z M15 10h4l3 3v3h-7z M6 16.5a2 2 0 1 1 0 4a2 2 0 0 1 0-4z M18 16.5a2 2 0 1 1 0 4a2 2 0 0 1 0-4z',
  sheriff: 'M12 2l2.4 5 5.6.5-4.2 3.8 1.3 5.5L12 14l-5.1 2.8 1.3-5.5L4 7.5 9.6 7z M9 18h6v3H9z',
  townCharter: 'M12 2l2.9 6.6 7.1.6-5.4 4.7 1.6 7.1L12 17.3 5.8 21l1.6-7.1L2 9.2l7.1-.6z',
  turncoat: 'M12 2l8 3v6c0 5-3.4 9-8 11z M12 2v20c-4.6-2-8-6-8-11V5z',
  envoy: 'M9.2 3h2l-.7 18H5.6z M12.8 3h2l3.6 18h-4.9z',
  ruse: 'M2 9c3-3 7-3 10 0c3-3 7-3 10 0c-1 5-4 7-6 7c-2 0-3-2-4-2s-2 2-4 2c-2 0-5-2-6-7z M7 10.5a1.5 1.5 0 1 0 0 3a1.5 1.5 0 0 0 0-3z M17 10.5a1.5 1.5 0 1 0 0 3a1.5 1.5 0 0 0 0-3z',
  unrest: 'M12 2c1 4 6 6 6 12a6 6 0 0 1-12 0c0-3 2-5 3-6c0 2 1 3 2 3c0-3-1-5 1-9z',
  spy: 'M1.5 12C4 7 8 5 12 5s8 2 10.5 7C20 17 16 19 12 19S4 17 1.5 12z M12 8a4 4 0 1 0 0 8a4 4 0 0 0 0-8z',
  rally: 'M5 2h2v20H5z M7 3h12l-3 4 3 4H7z',
  feast: 'M5 3h14l-1.5 7a5.5 5.5 0 0 1-11 0z M11 15.5h2V19h3v2H8v-2h3z',
  augury: 'M4 4h16v16H4z M8 6.5a1.5 1.5 0 1 0 0 3a1.5 1.5 0 0 0 0-3z M16 14.5a1.5 1.5 0 1 0 0 3a1.5 1.5 0 0 0 0-3z M12 10.5a1.5 1.5 0 1 0 0 3a1.5 1.5 0 0 0 0-3z',
  scaffold: 'M5 2h2.2v20H5z M16.8 2H19v20h-2.2z M7 5h10v2H7z M7 11h10v2H7z M7 17h10v2H7z',
  mason: 'M2 5h9v5.5H2z M13 5h9v5.5h-9z M2 12.5h4.5V18H2z M8.5 12.5h7V18h-7z M17.5 12.5H22V18h-4.5z',
  surveyor: 'M12 2l3 7-3 13-3-13z M3 11h18v2H3z',
  irrigation: 'M12 2c3 5 6 8.5 6 12a6 6 0 0 1-12 0c0-3.5 3-7 6-12z',
  mining: 'M3 7c5-5 13-5 18 0l-1.2 1.6C15.5 5 8.5 5 4.2 8.6z M11 6h2v16h-2z',
  physician: 'M9 3h6v6h6v6h-6v6H9v-6H3V9h6z',
  press: 'M3 4h7a3 3 0 0 1 2 1a3 3 0 0 1 2-1h7v15h-7a2 2 0 0 0-2 2a2 2 0 0 0-2-2H3z',
  roadCrew: 'M5 3h2l-1 18H2z M10 3h2l-.5 18H8z M14 3h2l1 18h-3.5z M19 3h2l3 18h-3.5z',
  smith: 'M3 9h13l5 3H8v3h3v2H4v-2h2v-3H3z M10 4h3v5h-3z',
}
/** the knight's shield, for the defender card and the expansion's lines */
export const SHIELD = 'M12 2l8 3v6c0 5-3.4 9-8 11c-4.6-2-8-6-8-11V5z'
