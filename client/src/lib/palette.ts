/**
 * Every colour in the game, in one short list. The toy look comes from the playbook: matte, warm local colours,
 * darks that are plum and never black. Terrain colours are chosen first for telling tiles apart at a glance
 * (forest dark green, pasture light green, fields gold, hills terracotta, mountains slate, desert sand).
 */
import type { Good, PlayerColor, Terrain } from '../../../shared/rules.ts'

export const GAME_NAME = 'Towns and Peasants'

export const PAL = {
  plum: '#3d3656', // the darks: text on tokens
  robber: '#55505c', // a dark grey pawn
  ink: '#22170f', // outlines round pieces
  felt: '#2f5a4a', // the dice tray's floor
  plumDeep: '#2b2538', // UI plates
  cream: '#fff4e6', // UI text, tokens
  creamDeep: '#f1e2cc', // token rims
  peach: '#ffd6a0', // UI accents
  honey: '#d9a877', // the table
  honeyDeep: '#b9875c',
  maple: '#e7b98a', // the frame round the sea
  mapleDeep: '#c99464',
  sea: '#78b4c6',
  seaDeep: '#5e97ad',
  red: '#c8453c', // 6 and 8 on the tokens
  bg: '#1c2230', // behind the board (the page's own background)
  bgLow: '#4a3a62',
} as const

/** each tile: its ground, its sides, and the colours of what stands on it */
export const TERRAIN: Record<Terrain, { top: string; side: string; a: string; b: string; c: string }> = {
  forest: { top: '#5f9a5c', side: '#4a7a49', a: '#2f6a43', b: '#3f7f4c', c: '#8a5e3c' }, // canopy dark, canopy light, trunk
  pasture: { top: '#a8d27a', side: '#86ad5e', a: '#fbf6ee', b: '#4a4060', c: '#8fc263' }, // sheep, sheep face, tufts
  fields: { top: '#e8c262', side: '#c49d47', a: '#f3d27a', b: '#d9a94a', c: '#b98838' }, // wheat light, wheat, sheaf tie
  hills: { top: '#d48a5e', side: '#ae6c46', a: '#b8573a', b: '#e0a07a', c: '#9c4a33' }, // brick, mound light, brick dark
  mountains: { top: '#9a9aae', side: '#7c7b92', a: '#8a879f', b: '#b5b3c5', c: '#fbf6ee' }, // rock, rock light, snow
  desert: { top: '#ead2a0', side: '#cdb27f', a: '#e0c38c', b: '#8fb069', c: '#cfae78' }, // dune, cactus, stone
}

/** pieces: clear and distinct first, still matte and warm */
export const PLAYER: Record<PlayerColor, { body: string; roof: string; ui: string }> = {
  red: { body: '#e0574c', roof: '#b23e37', ui: '#d9534a' },
  blue: { body: '#4f7fd8', roof: '#3a62b0', ui: '#4a78cf' },
  orange: { body: '#f2a43a', roof: '#d07f22', ui: '#e8952c' },
  white: { body: '#f4efe6', roof: '#cfc6d8', ui: '#d8d0c4' },
}

export const RESOURCE_COLOR: Record<Good, string> = {
  lumber: '#3f7f4c',
  brick: '#c4643f',
  wool: '#9ccd6e',
  grain: '#e5b94e',
  ore: '#8f8ca6',
  // a commodity takes its tile's colour (paper from forest, cloth from pasture, coin from mountains)
  paper: '#3f7f4c',
  cloth: '#9ccd6e',
  coin: '#8f8ca6',
}

export const RESOURCE_NAME: Record<Good, string> = {
  lumber: 'Lumber',
  brick: 'Brick',
  wool: 'Wool',
  grain: 'Grain',
  ore: 'Ore',
  paper: 'Paper',
  cloth: 'Cloth',
  coin: 'Coin',
}

/** the expansion's three tracks: trade (yellow), politics (blue), science (green) */
export const TRACK_COLOR = { trade: '#e2b33c', politics: '#3f6fc0', science: '#4c9a4f' } as const
