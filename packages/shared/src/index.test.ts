import assert from 'node:assert/strict'
import { test } from 'node:test'
import { burnedChampions, decodeCompactPicks, playerPool, crediblePool, burnedGameShare, backtest, pickFeatures, trainPickModel, pickLikelihoods, calibrateModel, buildPickLikelihoods, type DraftAction, type GameDraft, type CompactPicks, type PickRow, type PoolEntry, type SeriesDraft, type Role, type PickCandidate, type PickExample, type PickFeatures } from './index.ts'

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

// ── Pick model tests ──────────────────────────────────────────────────

test('pickLikelihoods: probabilities sum to 1', () => {
  const candidates: PickCandidate[] = [
    { championId: 'c1', features: { recentGames: 1, played: 1, roleMeta: 0, roleAllTime: 0 } },
    { championId: 'c2', features: { recentGames: 0, played: 0, roleMeta: 0, roleAllTime: 0 } },
    { championId: 'c3', features: { recentGames: 0.5, played: 1, roleMeta: 0, roleAllTime: 0 } },
  ]
  const model = trainPickModel([])
  const likelihoods = pickLikelihoods(model, candidates)
  assert.equal(likelihoods.length, 3)
  const sum = likelihoods.reduce((s, l) => s + l.probability, 0)
  assert.ok(Math.abs(sum - 1) < 1e-6, `probabilities sum to 1, got ${sum}`)
})

test('pickLikelihoods: sorted by probability descending', () => {
  // Train on examples where c1 (high recentGames + played) always wins over c2
  const examples: PickExample[] = []
  for (let i = 0; i < 200; i++) {
    examples.push({
      playerId: 'p1',
      role: 'mid' as Role,
      seriesDate: '2025-03-01',
      candidates: [
        { championId: 'c1', features: { recentGames: 2, played: 1, roleMeta: 0, roleAllTime: 0 } },
        { championId: 'c2', features: { recentGames: 0, played: 0, roleMeta: 0, roleAllTime: 0 } },
        { championId: 'c3', features: { recentGames: 0.3, played: 0, roleMeta: 0, roleAllTime: 0 } },
      ],
      actualChampionId: 'c1',
    })
  }
  const model = trainPickModel(examples)
  const candidates: PickCandidate[] = [
    { championId: 'c1', features: { recentGames: 2, played: 1, roleMeta: 0, roleAllTime: 0 } },
    { championId: 'c2', features: { recentGames: 0, played: 0, roleMeta: 0, roleAllTime: 0 } },
    { championId: 'c3', features: { recentGames: 0.3, played: 0, roleMeta: 0, roleAllTime: 0 } },
  ]
  const likelihoods = pickLikelihoods(model, candidates)
  assert.ok(likelihoods[0].probability >= likelihoods[1].probability, 'sorted desc')
  assert.equal(likelihoods[0].championId, 'c1', 'c1 should be most likely')
})

test('pickFeatures: burned champions never appear', () => {
  const picks: PickRow[] = [
    pickRow('2025-01-01', 's0', 1, 'tA', 'p1', 'c1', true),
    pickRow('2025-01-02', 's0b', 1, 'tA', 'p1', 'c2', true),
  ]
  const burned = new Set(['c1'])
  const allChamps = new Set(['c1', 'c2', 'c3'])
  const rolePicks45 = new Map<string, number>()
  const rolePicksAll = new Map<string, number>()

  const candidates = pickFeatures('p1', '2025-02-01', picks, burned, rolePicks45, rolePicksAll, 0, 0, allChamps)
  const champIds = candidates.map((c) => c.championId)
  assert.ok(!champIds.includes('c1'), 'burned c1 should not appear')
  assert.ok(champIds.includes('c2'), 'c2 should appear')
  assert.ok(champIds.includes('c3'), 'c3 should appear')
})

test('trainPickModel: deciding feature gets largest weight', () => {
  // In this fixture, "played" is the only feature that differs between the actual pick and the other
  const examples: PickExample[] = []
  for (let i = 0; i < 100; i++) {
    examples.push({
      playerId: 'p1',
      role: 'mid' as Role,
      seriesDate: '2025-03-01',
      candidates: [
        { championId: 'c1', features: { recentGames: 0.5, played: 1, roleMeta: 0, roleAllTime: 0 } },
        { championId: 'c2', features: { recentGames: 0.5, played: 0, roleMeta: 0, roleAllTime: 0 } },
        { championId: 'c3', features: { recentGames: 0.5, played: 0, roleMeta: 0, roleAllTime: 0 } },
      ],
      actualChampionId: 'c1',
    })
  }
  const model = trainPickModel(examples)
  // played is index 1; it should have the largest absolute weight
  const absWeights = model.weights.map((w) => Math.abs(w))
  const maxIdx = absWeights.indexOf(Math.max(...absWeights))
  assert.equal(maxIdx, 1, 'played (index 1) should have the largest weight')
})

