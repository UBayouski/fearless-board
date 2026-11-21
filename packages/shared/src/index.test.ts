import assert from 'node:assert/strict'
import { test } from 'node:test'
import { burnedChampions, decodeCompactPicks, type DraftAction, type GameDraft, type CompactPicks } from './index.ts'

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

test('picks are used when actions are empty', () => {
  const gameWithPicksOnly: GameDraft = {
    gameId: 'g2',
    gameNumber: 2,
    patch: null,
    sides: { blue: 'A', red: 'B' },
    winnerTeamId: null,
    actions: [],
    picks: [
      { teamId: 'A', playerId: 'p1', playerName: 'Player1', championId: 'c1' },
      { teamId: 'B', playerId: 'p2', playerName: 'Player2', championId: 'c2' },
    ],
  }
  const seriesWithPicks = [
    game(1, [action(1, 'pick', 'A', 'a1')]),
    gameWithPicksOnly,
  ]
  assert.deepEqual([...burnedChampions(seriesWithPicks, 1)], [])
  assert.deepEqual([...burnedChampions(seriesWithPicks, 2)].sort(), ['a1'])
  assert.deepEqual([...burnedChampions(seriesWithPicks, 3)].sort(), ['a1', 'c1', 'c2'])
})

test('decodeCompactPicks decodes compact format', () => {
  const cp: CompactPicks = {
    series: ['s1'],
    teams: ['tA', 'tB'],
    players: ['p1', 'p2'],
    champions: ['c1', 'c2'],
    rows: [
      [0, 1, 0, 0, 0, 1],
      [0, 1, 1, 1, 1, 0],
    ],
  }
  const rows = decodeCompactPicks(cp)
  assert.equal(rows.length, 2)
  assert.equal(rows[0].seriesId, 's1')
  assert.equal(rows[0].gameNumber, 1)
  assert.equal(rows[0].teamId, 'tA')
  assert.equal(rows[0].playerId, 'p1')
  assert.equal(rows[0].championId, 'c1')
  assert.equal(rows[0].won, true)
  assert.equal(rows[1].won, false)
})
