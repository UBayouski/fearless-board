// Tests for outlook functions: burnedShare, expectedBurn, pickCost, seriesOutlook.

import { describe, it } from 'node:test'
import assert from 'node:assert'
import { burnedShare, expectedBurn, pickCost, seriesOutlook } from './outlook.ts'
import type { GamePlan, GamePlanPlayer, PickLikelihood, Role } from './types.ts'

function makePlayer(
  playerId: string,
  playerName: string,
  role: Role,
  likelihoods: PickLikelihood[],
  startLikelihoods: PickLikelihood[],
  priorGames: number,
): GamePlanPlayer {
  return {
    playerId,
    playerName,
    role,
    pool: { credible: [], burned: [] },
    likelihoods,
    startLikelihoods,
    priorGames,
  }
}

function makePlan(players: [string, Map<Role, GamePlanPlayer>][], burned: Set<string>): GamePlan {
  return {
    lineup: {},
    lineupChanged: new Map(),
    burned,
    burnedByGame: new Map(),
    availableChampions: new Set<string>(),
    players,
    unknownRolePlayers: [],
    leverage: new Map(),
    game: {
      gameId: 'test',
      gameNumber: 2,
      patch: null,
      sides: { blue: 'teamA', red: 'teamB' },
      winnerTeamId: null,
      actions: [],
      picks: [],
    },
  }
}

describe('burnedShare', () => {
  it('burned champion with start probability 0.3 gives 0.3', () => {
    const player = makePlayer(
      'p1', 'Player1', 'top',
      [], // likelihoods not used by burnedShare
      [
        { championId: 'c1', probability: 0.3, features: { recentGames: 0, played: 0, roleMeta: 0, roleAllTime: 0 } },
        { championId: 'c2', probability: 0.7, features: { recentGames: 0, played: 0, roleMeta: 0, roleAllTime: 0 } },
      ],
      25,
    )
    const burned = new Set(['c1'])
    const share = burnedShare(player, burned)
    assert.strictEqual(share, 0.3)
  })

  it('multiple burned champions sum probabilities', () => {
    const player = makePlayer(
      'p1', 'Player1', 'mid',
      [],
      [
        { championId: 'c1', probability: 0.2, features: { recentGames: 0, played: 0, roleMeta: 0, roleAllTime: 0 } },
        { championId: 'c2', probability: 0.3, features: { recentGames: 0, played: 0, roleMeta: 0, roleAllTime: 0 } },
        { championId: 'c3', probability: 0.5, features: { recentGames: 0, played: 0, roleMeta: 0, roleAllTime: 0 } },
      ],
      30,
    )
    const burned = new Set(['c1', 'c2'])
    const share = burnedShare(player, burned)
    assert.strictEqual(share, 0.5)
  })

  it('no burned champions gives 0', () => {
    const player = makePlayer(
      'p1', 'Player1', 'bot',
      [],
      [
        { championId: 'c1', probability: 0.5, features: { recentGames: 0, played: 0, roleMeta: 0, roleAllTime: 0 } },
      ],
      20,
    )
    const burned = new Set<string>()
    const share = burnedShare(player, burned)
    assert.strictEqual(share, 0)
  })
})

describe('expectedBurn', () => {
  it('two players at 0.5 on one champion give expected burn reflecting combined threat', () => {
    // Two players, both have 0.5 probability on champion c1.
    // Threat from both = 1 - (1-0.5)*(1-0.5) = 0.75
    // Expected burn for player 1 = 0.5 * 0.75 = 0.375
    const p1 = makePlayer('p1', 'Player1', 'top',
      [{ championId: 'c1', probability: 0.5, features: { recentGames: 0, played: 0, roleMeta: 0, roleAllTime: 0 } }],
      [{ championId: 'c1', probability: 0.5, features: { recentGames: 0, played: 0, roleMeta: 0, roleAllTime: 0 } }],
      25,
    )
    const p2 = makePlayer('p2', 'Player2', 'jungle',
      [{ championId: 'c1', probability: 0.5, features: { recentGames: 0, played: 0, roleMeta: 0, roleAllTime: 0 } }],
      [{ championId: 'c1', probability: 0.5, features: { recentGames: 0, played: 0, roleMeta: 0, roleAllTime: 0 } }],
      25,
    )
    const roleMap = new Map<Role, GamePlanPlayer>()
    roleMap.set('top', p1)
    roleMap.set('jungle', p2)
    const plan = makePlan([['teamA', roleMap]], new Set())

    const result = expectedBurn(plan)
    // Threat = 1 - (1-0.5)*(1-0.5) = 0.75
    // Expected burn = 0.5 * 0.75 = 0.375
    assert.strictEqual(result.get('p1'), 0.375)
    assert.strictEqual(result.get('p2'), 0.375)
  })
})

