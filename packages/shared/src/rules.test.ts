import assert from 'node:assert/strict'
import { test } from 'node:test'
import { burnedChampions, decodeCompactPicks, playerPool, crediblePool, burnedGameShare, backtest, lineupBefore, type DraftAction, type GameDraft, type CompactPicks, type PickRow, type PoolEntry, type SeriesDraft } from './index.ts'

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

test('burnedGameShare returns correct percentage', () => {
  const pool: PoolEntry[] = [
    { championId: 'c1', games: 10, wins: 5, lastPlayed: '2025-01-01' },
    { championId: 'c2', games: 5, wins: 3, lastPlayed: '2025-01-02' },
    { championId: 'c3', games: 5, wins: 2, lastPlayed: '2025-01-03' },
  ]
  const burned = new Set(['c2', 'c3'])

  // 10 games on c1 (not burned) + 5 games on c2 (burned) + 5 games on c3 (burned) = 20 total
  // burned games = 10, share = 50%
  assert.equal(burnedGameShare(pool, burned), 50)
})

test('burnedGameShare never exceeds 100%', () => {
  const pool: PoolEntry[] = [
    { championId: 'c1', games: 5, wins: 3, lastPlayed: '2025-01-01' },
    { championId: 'c2', games: 3, wins: 2, lastPlayed: '2025-01-02' },
  ]
  const burned = new Set(['c1', 'c2'])

  // All champions burned: 8/8 = 100%
  assert.equal(burnedGameShare(pool, burned), 100)
})

test('burnedGameShare is 0 when nothing burned', () => {
  const pool: PoolEntry[] = [
    { championId: 'c1', games: 5, wins: 3, lastPlayed: '2025-01-01' },
  ]
  const burned = new Set<string>()

  assert.equal(burnedGameShare(pool, burned), 0)
})

test('burnedGameShare is 0 for empty pool', () => {
  const pool: PoolEntry[] = []
  const burned = new Set(['c1'])

  assert.equal(burnedGameShare(pool, burned), 0)
})

test('backtest computes correct summary', () => {
  // Create a simple series with 2 games
  const series: SeriesDraft = {
    seriesId: 's1',
    event: 'Test',
    stage: 'Test',
    scheduledStart: '2025-02-01',
    teamIds: ['tA', 'tB'],
    games: [
      {
        gameId: 'g1',
        gameNumber: 1,
        patch: null,
        sides: { blue: 'tA', red: 'tB' },
        winnerTeamId: 'tA',
        actions: [],
        picks: [
          { teamId: 'tA', playerId: 'p1', playerName: 'Player1', championId: 'c1' },
          { teamId: 'tB', playerId: 'p2', playerName: 'Player2', championId: 'c2' },
        ],
      },
      {
        gameId: 'g2',
        gameNumber: 2,
        patch: null,
        sides: { blue: 'tB', red: 'tA' },
        winnerTeamId: 'tB',
        actions: [],
        picks: [
          { teamId: 'tA', playerId: 'p1', playerName: 'Player1', championId: 'c3' }, // c3 is new (not in pool before this series)
          { teamId: 'tB', playerId: 'p2', playerName: 'Player2', championId: 'c4' }, // c4 is new
        ],
      },
    ],
  }

  // Prior picks: p1 played c1 in an earlier series, p2 played c2 and c4
  const picks: PickRow[] = [
    pickRow('2025-01-01', 's0', 1, 'tA', 'p1', 'c1', true),  // p1's prior: c1
    pickRow('2025-01-01', 's0', 1, 'tB', 'p2', 'c2', true),  // p2's prior: c2
    pickRow('2025-01-10', 's0b', 1, 'tB', 'p2', 'c4', true), // p2's prior: c4
  ]

  const { games, summary } = backtest([series], picks)

  // Only game 2 should be analyzed (game 1 is skipped)
  assert.equal(games.length, 1)
  assert.equal(games[0].gameNumber, 2)
  assert.equal(games[0].players.length, 2) // 2 picks in game 2

  // c1 and c2 are burned (from game 1)
  // p1's pool before series: [c1]. After burning c1: credible = []
  // p1 picks c3 → not in pool
  // p2's pool before series: [c2, c4]. After burning c2: credible = [c4]
  // p2 picks c4 → in pool, rank 1

  assert.equal(summary.totalPicks, 2)
  assert.equal(summary.inPool, 50) // 1 of 2 (p2's c4)
  assert.equal(summary.inTop3, 50) // 1 of 2
  assert.equal(summary.inTop5, 50) // 1 of 2
})

