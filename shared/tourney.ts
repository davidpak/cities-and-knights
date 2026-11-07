/**
 * Bots against bots, many games, to see who wins: `npx tsx shared/tourney.ts [games] [base|knights] level/persona ...`
 * e.g. `npx tsx shared/tourney.ts 200 base expert normal normal normal`. Seats rotate so nobody always goes first.
 */
declare const process: { argv: string[]; env: Record<string, string | undefined> }
import { botAction, brain, type Brain, type Level, type Persona } from './bot.ts'
import { apply, newGame, viewFor, type GameState } from './engine.ts'

function rng(seed: number) {
  let t = seed
  return () => {
    t = (t + 0x6d2b79f5) | 0
    let x = Math.imul(t ^ (t >>> 15), t | 1)
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61)
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296
  }
}

/** one game: the winner's index in `who` (or -1 when it runs too long), and how many turns it took */
export function play(who: { level: Level; persona: Persona }[], seed: number, knights: boolean): { winner: number; turns: number } {
  const n = who.length
  // rotate the seats
  const order = who.map((_, i) => (i + seed) % n)
  const brains: Brain[] = order.map((k) => brain(who[k].level, who[k].persona))
  let s: GameState = newGame(order.map((k, i) => ({ id: `p${i}`, name: `${who[k].level}` })), seed, { knights })
  const rnd = rng(seed * 7 + 1)
  for (let steps = 0; steps < 20000 && s.phase.kind !== 'over'; steps++) {
    let moved = false
    for (let p = 0; p < n && !moved; p++) {
      const a = botAction(viewFor(s, p), p, rnd, brains[p])
      if (!a) continue
      const r = apply(s, p, a)
      // (a sneak can't start while another, hidden from us, is under way: that's a pass)
      if (!r.ok && a.type === 'snatch') continue
      if (!r.ok) throw new Error(`${who[order[p]].level}/${who[order[p]].persona}: ${JSON.stringify(a)} in ${s.phase.kind}: ${r.error}`)
      s = r.state
      moved = true
    }
    if (!moved && s.snatch) {
      const r = apply(s, s.snatch.thief, { type: 'snatchEnd' })
      if (!r.ok) throw new Error(r.error)
      s = r.state
      moved = true
    }
    // an offer to someone who never answers would expire; here everyone answers, so this shouldn't happen
    if (!moved) throw new Error(`stuck in ${s.phase.kind}`)
  }
  if (s.phase.kind !== 'over') return { winner: -1, turns: s.turn }
  return { winner: order[s.phase.winner], turns: s.turn }
}

if (process.argv[1]?.endsWith('tourney.ts')) {
  const [games = '100', mode = 'base', ...rest] = process.argv.slice(2)
  const who = (rest.length ? rest : ['expert', 'normal', 'normal', 'normal']).map((x: string) => {
    const [level, persona = 'steady'] = x.split('/')
    return { level: level as Level, persona: persona as Persona }
  })
  const wins = who.map(() => 0)
  let stalls = 0
  let turns = 0
  const t0 = Date.now()
  for (let g = 0; g < Number(games); g++) {
    const r = play(who, 5000 + g, mode === 'knights')
    if (r.winner < 0) stalls++
    else wins[r.winner]++
    turns += r.turns
  }
  const label = who.map((w: { level: Level; persona: Persona }) => `${w.level}/${w.persona}`)
  console.log(`${games} ${mode} games, ${((Date.now() - t0) / Number(games)).toFixed(0)} ms each, ${(turns / Number(games)).toFixed(0)} turns avg, ${stalls} unfinished`)
  label.forEach((l: string, i: number) => console.log(`  seat ${i} ${l.padEnd(18)} ${wins[i]} wins (${((wins[i] / Number(games)) * 100).toFixed(0)}%)`))
}