describe('pickCost', () => {
  it('pickCost of a champion nobody has gives 0', () => {
    const p1 = makePlayer('p1', 'Player1', 'top',
      [{ championId: 'c1', probability: 1.0, features: { recentGames: 0, played: 0, roleMeta: 0, roleAllTime: 0 } }],
      [{ championId: 'c1', probability: 1.0, features: { recentGames: 0, played: 0, roleMeta: 0, roleAllTime: 0 } }],
      25,
    )
    const roleMap = new Map<Role, GamePlanPlayer>()
    roleMap.set('top', p1)
    const plan = makePlan([['teamA', roleMap]], new Set())

    const result = pickCost(plan, 'c_unknown')
    const teamPlayers = result.players.get('teamA')!
    assert.strictEqual(teamPlayers[0].probability, 0)
    assert.strictEqual(result.combined.get('teamA'), 0)
  })

  it('two players at 0.5 on one champion give combined 0.75', () => {
    const p1 = makePlayer('p1', 'Player1', 'top',
      [{ championId: 'c1', probability: 0.5, features: { recentGames: 0, played: 0, roleMeta: 0, roleAllTime: 0 } }],
      [{ championId: 'c1', probability: 0.5, features: { recentGames: 0, played: 0, roleMeta: 0, roleAllTime: 0 } }],
      25,
    )
    const p2 = makePlayer('p2', 'Player2', 'mid',
      [{ championId: 'c1', probability: 0.5, features: { recentGames: 0, played: 0, roleMeta: 0, roleAllTime: 0 } }],
      [{ championId: 'c1', probability: 0.5, features: { recentGames: 0, played: 0, roleMeta: 0, roleAllTime: 0 } }],
      25,
    )
    const roleMap = new Map<Role, GamePlanPlayer>()
    roleMap.set('top', p1)
    roleMap.set('mid', p2)
    const plan = makePlan([['teamA', roleMap]], new Set())

    const result = pickCost(plan, 'c1')
    const teamPlayers = result.players.get('teamA')!
    assert.strictEqual(teamPlayers[0].probability, 0.5)
    assert.strictEqual(teamPlayers[1].probability, 0.5)
    // Combined = 1 - (1-0.5)*(1-0.5) = 0.75
    assert.strictEqual(result.combined.get('teamA'), 0.75)
  })
})

describe('seriesOutlook', () => {
  it('returns burned share and expected burn per player', () => {
    const p1 = makePlayer('p1', 'Player1', 'top',
      [{ championId: 'c1', probability: 0.5, features: { recentGames: 0, played: 0, roleMeta: 0, roleAllTime: 0 } }],
      [
        { championId: 'c1', probability: 0.3, features: { recentGames: 0, played: 0, roleMeta: 0, roleAllTime: 0 } },
        { championId: 'c2', probability: 0.7, features: { recentGames: 0, played: 0, roleMeta: 0, roleAllTime: 0 } },
      ],
      25,
    )
    const roleMap = new Map<Role, GamePlanPlayer>()
    roleMap.set('top', p1)
    const burned = new Set(['c1'])
    const plan = makePlan([['teamA', roleMap]], burned)

    const result = seriesOutlook(plan)
    assert.strictEqual(result.teams.length, 1)
    const team = result.teams[0]
    assert.strictEqual(team.teamId, 'teamA')
    assert.strictEqual(team.players.length, 1)
    const player = team.players[0]
    assert.strictEqual(player.playerId, 'p1')
    // burnedShare: c1 has start probability 0.3, and c1 is burned
    assert.strictEqual(player.burnedShare, 0.3)
    assert.strictEqual(player.limitedHistory, false)
  })

  it('limitedHistory is true for players with fewer than 20 games', () => {
    const p1 = makePlayer('p1', 'Player1', 'bot',
      [],
      [],
      5,
    )
    const roleMap = new Map<Role, GamePlanPlayer>()
    roleMap.set('bot', p1)
    const plan = makePlan([['teamA', roleMap]], new Set())

    const result = seriesOutlook(plan)
    assert.strictEqual(result.teams[0].players[0].limitedHistory, true)
  })
})
