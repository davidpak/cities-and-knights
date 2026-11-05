/**
 * Trading, all in one place, right above your hand:
 *   - click cards in your hand: they slide onto the mat's "You give" side; click them there to take them back
 *   - click what you want on the mat's "You get" side
 *   - "Trade with the bank" is ready the moment the cards fit your rates (harbours included), and says what it'll do
 *   - "Ask everyone" puts the offer to the table; each player's answer shows on the mat, and you pick who to trade with
 * Other players see the offer as a slip above their own hand: Accept or No thanks.
 */
import { tradeRatios, type View } from '../../../shared/engine.ts'
import { RESOURCES, emptyHand, handSize, type Hand, type Resource } from '../../../shared/rules.ts'
import { PLAYER, RESOURCE_NAME } from '../lib/palette.ts'
import { act } from '../net.ts'
import { Bundle, CardRow, Icon, ResourceCard } from './Cards.tsx'
import { Who } from './Chronicle.tsx'

export type Trade = { give: Hand; get: Hand }
export const add = (h: Hand, r: Resource, d: number): Hand => ({ ...h, [r]: Math.max(0, h[r] + d) })

/** what the bank would do with this trade, if anything */
export function bankPlan(view: View, t: Trade): { ok: boolean; why: string; pairs: [Resource, Resource][] } {
  const ratios = tradeRatios(view, view.you)
  const give = RESOURCES.filter((r) => t.give[r] > 0)
  const get = RESOURCES.filter((r) => t.get[r] > 0)
  if (!give.length) return { ok: false, why: 'Click cards in your hand to give them', pairs: [] }
  if (!get.length) return { ok: false, why: 'Pick what you want', pairs: [] }
  if (give.some((r) => t.get[r] > 0)) return { ok: false, why: "You can't give and get the same thing", pairs: [] }
  const odd = give.find((r) => t.give[r] % ratios[r] !== 0)
  if (odd) return { ok: false, why: `The bank takes ${RESOURCE_NAME[odd].toLowerCase()} ${ratios[odd]} at a time`, pairs: [] }
  const out: Resource[] = give.flatMap((r) => Array<Resource>(t.give[r] / ratios[r]).fill(r))
  const into: Resource[] = get.flatMap((r) => Array<Resource>(t.get[r]).fill(r))
  if (out.length !== into.length) return { ok: false, why: `That buys ${out.length} from the bank, not ${into.length}`, pairs: [] }
  if (get.some((r) => view.bank[r] < t.get[r])) return { ok: false, why: 'The bank has run out of that', pairs: [] }
  return { ok: true, why: '', pairs: out.map((r, i) => [r, into[i]]) }
}

