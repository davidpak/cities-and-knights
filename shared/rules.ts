/** The game's fixed numbers and names: what things cost, what's in the box. */

export const RESOURCES = ['lumber', 'brick', 'wool', 'grain', 'ore'] as const
export type Resource = (typeof RESOURCES)[number]
/** the expansion's commodities: what a city makes besides its resource (paper from forest, cloth from pasture,
 *  coin from mountains). In the base game nobody ever has any. */
export const COMMODITIES = ['paper', 'cloth', 'coin'] as const
export type Commodity = (typeof COMMODITIES)[number]
/** every kind of card that goes in a hand */
export const GOODS = [...RESOURCES, ...COMMODITIES] as const
export type Good = (typeof GOODS)[number]
export type Hand = Record<Good, number>
export const isResource = (g: string): g is Resource => (RESOURCES as readonly string[]).includes(g)
export const isCommodity = (g: string): g is Commodity => (COMMODITIES as readonly string[]).includes(g)
export const isGood = (g: string): g is Good => (GOODS as readonly string[]).includes(g)

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
  knight: 'Move the robber. Steal 1 card from a player beside it.',
  roadBuilding: 'Build 2 roads, free.',
  yearOfPlenty: 'Take any 2 resources from the bank.',
  monopoly: 'Name a resource. Every player gives you all of it.',
  victoryPoint: '+1 point.',
}

export const PLAYER_COLORS = ['red', 'blue', 'orange', 'white'] as const
export type PlayerColor = (typeof PLAYER_COLORS)[number]

export const emptyHand = (): Hand => ({ lumber: 0, brick: 0, wool: 0, grain: 0, ore: 0, paper: 0, cloth: 0, coin: 0 })
export const handSize = (h: Partial<Hand>) => GOODS.reduce((n, r) => n + (h[r] ?? 0), 0)
export const hasAll = (h: Hand, need: Partial<Hand>) => GOODS.every((r) => h[r] >= (need[r] ?? 0))
export function addTo(h: Hand, d: Partial<Hand>, sign = 1) {
  for (const r of GOODS) h[r] += sign * (d[r] ?? 0)
}
/** a whole hand from a partial one */
export const fullHand = (d: Partial<Hand>): Hand => ({ ...emptyHand(), ...d })

// ---------------------------------------------------------------- the expansion: knights, barbarians, cities that grow

export const KNIGHT_POINTS = 13
export const COMMODITY_EACH = 12
/** what a city on a terrain makes: its resource and, on three terrains, a commodity instead of a second resource */
export const CITY_YIELD: Record<Exclude<Terrain, 'desert'>, Partial<Hand>> = {
  forest: { lumber: 1, paper: 1 },
  pasture: { wool: 1, cloth: 1 },
  mountains: { ore: 1, coin: 1 },
  hills: { brick: 2 },
  fields: { grain: 2 },
}
export const KNIGHT_COST = {
  knight: { wool: 1, ore: 1 },
  promote: { wool: 1, ore: 1 },
  activate: { grain: 1 },
  wall: { brick: 2 },
} satisfies Record<string, Partial<Hand>>
export const KNIGHT_PIECES = { 1: 2, 2: 2, 3: 2 } as const
export const WALLS = 3
export const PROGRESS_LIMIT = 4
/** the barbarians' ship needs this many steps to reach the island */
export const BARBARIAN_STEPS = 7
export const HAND_LIMIT_PER_WALL = 2

/** the three ways a city grows, each paid in its own commodity, each with its own pile of progress cards */
export const TRACKS = ['trade', 'politics', 'science'] as const
export type Track = (typeof TRACKS)[number]
export const TRACK_GOOD: Record<Track, Commodity> = { trade: 'cloth', politics: 'coin', science: 'paper' }
export const TRACK_NAME: Record<Track, string> = { trade: 'Trade', politics: 'Politics', science: 'Science' }
/** what each level of a track is called, and what reaching level 3 gives */
export const TRACK_LEVELS: Record<Track, string[]> = {
  trade: ['Market', 'Guild hall', 'Counting house', 'Exchange', 'Bourse'],
  politics: ['Town hall', 'Watch house', 'Keep', 'Senate', 'High court'],
  science: ['School', 'Library', 'Waterworks', 'College', 'Observatory'],
}
export const TRACK_PERK: Record<Track, string> = {
  trade: 'Trade commodities with the bank 2 for 1.',
  politics: 'Your knights can be raised to the third strength.',
  science: 'When a roll brings you nothing, take a resource you choose.',
}
export const MAX_LEVEL = 5
/** the event die: three faces are the barbarians' ship, three are a gate in each track's colour */
export const EVENT_FACES = ['ship', 'ship', 'ship', 'trade', 'politics', 'science'] as const
export type EventFace = (typeof EVENT_FACES)[number]

