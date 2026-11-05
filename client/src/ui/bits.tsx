import { RESOURCES, type Hand, type Resource } from '../../../shared/rules.ts'
import { ICON } from '../lib/icons.ts'
import { RESOURCE_COLOR, RESOURCE_NAME } from '../lib/palette.ts'

export function Icon({ r, size = 20 }: { r: Resource; size?: number }) {
  return (
    <svg className="icon" width={size} height={size} viewBox="0 0 24 24" aria-label={RESOURCE_NAME[r]}>
      <path d={ICON[r]} fill={RESOURCE_COLOR[r]} />
    </svg>
  )
}

/** a cost or a bundle of cards, as icons with counts: e.g. 1 lumber 1 brick */
export function Cost({ of }: { of: Partial<Hand> }) {
  return (
    <span className="cost">
      {RESOURCES.filter((r) => (of[r] ?? 0) > 0).map((r) => (
        <span key={r} className="cost-item">
          {(of[r] ?? 0) > 1 && <b>{of[r]}</b>}
          <Icon r={r} size={16} />
        </span>
      ))}
    </span>
  )
}

/** a row of +/- pickers, one per resource */
export function Pickers({
  value,
  onChange,
  max,
}: {
  value: Hand
  onChange: (h: Hand) => void
  max?: Partial<Record<Resource, number>>
}) {
  return (
    <div className="pickers">
      {RESOURCES.map((r) => {
        const cap = max?.[r] ?? 99
        return (
          <div key={r} className="picker">
            <Icon r={r} size={26} />
            <div className="picker-name">{RESOURCE_NAME[r]}</div>
            <div className="picker-row">
              <button className="mini" disabled={value[r] <= 0} onClick={() => onChange({ ...value, [r]: value[r] - 1 })}>
                −
              </button>
              <span className="picker-n">{value[r]}</span>
              <button className="mini" disabled={value[r] >= cap} onClick={() => onChange({ ...value, [r]: value[r] + 1 })}>
                +
              </button>
            </div>
            {max?.[r] !== undefined && <div className="picker-cap">of {cap}</div>}
          </div>
        )
      })}
    </div>
  )
}

export function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose?: () => void }) {
  return (
    <div className="modal-back">
      <div className="plate modal">
        <div className="modal-head">
          <h2>{title}</h2>
          {onClose && (
            <button className="x" onClick={onClose} aria-label="Close">
              ×
            </button>
          )}
        </div>
        {children}
      </div>
    </div>
  )
}
