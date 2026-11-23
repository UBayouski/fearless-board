// Tests for encodePlan / decodePlan round-trip

import { describe, it } from 'node:test'
import { strict as assert } from 'node:assert'
import { encodePlan, decodePlan } from './planCodec.ts'
import type {
  GamePlan, GamePlanPlayer, PoolEntry, PickLikelihood, PickFeatures,
  Role, Lineup, BanLeverageEntry, DenialPickEntry, ThreatHit,
  GamePlanTeamLeverage, GameDraft,
} from './types.ts'

function buildFixture(): GamePlan {
  const zeroFeatures: PickFeatures = { recentGames: 0.5, played: 1, roleMeta: 1.2, roleAllTime: 0.4 }

  const likelihoods: PickLikelihood[] = [
    { championId: 'C1', probability: 0.4, features: zeroFeatures, roleShare: { recent: 0.15, allTime: 0.1 } },
    { championId: 'C2', probability: 0.3, features: zeroFeatures, roleShare: { recent: 0.1, allTime: 0.08 } },
    { championId: 'C3', probability: 0.2, features: zeroFeatures, roleShare: { recent: null, allTime: 0.05 } },
  ]

  const startLikelihoods: PickLikelihood[] = [
    { championId: 'C1', probability: 0.35, features: zeroFeatures, roleShare: { recent: 0.15, allTime: 0.1 } },
    { championId: 'C2', probability: 0.25, features: zeroFeatures, roleShare: { recent: 0.1, allTime: 0.08 } },
    { championId: 'C4', probability: 0.2, features: zeroFeatures, roleShare: { recent: 0.08, allTime: 0.06 } },
  ]

  const poolCredible: PoolEntry[] = [
    { championId: 'C1', games: 10, wins: 6, lastPlayed: '2026-01-01' },
    { championId: 'C2', games: 5, wins: 3, lastPlayed: '2025-12-01' },
  ]

  const poolBurned: PoolEntry[] = [
    { championId: 'C4', games: 3, wins: 1, lastPlayed: '2025-11-01' },
  ]

  const player: GamePlanPlayer = {
    playerId: 'P1',
    playerName: 'Player One',
    role: 'top',
    pool: { credible: poolCredible, burned: poolBurned },
    likelihoods,
    startLikelihoods,
    priorGames: 18,
  }

  const threatHit: ThreatHit = { playerId: 'P1', playerName: 'Player One', probability: 0.4 }

  const leverageEntry: BanLeverageEntry = {
    championId: 'C1',
    threatFromOpponent: 0.5,
    threatFromOwn: 0.2,
    leverage: 0.3,
    opponentHits: [threatHit],
    ownHits: [],
  }

  const denialEntry: DenialPickEntry = {
    championId: 'C2',
    ownPlayerId: 'P1',
    ownPlayerName: 'Player One',
    ownProbability: 0.3,
    gamesPlayed: 5,
    threatFromOpponent: 0.4,
    opponentHits: [threatHit],
  }

  const teamLeverage: GamePlanTeamLeverage = {
    leverage: [leverageEntry],
    denial: [denialEntry],
  }

  const roleMap = new Map<Role, GamePlanPlayer>([['top', player]])
  const lineup: Lineup = {
    T1: [{ playerId: 'P1', playerName: 'Player One', role: 'top' }],
    T2: [{ playerId: 'P2', playerName: 'Player Two', role: 'top' }],
  }

  const game: GameDraft = {
    gameId: 'G1',
    gameNumber: 2,
    patch: '14.1',
    sides: { blue: 'T1', red: 'T2' },
    winnerTeamId: null,
    actions: [],
    picks: [],
  }

  return {
    lineup,
    lineupChanged: new Map<string, boolean>([['T1', false], ['T2', true]]),
    burned: new Set(['C4']),
    burnedByGame: new Map<string, number>([['C4', 1]]),
    availableChampions: new Set(['C1', 'C2', 'C3']),
    players: [['T1', roleMap], ['T2', new Map<Role, GamePlanPlayer>()]],
    unknownRolePlayers: [['T1', []], ['T2', []]],
    leverage: new Map<string, GamePlanTeamLeverage>([['T1', teamLeverage], ['T2', teamLeverage]]),
    game,
  }
}

