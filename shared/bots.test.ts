/** The bot levels and personalities: every one plays legal games to the end, and the levels are in order. */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { LEVELS, PERSONAS } from './bot.ts'
import { play } from './tourney.ts'

test('every level and personality plays whole games by the rules (base and knights)', () => {
  for (const knights of [false, true])
    for (let g = 0; g < 4; g++) {
      const who = [0, 1, 2, 3].map((i) => ({ level: LEVELS[(g + i) % 4], persona: PERSONAS[(g * 2 + i) % PERSONAS.length] }))
      const r = play(who, 300 + g, knights)
      assert.ok(r.winner >= 0, `game ${g} finished`)
    }
})

test('the hardest bot beats the easiest by a wide margin', () => {
  let wins = 0
  const games = 24
  for (let g = 0; g < games; g++) if (play([{ level: 'expert', persona: 'steady' }, ...[0, 1, 2].map(() => ({ level: 'easy' as const, persona: 'steady' as const }))], 600 + g, false).winner === 0) wins++
  // a fair share would be a quarter
  assert.ok(wins >= games * 0.5, `expert won ${wins} of ${games}`)
})
