import assert from 'node:assert/strict'
import { test } from 'node:test'
import { backtestLeverage, type DraftAction, type PickRow, type SeriesDraft, type Role, type PickModel } from './index.ts'

const action = (order: number, type: DraftAction['type'], teamId: string, championId: string): DraftAction => ({
  order,
  type,
  teamId,
  championId,
})


// ── 2b: backtestLeverage tests ─────────────────────────────────────────

test('backtestLeverage: throws when player with role has empty likelihoods', () => {
  // Create a series where championsSeen is empty, so allChampionIds is empty,
  // so pickFeatures returns empty candidates, so pickLikelihoods returns empty
  const draft: SeriesDraft = {
    seriesId: 's1',
    event: 'Test',
    stage: 'Test',
    scheduledStart: '2026-02-01',
    teamIds: ['tA', 'tB'],
    games: [
      {
        gameId: 'g1',
        gameNumber: 1,
        patch: null,
        sides: { blue: 'tA', red: 'tB' },
        winnerTeamId: 'tA',
        actions: [action(1, 'ban', 'tA', 'c1')],
        picks: [
          { teamId: 'tA', playerId: 'p1', playerName: 'Player1', championId: 'c2' },
          { teamId: 'tA', playerId: 'p2', playerName: 'Player2', championId: 'c3' },
          { teamId: 'tA', playerId: 'p3', playerName: 'Player3', championId: 'c4' },
          { teamId: 'tA', playerId: 'p4', playerName: 'Player4', championId: 'c5' },
          { teamId: 'tA', playerId: 'p5', playerName: 'Player5', championId: 'c6' },
          { teamId: 'tB', playerId: 'p6', playerName: 'Player6', championId: 'c7' },
          { teamId: 'tB', playerId: 'p7', playerName: 'Player7', championId: 'c8' },
          { teamId: 'tB', playerId: 'p8', playerName: 'Player8', championId: 'c9' },
          { teamId: 'tB', playerId: 'p9', playerName: 'Player9', championId: 'c10' },
          { teamId: 'tB', playerId: 'p10', playerName: 'Player10', championId: 'c11' },
        ],
      },
    ],
    roleCounts: {
      mid: { total45: 100, totalAll: 500, champions: { c1: [10, 50] as [number, number] } },
      top: { total45: 100, totalAll: 500, champions: { c1: [10, 50] as [number, number] } },
      jungle: { total45: 100, totalAll: 500, champions: { c1: [10, 50] as [number, number] } },
      bot: { total45: 100, totalAll: 500, champions: { c1: [10, 50] as [number, number] } },
      support: { total45: 100, totalAll: 500, champions: { c1: [10, 50] as [number, number] } },
    },
    championsSeen: [], // empty → allChampionIds empty → pickFeatures returns [] → pickLikelihoods returns []
  }

  const picks: PickRow[] = []
  const model: PickModel = { weights: [0, 0, 0, 0], mean: [0, 0, 0, 0], sd: [1, 1, 1, 1], meanLogLikelihood: 0, iterations: 0 }
  const playerRole = new Map<string, Role | null>()
  playerRole.set('p1', 'mid')
  playerRole.set('p2', 'top')
  playerRole.set('p3', 'jungle')
  playerRole.set('p4', 'bot')
  playerRole.set('p5', 'support')
  playerRole.set('p6', 'top')
  playerRole.set('p7', 'jungle')
  playerRole.set('p8', 'mid')
  playerRole.set('p9', 'bot')
  playerRole.set('p10', 'support')

  assert.throws(
    () => backtestLeverage([draft], picks, model, playerRole),
    /empty likelihoods/,
  )
})

test('backtestLeverage: throws when series missing roleCounts', () => {
  const draft: SeriesDraft = {
    seriesId: 's1',
    event: 'Test',
    stage: 'Test',
    scheduledStart: '2026-02-01',
    teamIds: ['tA', 'tB'],
    games: [
      {
        gameId: 'g1',
        gameNumber: 1,
        patch: null,
        sides: { blue: 'tA', red: 'tB' },
        winnerTeamId: 'tA',
        actions: [action(1, 'ban', 'tA', 'c1')],
        picks: [
          { teamId: 'tA', playerId: 'p1', playerName: 'Player1', championId: 'c2' },
          { teamId: 'tA', playerId: 'p2', playerName: 'Player2', championId: 'c3' },
          { teamId: 'tA', playerId: 'p3', playerName: 'Player3', championId: 'c4' },
          { teamId: 'tA', playerId: 'p4', playerName: 'Player4', championId: 'c5' },
          { teamId: 'tA', playerId: 'p5', playerName: 'Player5', championId: 'c6' },
          { teamId: 'tB', playerId: 'p6', playerName: 'Player6', championId: 'c7' },
          { teamId: 'tB', playerId: 'p7', playerName: 'Player7', championId: 'c8' },
          { teamId: 'tB', playerId: 'p8', playerName: 'Player8', championId: 'c9' },
          { teamId: 'tB', playerId: 'p9', playerName: 'Player9', championId: 'c10' },
          { teamId: 'tB', playerId: 'p10', playerName: 'Player10', championId: 'c11' },
        ],
      },
    ],
    // roleCounts intentionally missing
  }

  const picks: PickRow[] = []
  const model: PickModel = { weights: [0, 0, 0, 0], mean: [0, 0, 0, 0], sd: [1, 1, 1, 1], meanLogLikelihood: 0, iterations: 0 }
  const playerRole = new Map<string, Role | null>()
  for (const pid of ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8', 'p9', 'p10']) {
    playerRole.set(pid, 'mid')
  }

  assert.throws(
    () => backtestLeverage([draft], picks, model, playerRole),
    /missing roleCounts/,
  )
})
