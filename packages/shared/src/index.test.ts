import assert from 'node:assert/strict'
import { test } from 'node:test'
import { burnedChampions, decodeCompactPicks, playerPool, crediblePool, type DraftAction, type GameDraft, type CompactPicks, type PickRow, type PoolEntry } from './index.ts'

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

const pickRow = (scheduledStart: string, seriesId: string, gameNumber: number, teamId: string, playerId: string, championId: string, won: boolean): PickRow => ({
  scheduledStart,
  seriesId,
  gameNumber,
  teamId,
  playerId,
  championId,
  won,
})

test('playerPool returns champions played before asOf', () => {
  const picks: PickRow[] = [
    pickRow('2025-01-01', 's1', 1, 'tA', 'p1', 'c1', true),
    pickRow('2025-01-02', 's2', 1, 'tA', 'p1', 'c1', false),
    pickRow('2025-01-03', 's3', 1, 'tA', 'p1', 'c2', true),
    pickRow('2025-01-04', 's4', 1, 'tA', 'p1', 'c3', true),
    pickRow('2025-01-05', 's5', 1, 'tA', 'p2', 'c1', true), // different player
  ]

  const pool = playerPool(picks, 'p1', '2025-01-04')
  assert.equal(pool.length, 2) // c1 and c2, c3 is excluded (scheduledStart >= asOf)
  assert.equal(pool[0].championId, 'c1')
  assert.equal(pool[0].games, 2)
  assert.equal(pool[0].wins, 1)
  assert.equal(pool[0].lastPlayed, '2025-01-02')
  assert.equal(pool[1].championId, 'c2')
  assert.equal(pool[1].games, 1)
  assert.equal(pool[1].wins, 1)
})

test('playerPool sorts by games desc then recency desc', () => {
  const picks: PickRow[] = [
    pickRow('2025-01-01', 's1', 1, 'tA', 'p1', 'c1', true),
    pickRow('2025-01-02', 's2', 1, 'tA', 'p1', 'c1', true),
    pickRow('2025-01-03', 's3', 1, 'tA', 'p1', 'c2', true),
    pickRow('2025-01-04', 's4', 1, 'tA', 'p1', 'c2', true),
    pickRow('2025-01-05', 's5', 1, 'tA', 'p1', 'c3', true),
    pickRow('2025-01-06', 's6', 1, 'tA', 'p1', 'c3', true),
    pickRow('2025-01-07', 's7', 1, 'tA', 'p1', 'c3', true),
  ]

  const pool = playerPool(picks, 'p1', '2026-01-01')
  assert.equal(pool[0].championId, 'c3') // 3 games
  assert.equal(pool[1].championId, 'c2') // 2 games, lastPlayed=01-04 (more recent)
  assert.equal(pool[2].championId, 'c1') // 2 games, lastPlayed=01-02 (less recent)
})

test('playerPool returns empty for unknown player', () => {
  const picks: PickRow[] = [
    pickRow('2025-01-01', 's1', 1, 'tA', 'p1', 'c1', true),
  ]
  assert.deepEqual(playerPool(picks, 'unknown', '2026-01-01'), [])
})

test('crediblePool splits pool into available and burned', () => {
  const pool: PoolEntry[] = [
    { championId: 'c1', games: 5, wins: 3, lastPlayed: '2025-01-01' },
    { championId: 'c2', games: 3, wins: 2, lastPlayed: '2025-01-02' },
    { championId: 'c3', games: 2, wins: 1, lastPlayed: '2025-01-03' },
  ]
  const burned = new Set(['c2'])

  const { credible, burned: burnedEntries } = crediblePool(pool, burned)
  assert.equal(credible.length, 2)
  assert.equal(credible[0].championId, 'c1')
  assert.equal(credible[1].championId, 'c3')
  assert.equal(burnedEntries.length, 1)
  assert.equal(burnedEntries[0].championId, 'c2')
})

test('crediblePool with no burned champions', () => {
  const pool: PoolEntry[] = [
    { championId: 'c1', games: 5, wins: 3, lastPlayed: '2025-01-01' },
  ]
  const burned = new Set<string>()

  const { credible, burned: burnedEntries } = crediblePool(pool, burned)
  assert.equal(credible.length, 1)
  assert.equal(burnedEntries.length, 0)
})
