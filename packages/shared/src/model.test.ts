import assert from 'node:assert/strict'
import { test } from 'node:test'
import { pickFeatures, trainPickModel, pickLikelihoods, calibrateModel, buildPickLikelihoods, threat, banLeverage, denialPicks, conditionLikelihoods, draftState, draftSlotSide, draftSlotType, DRAFT_ORDER, gamePlan, type DraftActionInput, type PickRow, type SeriesDraft, type Role, type PickCandidate, type PickExample, type PickFeatures, type PickLikelihood, type PlayerRef } from './index.ts'

const pickRow = (scheduledStart: string, seriesId: string, gameNumber: number, teamId: string, playerId: string, championId: string, won: boolean): PickRow => ({
  scheduledStart,
  seriesId,
  gameNumber,
  teamId,
  playerId,
  championId,
  won,
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

// ── Ban leverage and denial picks tests ────────────────────────────────

function makeLikelihoods(champions: [string, number][]): PickLikelihood[] {
  // Normalize to probabilities
  const sum = champions.reduce((s, [, p]) => s + p, 0)
  if (sum === 0) return champions.map(([id]) => ({ championId: id, probability: 0, features: { recentGames: 0, played: 0, roleMeta: 0, roleAllTime: 0 } }))
  return champions.map(([id, p]) => ({
    championId: id,
    probability: p / sum,
    features: { recentGames: 0, played: 0, roleMeta: 0, roleAllTime: 0 },
  }))
}

function makePlayers(ids: string[]): PlayerRef[] {
  return ids.map((id) => ({ id, name: `Player ${id}`, role: 'mid' as Role }))
}

test('threat: champion only one opposing player wants gets that player probability', () => {
  const players = makePlayers(['p1', 'p2', 'p3', 'p4', 'p5'])
  // Only p1 wants c1 with high probability
  const playerLikelihoods: PickLikelihood[][] = [
    makeLikelihoods([['c1', 0.6], ['c2', 0.1]]), // p1: c1 = 0.6/0.7 ≈ 0.857
    makeLikelihoods([['c2', 0.5]]), // p2: no c1
    makeLikelihoods([['c2', 0.5]]), // p3: no c1
    makeLikelihoods([['c2', 0.5]]), // p4: no c1
    makeLikelihoods([['c2', 0.5]]), // p5: no c1
  ]
  const result = threat(playerLikelihoods, 'c1', players)
  const expectedP = 0.6 / 0.7 // p1's probability for c1
  assert.ok(Math.abs(result.threat - expectedP) < 1e-6, `threat equals p1's probability: ${result.threat} ≈ ${expectedP}`)
  assert.equal(result.hits.length, 1)
  assert.equal(result.hits[0].playerId, 'p1')
})

test('threat: champion wanted by multiple players combines probabilities', () => {
  const players = makePlayers(['p1', 'p2', 'p3', 'p4', 'p5'])
  // p1 and p2 both want c1
  const playerLikelihoods: PickLikelihood[][] = [
    makeLikelihoods([['c1', 0.5], ['c2', 0.5]]), // p1: c1 = 0.5
    makeLikelihoods([['c1', 0.3], ['c2', 0.7]]), // p2: c1 = 0.3
    makeLikelihoods([['c2', 1]]), // p3: no c1
    makeLikelihoods([['c2', 1]]), // p4: no c1
    makeLikelihoods([['c2', 1]]), // p5: no c1
  ]
  const result = threat(playerLikelihoods, 'c1', players)
  // threat = 1 - (1-0.5)*(1-0.3)*1*1*1 = 1 - 0.5*0.7 = 1 - 0.35 = 0.65
  assert.ok(Math.abs(result.threat - 0.65) < 1e-6, `threat combines: ${result.threat} ≈ 0.65`)
})

test('banLeverage: champion both teams want equally has leverage zero', () => {
  const oppPlayers = makePlayers(['op1', 'op2', 'op3', 'op4', 'op5'])
  const ownPlayers = makePlayers(['ow1', 'ow2', 'ow3', 'ow4', 'ow5'])
  const available = new Set(['c1', 'c2'])

  // Both teams have identical likelihoods for c1
  const oppLikelihoods: PickLikelihood[][] = [
    makeLikelihoods([['c1', 0.4], ['c2', 0.1]]),
    makeLikelihoods([['c2', 1]]),
    makeLikelihoods([['c2', 1]]),
    makeLikelihoods([['c2', 1]]),
    makeLikelihoods([['c2', 1]]),
  ]
  const ownLikelihoods: PickLikelihood[][] = [
    makeLikelihoods([['c1', 0.4], ['c2', 0.1]]), // same as opp
    makeLikelihoods([['c2', 1]]),
    makeLikelihoods([['c2', 1]]),
    makeLikelihoods([['c2', 1]]),
    makeLikelihoods([['c2', 1]]),
  ]

  const result = banLeverage(oppLikelihoods, ownLikelihoods, oppPlayers, ownPlayers, available)
  const c1Entry = result.find((e) => e.championId === 'c1')
  assert.ok(c1Entry !== undefined, 'c1 should be in results')
  assert.ok(Math.abs(c1Entry!.leverage) < 1e-6, `leverage is zero: ${c1Entry!.leverage}`)
})

test('banLeverage: burned champions never appear', () => {
  const oppPlayers = makePlayers(['op1', 'op2', 'op3', 'op4', 'op5'])
  const ownPlayers = makePlayers(['ow1', 'ow2', 'ow3', 'ow4', 'ow5'])
  // c1 is burned
  const available = new Set(['c2'])

  const oppLikelihoods: PickLikelihood[][] = [
    makeLikelihoods([['c1', 0.9], ['c2', 0.1]]),
    makeLikelihoods([['c2', 1]]),
    makeLikelihoods([['c2', 1]]),
    makeLikelihoods([['c2', 1]]),
    makeLikelihoods([['c2', 1]]),
  ]
  const ownLikelihoods: PickLikelihood[][] = [
    makeLikelihoods([['c2', 1]]),
    makeLikelihoods([['c2', 1]]),
    makeLikelihoods([['c2', 1]]),
    makeLikelihoods([['c2', 1]]),
    makeLikelihoods([['c2', 1]]),
  ]

  const result = banLeverage(oppLikelihoods, ownLikelihoods, oppPlayers, ownPlayers, available)
  const c1Entry = result.find((e) => e.championId === 'c1')
  assert.equal(c1Entry, undefined, 'burned c1 should not appear')
})

test('denialPicks: champion no own player has played is never a denial pick', () => {
  const oppPlayers = makePlayers(['op1', 'op2', 'op3', 'op4', 'op5'])
  const ownPlayers = makePlayers(['ow1', 'ow2', 'ow3', 'ow4', 'ow5'])
  const available = new Set(['c1', 'c2'])

  // ow1 has c1 in top 10 but has never played it
  const ownLikelihoods: PickLikelihood[][] = [
    makeLikelihoods([['c1', 0.5], ['c2', 0.3]]), // ow1 wants c1 but hasn't played it
    makeLikelihoods([['c2', 1]]),
    makeLikelihoods([['c2', 1]]),
    makeLikelihoods([['c2', 1]]),
    makeLikelihoods([['c2', 1]]),
  ]
  const oppLikelihoods: PickLikelihood[][] = [
    makeLikelihoods([['c1', 0.8], ['c2', 0.1]]), // opp wants c1
    makeLikelihoods([['c2', 1]]),
    makeLikelihoods([['c2', 1]]),
    makeLikelihoods([['c2', 1]]),
    makeLikelihoods([['c2', 1]]),
  ]
  // ow1 has played c2 but not c1
  const ownPlayerPools = new Map<string, Map<string, number>>()
  const ow1Pool = new Map<string, number>()
  ow1Pool.set('c2', 5) // ow1 has played c2 5 times, not c1
  ownPlayerPools.set('ow1', ow1Pool)

  const result = denialPicks(ownLikelihoods, oppLikelihoods, ownPlayers, oppPlayers, available, ownPlayerPools)
  const c1Entry = result.find((e) => e.championId === 'c1')
  assert.equal(c1Entry, undefined, 'c1 should not be a denial pick — ow1 has not played it')
  // c2 should appear as ow1 has played it
  const c2Entry = result.find((e) => e.championId === 'c2')
  assert.ok(c2Entry !== undefined, 'c2 should be a denial pick — ow1 has played it')
  assert.equal(c2Entry!.gamesPlayed, 5)
})

test('denialPicks: sorted by threat from opponent descending', () => {
  const oppPlayers = makePlayers(['op1', 'op2', 'op3', 'op4', 'op5'])
  const ownPlayers = makePlayers(['ow1', 'ow2', 'ow3', 'ow4', 'ow5'])
  const available = new Set(['c1', 'c2', 'c3'])

  // ow1 has played c1 and c2, both in top 10
  const ownLikelihoods: PickLikelihood[][] = [
    makeLikelihoods([['c1', 0.4], ['c2', 0.4], ['c3', 0.2]]),
    makeLikelihoods([['c3', 1]]),
    makeLikelihoods([['c3', 1]]),
    makeLikelihoods([['c3', 1]]),
    makeLikelihoods([['c3', 1]]),
  ]
  // Opp wants c2 more than c1
  const oppLikelihoods: PickLikelihood[][] = [
    makeLikelihoods([['c1', 0.2], ['c2', 0.9], ['c3', 0.1]]), // op1 strongly wants c2
    makeLikelihoods([['c3', 1]]),
    makeLikelihoods([['c3', 1]]),
    makeLikelihoods([['c3', 1]]),
    makeLikelihoods([['c3', 1]]),
  ]
  const ownPlayerPools = new Map<string, Map<string, number>>()
  const ow1Pool = new Map<string, number>()
  ow1Pool.set('c1', 3)
  ow1Pool.set('c2', 4)
  ownPlayerPools.set('ow1', ow1Pool)

  const result = denialPicks(ownLikelihoods, oppLikelihoods, ownPlayers, oppPlayers, available, ownPlayerPools)
  assert.ok(result.length >= 2, 'should have at least 2 denial picks')
  // c2 should come first (higher opponent threat)
  assert.equal(result[0].championId, 'c2', 'c2 should be first — higher opponent threat')
  assert.equal(result[1].championId, 'c1', 'c1 should be second')
})

test('banLeverage and threat rank differently when own team wants a champion', () => {
  const oppPlayers = makePlayers(['op1', 'op2', 'op3', 'op4', 'op5'])
  const ownPlayers = makePlayers(['ow1', 'ow2', 'ow3', 'ow4', 'ow5'])
  const available = new Set(['c1', 'c2', 'c3'])

  // Opponent: op1 strongly wants c1, not c2
  const oppLikelihoods: PickLikelihood[][] = [
    makeLikelihoods([['c1', 0.8], ['c2', 0.1], ['c3', 0.1]]), // op1: c1=0.8, c2=0.1, c3=0.1
    makeLikelihoods([['c1', 0.1], ['c2', 0.1], ['c3', 0.8]]),
    makeLikelihoods([['c1', 0.1], ['c2', 0.1], ['c3', 0.8]]),
    makeLikelihoods([['c1', 0.1], ['c2', 0.1], ['c3', 0.8]]),
    makeLikelihoods([['c1', 0.1], ['c2', 0.1], ['c3', 0.8]]),
  ]
  // Own team: ow1 strongly wants c2, not c1
  const ownLikelihoods: PickLikelihood[][] = [
    makeLikelihoods([['c1', 0.1], ['c2', 0.8], ['c3', 0.1]]), // ow1: c2=0.8, c1=0.1
    makeLikelihoods([['c1', 0.1], ['c2', 0.1], ['c3', 0.8]]),
    makeLikelihoods([['c1', 0.1], ['c2', 0.1], ['c3', 0.8]]),
    makeLikelihoods([['c1', 0.1], ['c2', 0.1], ['c3', 0.8]]),
    makeLikelihoods([['c1', 0.1], ['c2', 0.1], ['c3', 0.8]]),
  ]

  // Ban leverage = threat from opp - threat from own
  // c1: opp threat is high (op1 wants it 80%), own threat is low → high leverage
  // c2: opp threat is low, own threat is high (ow1 wants it 80%) → negative leverage
  // c3: both teams want it similarly → near-zero leverage
  // Leverage ranking: c1 > c3 > c2

  const leverageResult = banLeverage(oppLikelihoods, ownLikelihoods, oppPlayers, ownPlayers, available)
  assert.equal(leverageResult[0].championId, 'c1', `c1 should have highest leverage, got ${leverageResult[0].championId}`)
  assert.ok(leverageResult[leverageResult.length - 1].championId === 'c2' || leverageResult[leverageResult.length - 2]?.championId === 'c2',
    'c2 should have lowest or near-lowest leverage (negative)')

  // Verify the leverage values show the difference
  const c1Entry = leverageResult.find(e => e.championId === 'c1')
  const c2Entry = leverageResult.find(e => e.championId === 'c2')
  assert.ok(c1Entry !== undefined, 'c1 should be in leverage results')
  assert.ok(c2Entry !== undefined, 'c2 should be in leverage results')
  assert.ok(c1Entry!.leverage > 0, 'c1 leverage should be positive (opp wants it more)')
  assert.ok(c2Entry!.leverage < 0, 'c2 leverage should be negative (own wants it more)')

  // The threat-from-own for c2 should be substantial
  assert.ok(c2Entry!.threatFromOwn > c2Entry!.threatFromOpponent,
    'c2: own threat > opponent threat (negative leverage)')
  assert.ok(c1Entry!.threatFromOpponent > c1Entry!.threatFromOwn,
    'c1: opponent threat > own threat (positive leverage)')
})

// ── Live draft tests ───────────────────────────────────────────────────

test('DRAFT_ORDER has 20 slots', () => {
  assert.equal(DRAFT_ORDER.length, 20)
})

test('draftSlotSide and draftSlotType follow the sequence', () => {
  // First 6 are bans: 1-b, 2-b, 1-b, 2-b, 1-b, 2-b
  assert.equal(draftSlotSide(0), '1')
  assert.equal(draftSlotType(0), 'b')
  assert.equal(draftSlotSide(1), '2')
  assert.equal(draftSlotType(1), 'b')
  // Slots 6-11 are picks
  assert.equal(draftSlotType(6), 'p')
  assert.equal(draftSlotSide(6), '1')
  // Slots 12-15 are bans (second phase)
  assert.equal(draftSlotType(12), 'b')
  assert.equal(draftSlotSide(12), '2')
  // Slots 16-19 are picks (second phase)
  assert.equal(draftSlotType(16), 'p')
  assert.equal(draftSlotSide(16), '2')
  // Out of range
  assert.equal(draftSlotSide(20), null)
  assert.equal(draftSlotType(20), null)
  assert.equal(draftSlotSide(-1), null)
})

test('conditionLikelihoods: rescaled list sums to 1', () => {
  const likelihoods: PickLikelihood[] = [
    { championId: 'c1', probability: 0.5, features: { recentGames: 0, played: 0, roleMeta: 0, roleAllTime: 0 } },
    { championId: 'c2', probability: 0.3, features: { recentGames: 0, played: 0, roleMeta: 0, roleAllTime: 0 } },
    { championId: 'c3', probability: 0.2, features: { recentGames: 0, played: 0, roleMeta: 0, roleAllTime: 0 } },
  ]
  const unavailable = new Set(['c2'])
  const result = conditionLikelihoods(likelihoods, unavailable)
  assert.equal(result.length, 2)
  const sum = result.reduce((s, l) => s + l.probability, 0)
  assert.ok(Math.abs(sum - 1) < 1e-6, `rescaled probabilities sum to 1: ${sum}`)
  // c1 should be 0.5/0.7 ≈ 0.714, c3 should be 0.2/0.7 ≈ 0.286
  const c1 = result.find(l => l.championId === 'c1')!
  const c3 = result.find(l => l.championId === 'c3')!
  assert.ok(Math.abs(c1.probability - 0.5 / 0.7) < 1e-6)
  assert.ok(Math.abs(c3.probability - 0.2 / 0.7) < 1e-6)
})

test('conditionLikelihoods: banned champion disappears from all lists', () => {
  const likelihoods: PickLikelihood[] = [
    { championId: 'c1', probability: 0.4, features: { recentGames: 0, played: 0, roleMeta: 0, roleAllTime: 0 } },
    { championId: 'c2', probability: 0.35, features: { recentGames: 0, played: 0, roleMeta: 0, roleAllTime: 0 } },
    { championId: 'c3', probability: 0.25, features: { recentGames: 0, played: 0, roleMeta: 0, roleAllTime: 0 } },
  ]
  const unavailable = new Set(['c2'])
  const result = conditionLikelihoods(likelihoods, unavailable)
  assert.ok(!result.some(l => l.championId === 'c2'), 'banned c2 should not appear')
  assert.equal(result.length, 2)
})

test('conditionLikelihoods: picked player gets empty list', () => {
  const likelihoods: PickLikelihood[] = [
    { championId: 'c1', probability: 0.5, features: { recentGames: 0, played: 0, roleMeta: 0, roleAllTime: 0 } },
    { championId: 'c2', probability: 0.5, features: { recentGames: 0, played: 0, roleMeta: 0, roleAllTime: 0 } },
  ]
  const unavailable = new Set<string>()
  const pickedPlayers = new Set(['p1'])
  const result = conditionLikelihoods(likelihoods, unavailable, 'p1', pickedPlayers)
  assert.equal(result.length, 0, 'picked player should have empty list')
})

test('draftState: unavailable includes burned, banned, and picked', () => {
  const burned = new Set(['c0'])
  const actions: DraftActionInput[] = [
    { type: 'ban', teamId: 'A', championId: 'c1' },
    { type: 'ban', teamId: 'B', championId: 'c2' },
    { type: 'pick', teamId: 'A', championId: 'c3', playerId: 'p1' },
  ]
  const state = draftState(actions, burned)
  assert.ok(state.unavailable.has('c0'), 'burned c0 is unavailable')
  assert.ok(state.unavailable.has('c1'), 'banned c1 is unavailable')
  assert.ok(state.unavailable.has('c2'), 'banned c2 is unavailable')
  assert.ok(state.unavailable.has('c3'), 'picked c3 is unavailable')
  assert.ok(state.pickedPlayers.has('p1'), 'p1 has picked')
  assert.equal(state.turnIndex, 3)
})

test('draftState: turn order follows the sequence', () => {
  // Simulate the first few actions of a real draft
  // First team = 'teamA', second team = 'teamB'
  const burned = new Set<string>()
  const actions: DraftActionInput[] = []

  // Turn 0: 1-b (first team ban)
  assert.equal(draftSlotSide(0), '1')
  assert.equal(draftSlotType(0), 'b')
  actions.push({ type: 'ban', teamId: 'teamA', championId: 'c1' })
  let state = draftState(actions, burned)
  assert.equal(state.turnIndex, 1)

  // Turn 1: 2-b (second team ban)
  assert.equal(draftSlotSide(1), '2')
  assert.equal(draftSlotType(1), 'b')
  actions.push({ type: 'ban', teamId: 'teamB', championId: 'c2' })
  state = draftState(actions, burned)
  assert.equal(state.turnIndex, 2)

  // Turn 6: B-p (blue pick) — first pick phase
  for (let i = 2; i < 6; i++) {
    actions.push({ type: 'ban', teamId: i % 2 === 0 ? 'teamA' : 'teamB', championId: `c${i + 1}` })
  }
  assert.equal(draftSlotSide(6), '1')
  assert.equal(draftSlotType(6), 'p')
  actions.push({ type: 'pick', teamId: 'teamA', championId: 'c7', playerId: 'p1' })
  state = draftState(actions, burned)
  assert.equal(state.turnIndex, 7)
  assert.ok(state.pickedPlayers.has('p1'))
})

test('draftState: red-first draft works correctly', () => {
  // In 2026, the red side can act first. The draft order uses first/second team,
  // not blue/red. This test verifies that a red-first draft is handled correctly.
  const burned = new Set<string>()
  const actions: DraftActionInput[] = []

  // Red side acts first (team 'redTeam' is the first team)
  // Turn 0: 1-b (red team ban)
  assert.equal(draftSlotSide(0), '1')
  actions.push({ type: 'ban', teamId: 'redTeam', championId: 'c1' })
  let state = draftState(actions, burned)
  assert.equal(state.turnIndex, 1)

  // Turn 1: 2-b (blue team ban)
  assert.equal(draftSlotSide(1), '2')
  actions.push({ type: 'ban', teamId: 'blueTeam', championId: 'c2' })
  state = draftState(actions, burned)
  assert.equal(state.turnIndex, 2)

  // Second-phase bans start at slot 12
  // Slot 12: 2-b (second team = blue team bans)
  assert.equal(draftSlotSide(12), '2')
  assert.equal(draftSlotType(12), 'b')
  // Slot 13: 1-b (first team = red team bans)
  assert.equal(draftSlotSide(13), '1')
  assert.equal(draftSlotType(13), 'b')
})

// ── gamePlan tests ─────────────────────────────────────────────────────

test('gamePlan: both teams get ban leverage', () => {
  // Build a minimal fixture series with two teams, three games, and role counts
  const picks: PickRow[] = [
    pickRow('2025-01-01', 's0', 1, 'tA', 'p1', 'c1', true),
    pickRow('2025-01-01', 's0', 1, 'tA', 'p2', 'c1', true),
    pickRow('2025-01-01', 's0', 1, 'tA', 'p3', 'c1', true),
    pickRow('2025-01-01', 's0', 1, 'tA', 'p4', 'c1', true),
    pickRow('2025-01-01', 's0', 1, 'tA', 'p5', 'c1', true),
    pickRow('2025-01-01', 's0', 1, 'tB', 'p6', 'c1', true),
    pickRow('2025-01-01', 's0', 1, 'tB', 'p7', 'c1', true),
    pickRow('2025-01-01', 's0', 1, 'tB', 'p8', 'c1', true),
    pickRow('2025-01-01', 's0', 1, 'tB', 'p9', 'c1', true),
    pickRow('2025-01-01', 's0', 1, 'tB', 'p10', 'c1', true),
  ]

  const draft: SeriesDraft = {
    seriesId: 's1',
    event: 'Test',
    stage: 'Test',
    scheduledStart: '2025-02-01',
    teamIds: ['tA', 'tB'],
    games: [
      {
        gameId: 'g1', gameNumber: 1, patch: null,
        sides: { blue: 'tA', red: 'tB' }, winnerTeamId: 'tA', actions: [],
        picks: [
          { teamId: 'tA', playerId: 'p1', playerName: 'P1', championId: 'c2' },
          { teamId: 'tA', playerId: 'p2', playerName: 'P2', championId: 'c3' },
          { teamId: 'tA', playerId: 'p3', playerName: 'P3', championId: 'c4' },
          { teamId: 'tA', playerId: 'p4', playerName: 'P4', championId: 'c5' },
          { teamId: 'tA', playerId: 'p5', playerName: 'P5', championId: 'c6' },
          { teamId: 'tB', playerId: 'p6', playerName: 'P6', championId: 'c7' },
          { teamId: 'tB', playerId: 'p7', playerName: 'P7', championId: 'c8' },
          { teamId: 'tB', playerId: 'p8', playerName: 'P8', championId: 'c9' },
          { teamId: 'tB', playerId: 'p9', playerName: 'P9', championId: 'c10' },
          { teamId: 'tB', playerId: 'p10', playerName: 'P10', championId: 'c11' },
        ],
      },
      {
        gameId: 'g2', gameNumber: 2, patch: null,
        sides: { blue: 'tB', red: 'tA' }, winnerTeamId: 'tB', actions: [],
        picks: [
          { teamId: 'tA', playerId: 'p1', playerName: 'P1', championId: 'c12' },
          { teamId: 'tA', playerId: 'p2', playerName: 'P2', championId: 'c13' },
          { teamId: 'tA', playerId: 'p3', playerName: 'P3', championId: 'c14' },
          { teamId: 'tA', playerId: 'p4', playerName: 'P4', championId: 'c15' },
          { teamId: 'tA', playerId: 'p5', playerName: 'P5', championId: 'c16' },
          { teamId: 'tB', playerId: 'p6', playerName: 'P6', championId: 'c17' },
          { teamId: 'tB', playerId: 'p7', playerName: 'P7', championId: 'c18' },
          { teamId: 'tB', playerId: 'p8', playerName: 'P8', championId: 'c19' },
          { teamId: 'tB', playerId: 'p9', playerName: 'P9', championId: 'c20' },
          { teamId: 'tB', playerId: 'p10', playerName: 'P10', championId: 'c21' },
        ],
      },
      {
        gameId: 'g3', gameNumber: 3, patch: null,
        sides: { blue: 'tA', red: 'tB' }, winnerTeamId: null, actions: [],
        picks: [],
      },
    ],
    roleCounts: {
      top: { total45: 100, totalAll: 500, champions: { c1: [10, 50] as [number, number] } },
      jungle: { total45: 100, totalAll: 500, champions: { c1: [10, 50] as [number, number] } },
      mid: { total45: 100, totalAll: 500, champions: { c1: [10, 50] as [number, number] } },
      bot: { total45: 100, totalAll: 500, champions: { c1: [10, 50] as [number, number] } },
      support: { total45: 100, totalAll: 500, champions: { c1: [10, 50] as [number, number] } },
    },
    championsSeen: ['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8', 'c9', 'c10', 'c11'],
  }

  const examples: PickExample[] = []
  for (let i = 0; i < 50; i++) {
    examples.push({
      playerId: 'p1', role: 'top' as Role, seriesDate: '2025-03-01',
      candidates: [
        { championId: 'c1', features: { recentGames: 1, played: 1, roleMeta: 0, roleAllTime: 0 } },
        { championId: 'c2', features: { recentGames: 0, played: 0, roleMeta: 0, roleAllTime: 0 } },
      ],
      actualChampionId: 'c1',
    })
  }
  const model = trainPickModel(examples)

  const playerRole = new Map<string, Role | null>()
  playerRole.set('p1', 'top')
  playerRole.set('p2', 'jungle')
  playerRole.set('p3', 'mid')
  playerRole.set('p4', 'bot')
  playerRole.set('p5', 'support')
  playerRole.set('p6', 'top')
  playerRole.set('p7', 'jungle')
  playerRole.set('p8', 'mid')
  playerRole.set('p9', 'bot')
  playerRole.set('p10', 'support')

  const plan = gamePlan(draft, 3, picks, model, playerRole)

  // Both teams should have leverage data
  assert.ok(plan.leverage.has('tA'), 'team tA should have leverage')
  assert.ok(plan.leverage.has('tB'), 'team tB should have leverage')

  // Both teams should have players
  assert.equal(plan.players.length, 2, 'should have two teams')

  // Opponent players should appear in leverage (not empty)
  const tAlev = plan.leverage.get('tA')!
  assert.ok(tAlev.leverage.length > 0, 'tA should have ban leverage entries')
  // The opponent hits should reference team tB's players
  const entryWithOppHit = tAlev.leverage.find(e => e.opponentHits.length > 0)
  if (entryWithOppHit) {
    const oppPlayerIds = entryWithOppHit.opponentHits.map(h => h.playerId)
    assert.ok(oppPlayerIds.some(id => ['p6', 'p7', 'p8', 'p9', 'p10'].includes(id)),
      'opponent hits should reference tB players')
  }
})