describe('encodePlan / decodePlan', () => {
  it('round-trip preserves pools, burned sets, lineup, and leverage', () => {
    const plan = buildFixture()
    const encoded = encodePlan(plan)
    const decoded = decodePlan(encoded)

    // Check lineup
    assert.deepEqual(decoded.lineup['T1'].map(p => p.playerId), ['P1'])
    assert.deepEqual(decoded.lineup['T2'].map(p => p.playerId), ['P2'])

    // Check lineupChanged
    assert.equal(decoded.lineupChanged.get('T1'), false)
    assert.equal(decoded.lineupChanged.get('T2'), true)

    // Check burned set
    assert.deepEqual(decoded.burned, new Set(['C4']))

    // Check burnedByGame
    assert.equal(decoded.burnedByGame.get('C4'), 1)

    // Check available champions
    assert.deepEqual(decoded.availableChampions, new Set(['C1', 'C2', 'C3']))

    // Check players
    const t1RoleMap = decoded.players.find(([tid]) => tid === 'T1')?.[1]
    assert.ok(t1RoleMap)
    const topPlayer = t1RoleMap.get('top')
    assert.ok(topPlayer)
    assert.equal(topPlayer.playerId, 'P1')
    assert.equal(topPlayer.playerName, 'Player One')
    assert.equal(topPlayer.role, 'top')
    assert.equal(topPlayer.priorGames, 18)

    // Check credible pool
    assert.equal(topPlayer.pool.credible.length, 2)
    assert.equal(topPlayer.pool.credible[0].championId, 'C1')
    assert.equal(topPlayer.pool.credible[0].games, 10)
    assert.equal(topPlayer.pool.credible[0].wins, 6)
    assert.equal(topPlayer.pool.credible[0].lastPlayed, '2026-01-01')

    // Check burned pool
    assert.equal(topPlayer.pool.burned.length, 1)
    assert.equal(topPlayer.pool.burned[0].championId, 'C4')

    // Check likelihood order and probabilities (within 0.00001)
    assert.equal(topPlayer.likelihoods.length, 3)
    assert.equal(topPlayer.likelihoods[0].championId, 'C1')
    assert.ok(Math.abs(topPlayer.likelihoods[0].probability - 0.4) < 0.00001)
    assert.equal(topPlayer.likelihoods[1].championId, 'C2')
    assert.ok(Math.abs(topPlayer.likelihoods[1].probability - 0.3) < 0.00001)

    // Check roleShare preserved
    assert.ok(Math.abs(topPlayer.likelihoods[0].roleShare!.recent! - 0.15) < 0.0001)
    assert.ok(Math.abs(topPlayer.likelihoods[0].roleShare!.allTime - 0.1) < 0.0001)
    assert.equal(topPlayer.likelihoods[2].roleShare!.recent, null)

    // Check startLikelihoods
    assert.equal(topPlayer.startLikelihoods.length, 3)
    assert.equal(topPlayer.startLikelihoods[0].championId, 'C1')

    // Check leverage
    const lev = decoded.leverage.get('T1')
    assert.ok(lev)
    assert.equal(lev.leverage.length, 1)
    assert.equal(lev.leverage[0].championId, 'C1')
    assert.equal(lev.leverage[0].leverage, 0.3)
    assert.equal(lev.denial.length, 1)
    assert.equal(lev.denial[0].championId, 'C2')

    // Check game
    assert.equal(decoded.game.gameId, 'G1')
    assert.equal(decoded.game.gameNumber, 2)
  })

  it('features are filled with zeros after decode', () => {
    const plan = buildFixture()
    const encoded = encodePlan(plan)
    const decoded = decodePlan(encoded)
    const t1RoleMap = decoded.players.find(([tid]) => tid === 'T1')?.[1]
    const topPlayer = t1RoleMap!.get('top')!
    // Features are zeroed, not the original values
    assert.deepEqual(topPlayer.likelihoods[0].features, { recentGames: 0, played: 0, roleMeta: 0, roleAllTime: 0 })
  })

  it('encoded champion list contains all champions', () => {
    const plan = buildFixture()
    const encoded = encodePlan(plan)
    const champSet = new Set(encoded.champions)
    assert.ok(champSet.has('C1'))
    assert.ok(champSet.has('C2'))
    assert.ok(champSet.has('C3'))
    assert.ok(champSet.has('C4'))
  })
})