test('pickFeatures: later series does not affect earlier series', () => {
  const picks: PickRow[] = [
    pickRow('2025-01-01', 's0', 1, 'tA', 'p1', 'c1', true),
    pickRow('2025-06-01', 's1', 1, 'tA', 'p1', 'c2', true), // later series
  ]
  const burned = new Set<string>()
  const allChamps = new Set(['c1', 'c2'])
  const rolePicks45 = new Map<string, number>()
  const rolePicksAll = new Map<string, number>()

  // Features for series on 2025-03-01 should only see the Jan pick
  const candidates = pickFeatures('p1', '2025-03-01', picks, burned, rolePicks45, rolePicksAll, 0, 0, allChamps)
  const c1Feat = candidates.find((c) => c.championId === 'c1')
  const c2Feat = candidates.find((c) => c.championId === 'c2')
  assert.ok(c1Feat !== undefined, 'c1 should be in candidates')
  assert.equal(c1Feat!.features.played, 1, 'c1 was played before 2025-03-01')
  assert.equal(c2Feat!.features.played, 0, 'c2 was not played before 2025-03-01 (later series)')
})

// ── Section 3b: Newton's method tests ──────────────────────────────────

test('trainPickModel: gradient close to zero at returned weights', () => {
  // Train on a fixture where one feature decides the pick
  const examples: PickExample[] = []
  for (let i = 0; i < 200; i++) {
    examples.push({
      playerId: 'p1',
      role: 'mid' as Role,
      seriesDate: '2025-03-01',
      candidates: [
        { championId: 'c1', features: { recentGames: 2, played: 1, roleMeta: 0.5, roleAllTime: 0.3 } },
        { championId: 'c2', features: { recentGames: 0, played: 0, roleMeta: 0, roleAllTime: 0 } },
        { championId: 'c3', features: { recentGames: 0.3, played: 0, roleMeta: 0, roleAllTime: 0 } },
      ],
      actualChampionId: 'c1',
    })
  }
  const model = trainPickModel(examples)

  // Check gradient is close to zero by computing it manually
  const K = 4
  const featureKeys: (keyof PickFeatures)[] = ['recentGames', 'played', 'roleMeta', 'roleAllTime']
  const grad = new Array(K).fill(0)

  for (const ex of examples) {
    const scores = ex.candidates.map((c) => {
      let s = 0
      for (let k = 0; k < K; k++) {
        s += model.weights[k] * ((c.features[featureKeys[k]] - model.mean[k]) / model.sd[k])
      }
      return s
    })
    const maxS = Math.max(...scores)
    const exps = scores.map((s) => Math.exp(s - maxS))
    const sumE = exps.reduce((a, b) => a + b, 0)
    const probs = exps.map((e) => e / sumE)
    const actualIdx = ex.candidates.findIndex((c) => c.championId === ex.actualChampionId)

    for (let k = 0; k < K; k++) {
      let g = ((ex.candidates[actualIdx].features[featureKeys[k]] - model.mean[k]) / model.sd[k])
      for (let j = 0; j < ex.candidates.length; j++) {
        g -= probs[j] * ((ex.candidates[j].features[featureKeys[k]] - model.mean[k]) / model.sd[k])
      }
      grad[k] += g
    }
  }

  // Average gradient should be close to zero
  for (let k = 0; k < K; k++) {
    grad[k] /= examples.length
    assert.ok(Math.abs(grad[k]) < 0.05, `gradient component ${k} is close to zero: ${grad[k]}`)
  }
})

test('trainPickModel: log-likelihood not lower than at zero weights', () => {
  const examples: PickExample[] = []
  for (let i = 0; i < 100; i++) {
    examples.push({
      playerId: 'p1',
      role: 'top' as Role,
      seriesDate: '2025-03-01',
      candidates: [
        { championId: 'c1', features: { recentGames: 1.5, played: 1, roleMeta: 0.3, roleAllTime: 0.2 } },
        { championId: 'c2', features: { recentGames: 0, played: 0, roleMeta: 0, roleAllTime: 0 } },
        { championId: 'c3', features: { recentGames: 0.2, played: 0, roleMeta: 0, roleAllTime: 0 } },
      ],
      actualChampionId: 'c1',
    })
  }
  const model = trainPickModel(examples)

  // The trained model's log-likelihood should be >= the log-likelihood at zero weights
  // (zero weights = uniform distribution)
  const uniformLL = Math.log(1 / 3) // 3 candidates, uniform
  assert.ok(model.meanLogLikelihood >= uniformLL - 0.01, `trained LL (${model.meanLogLikelihood}) >= uniform LL (${uniformLL})`)
})