test('backtest skips single-game series', () => {
  const series: SeriesDraft = {
    seriesId: 's1',
    event: 'Test',
    stage: 'Test',
    scheduledStart: '2025-02-01',
    teamIds: ['tA', 'tB'],
    games: [
      {
        gameId: 'g1',
        gameNumber: 1,
        patch: null,
        sides: { blue: 'tA', red: 'tB' },
        winnerTeamId: 'tA',
        actions: [],
        picks: [
          { teamId: 'tA', playerId: 'p1', playerName: 'Player1', championId: 'c1' },
        ],
      },
    ],
  }

  const { games, summary } = backtest([series], [])
  assert.equal(games.length, 0)
  assert.equal(summary.totalPicks, 0)
})

test('backtest skips game 1', () => {
  const series: SeriesDraft = {
    seriesId: 's1',
    event: 'Test',
    stage: 'Test',
    scheduledStart: '2025-02-01',
    teamIds: ['tA', 'tB'],
    games: [
      {
        gameId: 'g1',
        gameNumber: 1,
        patch: null,
        sides: { blue: 'tA', red: 'tB' },
        winnerTeamId: 'tA',
        actions: [],
        picks: [
          { teamId: 'tA', playerId: 'p1', playerName: 'Player1', championId: 'c1' },
        ],
      },
      {
        gameId: 'g2',
        gameNumber: 2,
        patch: null,
        sides: { blue: 'tB', red: 'tA' },
        winnerTeamId: 'tB',
        actions: [],
        picks: [
          { teamId: 'tA', playerId: 'p1', playerName: 'Player1', championId: 'c2' },
        ],
      },
    ],
  }

  const picks: PickRow[] = [
    pickRow('2025-01-01', 's0', 1, 'tA', 'p1', 'c2', true),
  ]

  const { games } = backtest([series], picks)
  assert.equal(games.length, 1)
  assert.equal(games[0].gameNumber, 2)
})

// ── Lineup tests ─────────────────────────────────────────────────────

test('lineupBefore: game 1 uses game 1 lineup', () => {
  const draft: SeriesDraft = {
    seriesId: 's1', event: 'E', stage: 'S', scheduledStart: '2025-01-01',
    teamIds: ['A', 'B'],
    games: [
      { gameId: 'g1', gameNumber: 1, patch: null, sides: { blue: 'A', red: 'B' }, winnerTeamId: null, actions: [],
        picks: [
          { teamId: 'A', playerId: 'p1', playerName: 'P1', championId: 'c1' },
          { teamId: 'B', playerId: 'p2', playerName: 'P2', championId: 'c2' },
        ]},
      { gameId: 'g2', gameNumber: 2, patch: null, sides: { blue: 'A', red: 'B' }, winnerTeamId: null, actions: [],
        picks: [
          { teamId: 'A', playerId: 'p1', playerName: 'P1', championId: 'c3' },
          { teamId: 'B', playerId: 'p2', playerName: 'P2', championId: 'c4' },
        ]},
    ],
  }
  const result = lineupBefore(draft, 1)
  assert.equal(result.lineup['A'].length, 1)
  assert.equal(result.lineup['A'][0].playerId, 'p1')
  assert.equal(result.lineupChanged.get('A'), false)
  assert.equal(result.lineupChanged.get('B'), false)
})

