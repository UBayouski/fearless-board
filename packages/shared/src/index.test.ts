import assert from 'node:assert/strict'
import { test } from 'node:test'
import { burnedChampions, type DraftAction, type GameDraft } from './index.ts'

const action = (order: number, type: DraftAction['type'], teamId: string, championId: string): DraftAction => ({
  order,
  type,
  teamId,
  championId,
})

const game = (gameNumber: number, actions: DraftAction[]): GameDraft => ({
  gameId: `g${gameNumber}`,
  gameNumber,
  patch: null,
  sides: { blue: 'A', red: 'B' },
  winnerTeamId: null,
  actions,
  picks: [],
})

const series = [
  game(1, [action(1, 'ban', 'A', 'x'), action(2, 'pick', 'A', 'a1'), action(3, 'pick', 'B', 'b1')]),
  game(2, [action(1, 'pick', 'A', 'a2'), action(2, 'pick', 'B', 'b2')]),
]

test('nothing is burned in game 1', () => {
  assert.deepEqual([...burnedChampions(series, 1)], [])
})

test('picks from both teams are burned for later games', () => {
  assert.deepEqual([...burnedChampions(series, 2)].sort(), ['a1', 'b1'])
  assert.deepEqual([...burnedChampions(series, 3)].sort(), ['a1', 'a2', 'b1', 'b2'])
})

test('bans do not carry over', () => {
  assert.equal(burnedChampions(series, 3).has('x'), false)
})
