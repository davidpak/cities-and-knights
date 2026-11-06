/**
 * The reference card (what things cost, how the bank trades) and a short rulebook, both in the menu. Our own words.
 */
import type { View } from '../../../shared/engine.ts'
import { COST, KNIGHT_COST, KNIGHT_POINTS, TRACK_NAME, TRACK_PERK, TRACKS, WIN_POINTS } from '../../../shared/rules.ts'
import { Bundle } from './Cards.tsx'

export function Costs({ view }: { view: View }) {
  const x = !!view.x
  const rows: [string, Parameters<typeof Bundle>[0]['of']][] = [
    ['Road', COST.road],
    ['Settlement', COST.settlement],
    ['City', COST.city],
    ...(x
      ? ([
          ['Knight', KNIGHT_COST.knight],
          ['Upgrade knight', KNIGHT_COST.promote],
          ['Activate knight', KNIGHT_COST.activate],
          ['City wall', KNIGHT_COST.wall],
        ] as [string, Parameters<typeof Bundle>[0]['of']][])
      : ([['Development card', COST.card]] as [string, Parameters<typeof Bundle>[0]['of']][])),
  ]
  return (
    <div className="ref">
      <table className="ref-costs">
        <tbody>
          {rows.map(([name, cost]) => (
            <tr key={name}>
              <td>{name}</td>
              <td>
                <Bundle of={cost} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <h4>Bank</h4>
      <table className="ref-costs">
        <tbody>
          <tr>
            <td>Any 4 of a kind</td>
            <td>4:1</td>
          </tr>
          <tr>
            <td>3:1 harbour</td>
            <td>3:1</td>
          </tr>
          <tr>
            <td>Resource harbour</td>
            <td>2:1</td>
          </tr>
          {x && (
            <tr>
              <td>Trade level 3</td>
              <td>commodities 2:1</td>
            </tr>
          )}
        </tbody>
      </table>
      {x && (
        <>
          <h4>City tracks</h4>
          <table className="ref-costs">
            <tbody>
              {TRACKS.map((t) => (
                <tr key={t}>
                  <td>{TRACK_NAME[t]} 3</td>
                  <td className="small">{TRACK_PERK[t]}</td>
                </tr>
              ))}
              <tr>
                <td>Level 4 first</td>
                <td className="small">Metropolis, +2</td>
              </tr>
            </tbody>
          </table>
        </>
      )}
    </div>
  )
}

export function Rules({ view }: { view: View }) {
  const x = !!view.x
  return (
    <div className="ref rules">
      <h4>Goal</h4>
      <p>First to {x ? KNIGHT_POINTS : WIN_POINTS} points on their own turn wins. Settlement 1, city 2, Longest Road 2{x ? ', metropolis 2, defender 1' : ', Largest Army 2, point cards 1'}.</p>
      <h4>A turn</h4>
      <p>Roll. Every tile with that number pays its resource to each settlement (1) and city (2) on it{x ? '; in the expansion a city on forest, pasture or mountains takes 1 resource and 1 commodity' : ''}. Then trade and build in any order, and end your turn.</p>
      <h4>Building</h4>
      <p>Roads join your roads, settlements and cities. A settlement can't stand next to another building (on a neighbouring corner), and needs a road of yours to it. A city replaces a settlement.</p>
      <h4>Trading</h4>
      <p>Offer any trade to the table or to one player, on your turn. Trade with the bank 4:1, or better at your harbours.</p>
      <h4>A 7</h4>
      <p>Nobody is paid. Anyone holding more than {x ? '7 (plus 2 per city wall)' : '7'} cards discards half. The roller moves the robber (it stops that tile paying) and takes a card from someone beside it.</p>
      <h4>Longest Road</h4>
      <p>The first unbroken road of 5 or more; a longer one takes it.</p>
      {x ? (
        <>
          <h4>Barbarians</h4>
          <p>Each ship on the event die moves them one step closer. When they land, their strength is the number of cities on the island; the active knights' strength is added up. If the knights are as strong or stronger, the strongest defender gets a point. If not, whoever gave least loses a city (back to a settlement; a wall falls instead). Metropolises are safe. Then all knights go inactive.</p>
          <h4>Knights</h4>
          <p>Build a knight (strength 1) on a corner your roads reach; upgrade to 2, and to 3 with Politics level 3. Activate one with grain. An active knight can move along your roads, displace a weaker knight, or chase off the robber next to it, then goes inactive.</p>
          <h4>City tracks</h4>
          <p>Improve with commodities (level × 1 of its commodity), only with a city. A gate on the event die gives that track's card to everyone whose level is at least the red die − 1. Hold at most 4 progress cards.</p>
        </>
      ) : (
        <>
          <h4>Development cards</h4>
          <p>One per turn, not the turn you buy it. Knight: move the robber and steal; 3 knights, the most played, take Largest Army. Point cards stay hidden until they win you the game.</p>
        </>
      )}
    </div>
  )
}