test('calibrateModel: known bins', () => {
  // Create examples where we know the probabilities
  const examples: PickExample[] = []
  for (let i = 0; i < 50; i++) {
    examples.push({
      playerId: 'p1',
      role: 'mid' as Role,
      seriesDate: '2025-03-01',
      candidates: [
        { championId: 'c1', features: { recentGames: 3, played: 1, roleMeta: 1, roleAllTime: 0.5 } },
        { championId: 'c2', features: { recentGames: 0, played: 0, roleMeta: 0, roleAllTime: 0 } },
        { championId: 'c3', features: { recentGames: 0, played: 0, roleMeta: 0, roleAllTime: 0 } },
      ],
      actualChampionId: 'c1', // c1 always wins
    })
  }
  const model = trainPickModel(examples)
  const calibration = calibrateModel(model, examples)

  // Should have 5 bins
  assert.equal(calibration.length, 5)
  assert.equal(calibration[0].label, '0-2%')
  assert.equal(calibration[4].label, '20%+')

  // Total count should be 3 * 50 = 150 (3 candidates per example)
  const total = calibration.reduce((s, b) => s + b.count, 0)
  assert.equal(total, 150)

  // The actual pick rate in the highest bin should be high (c1 is always picked and has high probability)
  const topBin = calibration[4]
  assert.ok(topBin.actualPickRate > 50, `top bin actual rate should be high: ${topBin.actualPickRate}`)
})

test('buildPickLikelihoods: same result as pickFeatures + pickLikelihoods', () => {
  const picks: PickRow[] = [
    pickRow('2025-01-01', 's0', 1, 'tA', 'p1', 'c1', true),
    pickRow('2025-01-10', 's1', 1, 'tA', 'p1', 'c1', true),
    pickRow('2025-01-15', 's2', 1, 'tA', 'p1', 'c2', true),
  ]
  const burned = new Set<string>()
  const allChampionIds = new Set(['c1', 'c2', 'c3'])
  const roleCounts: Record<string, { total45: number; totalAll: number; champions: Record<string, [number, number]> }> = {
    mid: {
      total45: 100,
      totalAll: 500,
      champions: {
        c1: [10, 50] as [number, number],
        c2: [5, 25] as [number, number],
        c3: [2, 10] as [number, number],
      },
    },
  }

  // Build using pickFeatures + pickLikelihoods
  const rolePicks45 = new Map<string, number>()
  const rolePicksAll = new Map<string, number>()
  for (const [champId, counts] of Object.entries(roleCounts.mid.champions)) {
    rolePicks45.set(champId, counts[0])
    rolePicksAll.set(champId, counts[1])
  }
  const candidates = pickFeatures('p1', '2025-02-01', picks, burned, rolePicks45, rolePicksAll, 100, 500, allChampionIds)

  const examples: PickExample[] = []
  for (let i = 0; i < 50; i++) {
    examples.push({
      playerId: 'p1',
      role: 'mid' as Role,
      seriesDate: '2025-03-01',
      candidates: candidates.map(c => ({ ...c })),
      actualChampionId: 'c1',
    })
  }
  const model = trainPickModel(examples)

  const likelihoodsDirect = pickLikelihoods(model, candidates)

  // Build using buildPickLikelihoods
  const likelihoodsBundled = buildPickLikelihoods(
    model,
    'p1',
    'mid' as Role,
    '2025-02-01',
    picks,
    burned,
    roleCounts,
    allChampionIds,
  )

  // Should produce the same results
  assert.equal(likelihoodsDirect.length, likelihoodsBundled.length)
  for (let i = 0; i < likelihoodsDirect.length; i++) {
    assert.equal(likelihoodsDirect[i].championId, likelihoodsBundled[i].championId)
    assert.ok(Math.abs(likelihoodsDirect[i].probability - likelihoodsBundled[i].probability) < 1e-6,
      `probability match for ${likelihoodsDirect[i].championId}`)
  }
})