export function TradeMat({ view, trade, setTrade, close }: { view: View; trade: Trade; setTrade: (t: Trade) => void; close: () => void }) {
  const me = view.you
  const ratios = tradeRatios(view, me)
  const o = view.offer && view.offer.from === me ? view.offer : null
  const plan = bankPlan(view, trade)
  const offerOk = handSize(trade.give) > 0 && handSize(trade.get) > 0 && !RESOURCES.some((r) => trade.give[r] && trade.get[r])
  const others = view.players.map((_, i) => i).filter((i) => i !== me)

  const bankTrade = async () => {
    for (const [give, get] of plan.pairs) if (!(await act({ type: 'bankTrade', give, get }))) break
    setTrade({ give: emptyHand(), get: emptyHand() })
  }

  // an offer is on the table: show who said what, and let you pick
  if (o) {
    return (
      <div className="mat">
        <div className="mat-head">
          <span className="mat-title">Your offer</span>
          <span className="mat-deal">
            You give <Bundle of={o.give} /> <span className="arrow">for</span> <Bundle of={o.get} />
          </span>
        </div>
        <div className="answers">
          {others.map((i) => {
            const yes = o.accepted.includes(i)
            const no = o.declined.includes(i)
            return (
              <div key={i} className={`answer ${yes ? 'yes' : no ? 'no' : 'wait'}`} style={{ ['--pc' as string]: PLAYER[view.players[i].color].ui }}>
                <Who view={view} p={i} />
                {yes ? (
                  <button className="stamp-btn go" onClick={() => act({ type: 'confirmTrade', with: i })}>
                    Trade with {view.players[i].name}
                  </button>
                ) : no ? (
                  <span className="said">said no</span>
                ) : (
                  <span className="said">thinking…</span>
                )}
              </div>
            )
          })}
        </div>
        <div className="mat-foot">
          <button className="stamp-btn" onClick={() => act({ type: 'cancelOffer' })}>
            Take it back
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="mat">
      <div className="mat-head">
        <span className="mat-title">Trade</span>
        <span className="rates" title="How many of one kind the bank takes for one card. Your harbours make it cheaper.">
          Bank rates
          {RESOURCES.map((r) => (
            <span key={r} className={`rate ${ratios[r] < 4 ? 'good' : ''}`}>
              <Icon r={r} size={14} />
              {ratios[r]}:1
            </span>
          ))}
        </span>
        <button className="x" onClick={close} aria-label="Close trade">
          ×
        </button>
      </div>
      <div className="mat-sides">
        <div className="side give">
          <div className="side-label">You give</div>
          <div className="slot">
            {handSize(trade.give) ? <CardRow hand={trade.give} small onPick={(r) => setTrade({ ...trade, give: add(trade.give, r, -1) })} /> : <span className="hint">↓ click cards in your hand</span>}
          </div>
        </div>
        <div className="swap">⇄</div>
        <div className="side get">
          <div className="side-label">You get</div>
          <div className="slot">
            {handSize(trade.get) ? <CardRow hand={trade.get} small onPick={(r) => setTrade({ ...trade, get: add(trade.get, r, -1) })} /> : <span className="hint">pick below</span>}
          </div>
          <div className="wants">
            {RESOURCES.map((r) => (
              <ResourceCard key={r} r={r} small onClick={() => setTrade({ ...trade, get: add(trade.get, r, 1) })} title={`Ask for ${RESOURCE_NAME[r]}`} />
            ))}
          </div>
        </div>
      </div>
      <div className="mat-foot">
        <span className="why">{plan.ok ? <>The bank will do this</> : plan.why}</span>
        <button className="stamp-btn go" disabled={!plan.ok} onClick={bankTrade}>
          Trade with the bank
        </button>
        <button className="stamp-btn" disabled={!offerOk} onClick={() => act({ type: 'offerTrade', give: trade.give, get: trade.get })}>
          Ask everyone
        </button>
      </div>
    </div>
  )
}

/** someone else's offer, above your hand: they give / you give, Accept or No thanks */
export function OfferSlip({ view }: { view: View }) {
  const o = view.offer
  const me = view.you
  if (!o || o.from === me || me < 0) return null
  const hand = view.players[me].hand
  const can = !!hand && RESOURCES.every((r) => hand[r] >= o.get[r])
  const yes = o.accepted.includes(me)
  const no = o.declined.includes(me)
  return (
    <div className="slip" style={{ ['--pc' as string]: PLAYER[view.players[o.from].color].ui }}>
      <div className="slip-line">
        <Who view={view} p={o.from} /> offers you <Bundle of={o.give} /> <span className="arrow">for your</span> <Bundle of={o.get} />
      </div>
      {yes ? (
        <span className="said">You said yes. {view.players[o.from].name} is choosing…</span>
      ) : no ? (
        <span className="said">You said no.</span>
      ) : (
        <div className="slip-buttons">
          <button className="stamp-btn go" disabled={!can} onClick={() => act({ type: 'acceptOffer' })} title={can ? '' : "You don't have those cards"}>
            Accept
          </button>
          <button className="stamp-btn" onClick={() => act({ type: 'declineOffer' })}>
            No thanks
          </button>
          {!can && <span className="said">You don't have the cards.</span>}
        </div>
      )}
    </div>
  )
}