test('lineupBefore: game 3 uses game 2 lineup', () => {
  const draft: SeriesDraft = {
    seriesId: 's1', event: 'E', stage: 'S', scheduledStart: '2025-01-01',
    teamIds: ['A', 'B'],
    games: [
      { gameId: 'g1', gameNumber: 1, patch: null, sides: { blue: 'A', red: 'B' }, winnerTeamId: null, actions: [],
        picks: [
          { teamId: 'A', playerId: 'p1', playerName: 'P1', championId: 'c1' },
          { teamId: 'B', playerId: 'p2', playerName: 'P2', championId: 'c2' },
        ]},
      { gameId: 'g2', gameNumber: 2, patch: null, sides: { blue: 'A', red: 'B' }, winnerTeamId: null, actions: [],
        picks: [
          { teamId: 'A', playerId: 'p3', playerName: 'P3', championId: 'c3' },
          { teamId: 'B', playerId: 'p2', playerName: 'P2', championId: 'c4' },
        ]},
      { gameId: 'g3', gameNumber: 3, patch: null, sides: { blue: 'A', red: 'B' }, winnerTeamId: null, actions: [],
        picks: [
          { teamId: 'A', playerId: 'p3', playerName: 'P3', championId: 'c5' },
          { teamId: 'B', playerId: 'p2', playerName: 'P2', championId: 'c6' },
        ]},
    ],
  }
  const result = lineupBefore(draft, 3)
  // Game 3 should use game 2 lineup: p3 for team A
  assert.equal(result.lineup['A'][0].playerId, 'p3')
  // Lineup changed: game 1 had p1, game 2 had p3 (team A changed, team B did not)
  assert.equal(result.lineupChanged.get('A'), true)
  assert.equal(result.lineupChanged.get('B'), false)
})

test('lineupBefore: substitution detection', () => {
  const draft: SeriesDraft = {
    seriesId: 's1', event: 'E', stage: 'S', scheduledStart: '2025-01-01',
    teamIds: ['A', 'B'],
    games: [
      { gameId: 'g1', gameNumber: 1, patch: null, sides: { blue: 'A', red: 'B' }, winnerTeamId: null, actions: [],
        picks: [
          { teamId: 'A', playerId: 'p1', playerName: 'P1', championId: 'c1' },
          { teamId: 'B', playerId: 'p2', playerName: 'P2', championId: 'c2' },
        ]},
      { gameId: 'g2', gameNumber: 2, patch: null, sides: { blue: 'A', red: 'B' }, winnerTeamId: null, actions: [],
        picks: [
          { teamId: 'A', playerId: 'p1', playerName: 'P1', championId: 'c3' },
          { teamId: 'B', playerId: 'p2', playerName: 'P2', championId: 'c4' },
        ]},
      { gameId: 'g3', gameNumber: 3, patch: null, sides: { blue: 'A', red: 'B' }, winnerTeamId: null, actions: [],
        picks: [
          { teamId: 'A', playerId: 'p4', playerName: 'P4', championId: 'c5' },
          { teamId: 'B', playerId: 'p2', playerName: 'P2', championId: 'c6' },
        ]},
      { gameId: 'g4', gameNumber: 4, patch: null, sides: { blue: 'A', red: 'B' }, winnerTeamId: null, actions: [],
        picks: [
          { teamId: 'A', playerId: 'p4', playerName: 'P4', championId: 'c7' },
          { teamId: 'B', playerId: 'p2', playerName: 'P2', championId: 'c8' },
        ]},
    ],
  }
  // Game 4 should use game 3 lineup (p4), and lineupChanged should be true for team A
  const result = lineupBefore(draft, 4)
  assert.equal(result.lineup['A'][0].playerId, 'p4')
  assert.equal(result.lineupChanged.get('A'), true)
  assert.equal(result.lineupChanged.get('B'), false)
})
