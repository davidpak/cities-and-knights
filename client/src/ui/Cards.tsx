/**
 * Printed game components: resource cards (a coloured picture panel inside a cream border, the name on a strip),
 * development cards, card backs, cost chips and little piece icons. Everything here reads as a physical thing on a
 * table: ink outlines, hard shadows, no glass and no glow.
 */
import { CARD_NAME, CARD_TEXT, RESOURCES, type Card, type Hand, type Resource } from '../../../shared/rules.ts'
import { CARD_ICON, ICON } from '../lib/icons.ts'
import { RESOURCE_COLOR, RESOURCE_NAME } from '../lib/palette.ts'

export function Icon({ r, size = 18, color }: { r: Resource; size?: number; color?: string }) {
  return (
    <svg className="icon" width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      <path d={ICON[r]} fill={color ?? RESOURCE_COLOR[r]} />
    </svg>
  )
}

/** little piece silhouettes, for build buttons and the chronicle */
const PIECE: Record<'road' | 'settlement' | 'city' | 'card', string> = {
  road: 'M2 15.5l17-8 3 3.2-17 8z',
  settlement: 'M5 21V11l7-6.5 7 6.5v10z',
  city: 'M2 21V12.5l5.5-5 5.5 5V9.5l4.5-4 4.5 4V21z',
  card: 'M6 3h12a1.5 1.5 0 0 1 1.5 1.5v15A1.5 1.5 0 0 1 18 21H6a1.5 1.5 0 0 1-1.5-1.5v-15A1.5 1.5 0 0 1 6 3zm6 4.5l-3 4.5 3 4.5 3-4.5z',
}
export function PieceIcon({ what, size = 20, color = 'currentColor' }: { what: keyof typeof PIECE; size?: number; color?: string }) {
  return (
    <svg className="icon" width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      <path d={PIECE[what]} fill={color} stroke="#2a1d13" strokeWidth="1.4" strokeLinejoin="round" />
    </svg>
  )
}

/** one resource card; more than one shows as a stack with a stamped count */
export function ResourceCard({
  r,
  n = 1,
  onClick,
  small,
  title,
  ghost,
}: {
  r: Resource
  n?: number
  onClick?: () => void
  small?: boolean
  title?: string
  /** an empty slot: none of this kind */
  ghost?: boolean
}) {
  const depth = Math.min(3, Math.max(0, n - 1))
  return (
    <button
      type="button"
      className={`rcard ${small ? 'small' : ''} ${ghost || n === 0 ? 'ghost' : ''} ${onClick ? 'live' : ''}`}
      style={{ ['--c' as string]: RESOURCE_COLOR[r], ['--depth' as string]: depth }}
      onClick={onClick}
      disabled={!onClick}
      title={title ?? RESOURCE_NAME[r]}
    >
      <span className="rcard-face">
        <Icon r={r} size={small ? 20 : 30} color="#fffaf0" />
      </span>
      {!small && <span className="rcard-name">{RESOURCE_NAME[r]}</span>}
      {n > 1 && <span className="stamp">{n}</span>}
    </button>
  )
}

/** a row of cards, one per resource held (or all five, the missing ones as empty slots) */
export function CardRow({ hand, all, onPick, small, fan }: { hand: Partial<Hand>; all?: boolean; onPick?: (r: Resource) => void; small?: boolean; fan?: boolean }) {
  const shown = RESOURCES.filter((r) => all || (hand[r] ?? 0) > 0)
  return (
    <div className={`card-row ${fan ? 'fan' : ''}`}>
      {shown.map((r, i) => (
        <span key={r} className="fan-slot" style={{ ['--i' as string]: i - (shown.length - 1) / 2 }}>
          <ResourceCard r={r} n={hand[r] ?? 0} small={small} onClick={onPick && (hand[r] ?? 0) > 0 ? () => onPick(r) : undefined} />
        </span>
      ))}
    </div>
  )
}

export function DevCard({ card, n, ready, onPlay }: { card: Card; n: number; ready: boolean; onPlay?: () => void }) {
  return (
    <button
      type="button"
      className={`dcard ${card} ${onPlay ? 'live' : ''}`}
      onClick={onPlay}
      disabled={!onPlay}
      title={`${CARD_NAME[card]}: ${CARD_TEXT[card]}${ready ? '' : ' (bought this turn: play it next turn)'}`}
    >
      <span className="dcard-face">
        <svg className="icon" width={26} height={26} viewBox="0 0 24 24" aria-hidden>
          <path d={CARD_ICON[card]} fill="#fffaf0" />
        </svg>
      </span>
      <span className="dcard-name">{CARD_NAME[card]}</span>
      {n > 1 && <span className="stamp">{n}</span>}
      {onPlay && <span className="play-tab">Play</span>}
    </button>
  )
}

/** what something costs, as tiny resource cards */
export function Cost({ of }: { of: Partial<Hand> }) {
  return (
    <span className="cost">
      {RESOURCES.flatMap((r) =>
        Array.from({ length: of[r] ?? 0 }, (_, i) => <span key={`${r}${i}`} className="chip" style={{ background: RESOURCE_COLOR[r] }} title={RESOURCE_NAME[r]} />),
      )}
    </span>
  )
}

/** a bundle of cards in a sentence: 2 [wool] 1 [ore] */
export function Bundle({ of, empty = 'nothing' }: { of: Partial<Hand>; empty?: string }) {
  const rs = RESOURCES.filter((r) => (of[r] ?? 0) > 0)
  if (!rs.length) return <span className="bundle muted">{empty}</span>
  return (
    <span className="bundle">
      {rs.map((r) => (
        <span key={r} className="bundle-item" title={`${of[r]} ${RESOURCE_NAME[r]}`}>
          <b>{of[r]}</b>
          <Icon r={r} size={15} />
        </span>
      ))}
    </span>
  )
}

/** a die face drawn flat (for the chronicle and the announcer) */
export function Pips({ v, size = 18 }: { v: number; size?: number }) {
  return (
    <span className={`pips d${v}`} style={{ width: size, height: size }}>
      {Array.from({ length: v }, (_, k) => (
        <i key={k} />
      ))}
    </span>
  )
}

/** a pile of face-down cards with how many */
export function Backs({ n, kind = 'res', title }: { n: number; kind?: 'res' | 'dev'; title?: string }) {
  return (
    <span className={`backs ${kind}`} title={title}>
      <span className="back" style={{ ['--depth' as string]: Math.min(3, Math.max(0, n - 1)) }} />
      <b>{n}</b>
    </span>
  )
}
