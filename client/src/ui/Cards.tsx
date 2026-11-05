/**
 * Cards as cards: your resources as stacks you can see and count at a glance, development cards with what they do,
 * and small card-backs for what other players hold.
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

/** one resource as a card; a count over 1 shows as a stack with a badge */
export function ResourceCard({ r, n = 1, onClick, dim, small, title }: { r: Resource; n?: number; onClick?: () => void; dim?: boolean; small?: boolean; title?: string }) {
  const depth = Math.min(3, Math.max(0, n - 1))
  return (
    <button
      type="button"
      className={`card res ${small ? 'small' : ''} ${dim || n === 0 ? 'dim' : ''} ${onClick ? 'clickable' : ''}`}
      style={{ ['--c' as string]: RESOURCE_COLOR[r], ['--depth' as string]: depth }}
      onClick={onClick}
      disabled={!onClick}
      title={title ?? RESOURCE_NAME[r]}
    >
      <Icon r={r} size={small ? 20 : 30} color="#fff" />
      {!small && <span className="card-name">{RESOURCE_NAME[r]}</span>}
      {n > 1 && <span className="badge-n">{n}</span>}
    </button>
  )
}

/** a row of cards, one per resource held (or all five, greyed when none) */
export function CardRow({ hand, all, onPick, small }: { hand: Partial<Hand>; all?: boolean; onPick?: (r: Resource) => void; small?: boolean }) {
  return (
    <div className="card-row">
      {RESOURCES.filter((r) => all || (hand[r] ?? 0) > 0).map((r) => (
        <ResourceCard key={r} r={r} n={hand[r] ?? 0} small={small} onClick={onPick && (hand[r] ?? 0) > 0 ? () => onPick(r) : undefined} />
      ))}
    </div>
  )
}

export function DevCard({ card, n, ready, onPlay }: { card: Card; n: number; ready: boolean; onPlay?: () => void }) {
  return (
    <button type="button" className={`card dev ${card} ${onPlay ? 'clickable' : ''}`} onClick={onPlay} disabled={!onPlay} title={`${CARD_NAME[card]}: ${CARD_TEXT[card]}${ready ? '' : ' (bought this turn: play it next turn)'}`}>
      <svg className="icon" width={26} height={26} viewBox="0 0 24 24" aria-hidden>
        <path d={CARD_ICON[card]} fill="#fff" />
      </svg>
      <span className="card-name">{CARD_NAME[card]}</span>
      {n > 1 && <span className="badge-n">{n}</span>}
      {onPlay && <span className="play-tag">Play</span>}
    </button>
  )
}

/** a cost as small resource chips: 1 lumber 1 brick */
export function Cost({ of }: { of: Partial<Hand> }) {
  return (
    <span className="cost">
      {RESOURCES.flatMap((r) => Array.from({ length: of[r] ?? 0 }, (_, i) => <span key={`${r}${i}`} className="chip" style={{ background: RESOURCE_COLOR[r] }} title={RESOURCE_NAME[r]} />))}
    </span>
  )
}

/** a bundle in words with icons, for offers: 2 [wool] 1 [ore] */
export function Bundle({ of }: { of: Partial<Hand> }) {
  return (
    <span className="bundle">
      {RESOURCES.filter((r) => (of[r] ?? 0) > 0).map((r) => (
        <span key={r} className="bundle-item">
          <b>{of[r]}</b>
          <Icon r={r} size={16} />
        </span>
      ))}
    </span>
  )
}

export function Dice({ dice, rolling }: { dice: [number, number] | null; rolling: boolean }) {
  return (
    <div className={`dice ${rolling ? 'rolling' : ''}`} title={dice ? `Last roll: ${dice[0] + dice[1]}` : 'No roll yet'}>
      {(dice ?? [0, 0]).map((v, i) => (
        <div key={i} className={`die d${v}`}>
          {Array.from({ length: v }, (_, k) => (
            <i key={k} />
          ))}
        </div>
      ))}
      {dice && <span className="dice-total">{dice[0] + dice[1]}</span>}
    </div>
  )
}
