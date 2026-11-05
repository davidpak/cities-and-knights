/** The game's fixed numbers and names: what things cost, what's in the box. */

export const RESOURCES = ['lumber', 'brick', 'wool', 'grain', 'ore'] as const
export type Resource = (typeof RESOURCES)[number]
export type Hand = Record<Resource, number>

export const TERRAINS = ['forest', 'hills', 'pasture', 'fields', 'mountains', 'desert'] as const
export type Terrain = (typeof TERRAINS)[number]

export const YIELD: Record<Exclude<Terrain, 'desert'>, Resource> = {
  forest: 'lumber',
  hills: 'brick',
  pasture: 'wool',
  fields: 'grain',
  mountains: 'ore',
}

/** the 19 land tiles */
export const TILE_SET: Terrain[] = [
  ...Array<Terrain>(4).fill('forest'),
  ...Array<Terrain>(4).fill('pasture'),
  ...Array<Terrain>(4).fill('fields'),
  ...Array<Terrain>(3).fill('hills'),
  ...Array<Terrain>(3).fill('mountains'),
  'desert',
]

/** the 18 number tokens */
export const NUMBER_SET = [2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12]

/** harbours: four any-resource 3:1, one 2:1 for each resource */
export type HarborKind = Resource | 'any'
export const HARBOR_SET: HarborKind[] = ['any', 'any', 'any', 'any', ...RESOURCES]

export const COST = {
  road: { lumber: 1, brick: 1 },
  settlement: { lumber: 1, brick: 1, wool: 1, grain: 1 },
  city: { grain: 2, ore: 3 },
  card: { wool: 1, grain: 1, ore: 1 },
} satisfies Record<string, Partial<Hand>>
export type Buildable = keyof typeof COST

export const PIECES = { road: 15, settlement: 5, city: 4 }
export const BANK_EACH = 19
export const WIN_POINTS = 10
export const HAND_LIMIT = 7
export const LONGEST_ROAD_MIN = 5
export const LARGEST_ARMY_MIN = 3

export const CARDS = ['knight', 'roadBuilding', 'yearOfPlenty', 'monopoly', 'victoryPoint'] as const
export type Card = (typeof CARDS)[number]
export const CARD_SET: Card[] = [
  ...Array<Card>(14).fill('knight'),
  ...Array<Card>(5).fill('victoryPoint'),
  ...Array<Card>(2).fill('roadBuilding'),
  ...Array<Card>(2).fill('yearOfPlenty'),
  ...Array<Card>(2).fill('monopoly'),
]

export const CARD_NAME: Record<Card, string> = {
  knight: 'Knight',
  roadBuilding: 'Road Building',
  yearOfPlenty: 'Year of Plenty',
  monopoly: 'Monopoly',
  victoryPoint: 'Victory Point',
}
export const CARD_TEXT: Record<Card, string> = {
  knight: 'Move the robber and take a card from someone next to it.',
  roadBuilding: 'Build two roads for free.',
  yearOfPlenty: 'Take any two resources from the bank.',
  monopoly: 'Name a resource. Everyone gives you all of theirs.',
  victoryPoint: 'Worth one point. Kept hidden until you win.',
}

export const PLAYER_COLORS = ['red', 'blue', 'orange', 'white'] as const
export type PlayerColor = (typeof PLAYER_COLORS)[number]

export const emptyHand = (): Hand => ({ lumber: 0, brick: 0, wool: 0, grain: 0, ore: 0 })
export const handSize = (h: Hand) => RESOURCES.reduce((n, r) => n + h[r], 0)
export const hasAll = (h: Hand, need: Partial<Hand>) => RESOURCES.every((r) => h[r] >= (need[r] ?? 0))
export function addTo(h: Hand, d: Partial<Hand>, sign = 1) {
  for (const r of RESOURCES) h[r] += sign * (d[r] ?? 0)
}