/** progress cards: our own set, each doing one plain thing */
export const PROGRESS = {
  // trade
  trader: { track: 'trade', count: 6, name: 'Trader', text: 'Place the trader by your town. Its resource trades 2:1. +1 point while yours.' },
  charter: { track: 'trade', count: 2, name: 'Charter', text: 'This turn, one card type trades 2:1 with the bank.' },
  corner: { track: 'trade', count: 4, name: 'Corner the Market', text: 'Name a resource. Each player gives you 2 of it.' },
  guild: { track: 'trade', count: 2, name: 'Guild Order', text: 'Name a commodity. Each player gives you 1.' },
  bargain: { track: 'trade', count: 2, name: 'Hard Bargain', text: 'Take 2 random cards from a player with more points.' },
  caravan: { track: 'trade', count: 2, name: 'Caravan', text: 'Each player gives you 1 random commodity.' },
  // politics
  sheriff: { track: 'politics', count: 2, name: 'Sheriff', text: 'Move the robber. Take 1 random card from each player beside it.' },
  townCharter: { track: 'politics', count: 1, name: 'Town Charter', text: '+1 point.' },
  turncoat: { track: 'politics', count: 2, name: 'Turncoat', text: "Remove an opponent's knight. Place one of yours, same strength, free." },
  envoy: { track: 'politics', count: 2, name: 'Envoy', text: 'Remove an open-ended road. Its owner gets it back.' },
  ruse: { track: 'politics', count: 2, name: 'Ruse', text: "Displace an opponent's knight on your roads." },
  unrest: { track: 'politics', count: 2, name: 'Unrest', text: 'Players with at least your points discard half their cards.' },
  spy: { track: 'politics', count: 3, name: 'Spy', text: 'Take a random progress card from a player.' },
  rally: { track: 'politics', count: 2, name: 'Rally', text: 'Activate all your knights, free.' },
  feast: { track: 'politics', count: 2, name: 'Feast', text: 'Each player with more points gives you 2 random cards.' },
  // science
  augury: { track: 'science', count: 2, name: 'Augury', text: 'Before rolling: choose the roll.' },
  scaffold: { track: 'science', count: 2, name: 'Scaffold', text: 'This turn, your next city improvement costs 1 commodity less.' },
  mason: { track: 'science', count: 1, name: 'Mason', text: 'Build a city wall, free.' },
  surveyor: { track: 'science', count: 2, name: 'Surveyor', text: 'Swap two number tokens (not 2, 6, 8 or 12).' },
  irrigation: { track: 'science', count: 2, name: 'Irrigation', text: '+2 grain for each fields tile by your towns.' },
  mining: { track: 'science', count: 2, name: 'Mining', text: '+2 ore for each mountains tile by your towns.' },
  physician: { track: 'science', count: 2, name: 'Physician', text: 'Upgrade a settlement to a city for 2 ore, 1 grain.' },
  press: { track: 'science', count: 1, name: 'Printing Press', text: '+1 point.' },
  roadCrew: { track: 'science', count: 2, name: 'Road Crew', text: 'Build 2 roads, free.' },
  smith: { track: 'science', count: 2, name: 'Smith', text: 'Upgrade 2 knights, free.' },
} as const satisfies Record<string, { track: Track; count: number; name: string; text: string }>
export type Progress = keyof typeof PROGRESS
export const PROGRESS_CARDS = Object.keys(PROGRESS) as Progress[]
/** cards laid down at once for a point (they don't count toward the four you may hold) */
export const PROGRESS_POINTS: Progress[] = ['townCharter', 'press']
