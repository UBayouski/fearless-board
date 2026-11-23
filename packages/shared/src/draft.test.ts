import assert from 'node:assert/strict'
import { test, describe } from 'node:test'
import {
  draftReducer, actingTeam, currentSlotType, liveGamePlan, firstTeamOfGame,
  type DraftSession, type DraftContext,
} from './index.ts'
import { DRAFT_ORDER, trainPickModel, gamePlan } from './index.ts'
import type { DraftActionInput, PickRow, PlayerRef, Role, PickModel } from './index.ts'

// ── Helpers ──────────────────────────────────────────────────────────

const pickRow = (scheduledStart: string, seriesId: string, gameNumber: number, teamId: string, playerId: string, championId: string, won: boolean): PickRow => ({
  scheduledStart, seriesId, gameNumber, teamId, playerId, championId, won,
})

function makeDraft(): { seriesId: string; event: string; stage: string; scheduledStart: string; teamIds: [string, string]; games: any[]; roleCounts: any; championsSeen: string[] } {
  return {
    seriesId: 's1', event: 'Test', stage: 'Test', scheduledStart: '2025-02-01',
    teamIds: ['tA', 'tB'],
    games: [
      { gameId: 'g1', gameNumber: 1, patch: null, sides: { blue: 'tA', red: 'tB' }, winnerTeamId: 'tA', actions: [],
        picks: [
          { teamId: 'tA', playerId: 'p1', playerName: 'Player One', championId: 'c3' },
          { teamId: 'tA', playerId: 'p2', playerName: 'Player Two', championId: 'c3' },
          { teamId: 'tA', playerId: 'p3', playerName: 'Player Three', championId: 'c3' },
          { teamId: 'tA', playerId: 'p4', playerName: 'Player Four', championId: 'c3' },
          { teamId: 'tA', playerId: 'p5', playerName: 'Player Five', championId: 'c3' },
          { teamId: 'tB', playerId: 'p6', playerName: 'Player Six', championId: 'c4' },
          { teamId: 'tB', playerId: 'p7', playerName: 'Player Seven', championId: 'c4' },
          { teamId: 'tB', playerId: 'p8', playerName: 'Player Eight', championId: 'c4' },
          { teamId: 'tB', playerId: 'p9', playerName: 'Player Nine', championId: 'c4' },
          { teamId: 'tB', playerId: 'p10', playerName: 'Player Ten', championId: 'c4' },
        ],
      },
      { gameId: 'g2', gameNumber: 2, patch: null, sides: { blue: 'tB', red: 'tA' }, winnerTeamId: 'tB', actions: [],
        picks: [
          { teamId: 'tA', playerId: 'p1', playerName: 'Player One', championId: 'c5' },
          { teamId: 'tA', playerId: 'p2', playerName: 'Player Two', championId: 'c5' },
          { teamId: 'tA', playerId: 'p3', playerName: 'Player Three', championId: 'c5' },
          { teamId: 'tA', playerId: 'p4', playerName: 'Player Four', championId: 'c5' },
          { teamId: 'tA', playerId: 'p5', playerName: 'Player Five', championId: 'c5' },
          { teamId: 'tB', playerId: 'p6', playerName: 'Player Six', championId: 'c1' },
          { teamId: 'tB', playerId: 'p7', playerName: 'Player Seven', championId: 'c1' },
          { teamId: 'tB', playerId: 'p8', playerName: 'Player Eight', championId: 'c1' },
          { teamId: 'tB', playerId: 'p9', playerName: 'Player Nine', championId: 'c1' },
          { teamId: 'tB', playerId: 'p10', playerName: 'Player Ten', championId: 'c1' },
        ],
      },
    ],
    roleCounts: {
      top: { total45: 20, totalAll: 100, champions: { c1: [3, 10], c2: [5, 20] } },
      jungle: { total45: 20, totalAll: 100, champions: { c1: [3, 10], c2: [5, 20] } },
      mid: { total45: 20, totalAll: 100, champions: { c1: [3, 10], c2: [5, 20] } },
      bot: { total45: 20, totalAll: 100, champions: { c1: [3, 10], c2: [5, 20] } },
      support: { total45: 20, totalAll: 100, champions: { c1: [3, 10], c2: [5, 20] } },
    },
    championsSeen: ['c1', 'c2', 'c3', 'c4', 'c5'],
  }
}

const playerMap = new Map<string, PlayerRef>([
  ['p1', { id: 'p1', name: 'Player One', role: 'top' }],
  ['p2', { id: 'p2', name: 'Player Two', role: 'jungle' }],
  ['p3', { id: 'p3', name: 'Player Three', role: 'mid' }],
  ['p4', { id: 'p4', name: 'Player Four', role: 'bot' }],
  ['p5', { id: 'p5', name: 'Player Five', role: 'support' }],
  ['p6', { id: 'p6', name: 'Player Six', role: 'top' }],
  ['p7', { id: 'p7', name: 'Player Seven', role: 'jungle' }],
  ['p8', { id: 'p8', name: 'Player Eight', role: 'mid' }],
  ['p9', { id: 'p9', name: 'Player Nine', role: 'bot' }],
  ['p10', { id: 'p10', name: 'Player Ten', role: 'support' }],
])

function makeModel(): PickModel {
  const examples = []
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
  return trainPickModel(examples)
}

function makeCtx(): DraftContext {
  const burned = new Set<string>()
  burned.add('c3')
  burned.add('c4')
  const tp = new Map<string, Set<string>>()
  tp.set('tA', new Set(['p1', 'p2', 'p3', 'p4', 'p5']))
  tp.set('tB', new Set(['p6', 'p7', 'p8', 'p9', 'p10']))
  return { teamIds: ['tA', 'tB'], burned, teamPlayers: tp }
}

// ── Tests ────────────────────────────────────────────────────────────

describe('draftReducer', () => {
  const initialSession: DraftSession = { firstTeamId: 'tA', actions: [], replay: null }
  const ctx = makeCtx()

  test('a full 20-action session ends complete', () => {
    let session = initialSession
    const banChamps = ['c1', 'c2', 'c5', 'c6', 'c7', 'c8', 'c9', 'c10', 'c11', 'c12']
    let banIdx = 0
    const pickChamps = ['c13', 'c14', 'c15', 'c16', 'c17', 'c18', 'c19', 'c20', 'c21', 'c22', 'c23', 'c24']
    let pickIdx = 0
    // Pick players follow the draft order: 1-p, 2-p, 2-p, 1-p, 1-p, 2-p, 2-p, 1-p, 1-p, 2-p
    const pickPlayers = ['p1', 'p6', 'p7', 'p2', 'p3', 'p8', 'p9', 'p4', 'p5', 'p10']

    for (let i = 0; i < DRAFT_ORDER.length; i++) {
      const slot = DRAFT_ORDER[i]
      if (slot[2] === 'b') {
        session = draftReducer(session, { type: 'ban', championId: banChamps[banIdx++] }, ctx)
      } else {
        session = draftReducer(session, { type: 'pick', playerId: pickPlayers[pickIdx], championId: pickChamps[pickIdx++] }, ctx)
      }
    }

    assert.strictEqual(session.actions.length, 20)
    assert.strictEqual(currentSlotType(session), null)
  })

  test('rejects a ban on a pick turn', () => {
    let session = initialSession
    for (let i = 0; i < 6; i++) {
      session = draftReducer(session, { type: 'ban', championId: `cb${i}` }, ctx)
    }
    const before = session.actions.length
    session = draftReducer(session, { type: 'ban', championId: 'c99' }, ctx)
    assert.strictEqual(session.actions.length, before)
  })

  test('rejects a pick on a ban turn', () => {
    const before = initialSession.actions.length
    const session = draftReducer(initialSession, { type: 'pick', playerId: 'p1', championId: 'c1' }, ctx)
    assert.strictEqual(session.actions.length, before)
  })

  test('rejects a pick by a player of the team that is not acting', () => {
    let session = initialSession
    for (let i = 0; i < 6; i++) {
      session = draftReducer(session, { type: 'ban', championId: `cb${i}` }, ctx)
    }
    const before = session.actions.length
    session = draftReducer(session, { type: 'pick', playerId: 'p6', championId: 'c13' }, ctx)
    assert.strictEqual(session.actions.length, before)
  })

  test('rejects a pick by a player who already picked', () => {
    let session = initialSession
    for (let i = 0; i < 6; i++) {
      session = draftReducer(session, { type: 'ban', championId: `cb${i}` }, ctx)
    }
    session = draftReducer(session, { type: 'pick', playerId: 'p1', championId: 'c13' }, ctx)
    assert.strictEqual(session.actions.length, 7)
    const before = session.actions.length
    session = draftReducer(session, { type: 'pick', playerId: 'p1', championId: 'c14' }, ctx)
    assert.strictEqual(session.actions.length, before)
  })

  test('rejects any champion that is unavailable', () => {
    let session = initialSession
    session = draftReducer(session, { type: 'ban', championId: 'c1' }, ctx)
    const before = session.actions.length
    session = draftReducer(session, { type: 'ban', championId: 'c1' }, ctx)
    assert.strictEqual(session.actions.length, before)
    session = draftReducer(session, { type: 'ban', championId: 'c3' }, ctx)
    assert.strictEqual(session.actions.length, before)
  })

  test('undo removes last action', () => {
    let session = initialSession
    session = draftReducer(session, { type: 'ban', championId: 'c1' }, ctx)
    session = draftReducer(session, { type: 'ban', championId: 'c2' }, ctx)
    assert.strictEqual(session.actions.length, 2)
    session = draftReducer(session, { type: 'undo' }, ctx)
    assert.strictEqual(session.actions.length, 1)
    assert.strictEqual(session.actions[0].championId, 'c1')
  })

  test('undo during replay puts action back at front of remaining', () => {
    let session: DraftSession = { firstTeamId: 'tA', actions: [], replay: { remaining: [{ type: 'ban', teamId: 'tA', championId: 'c1' }] } }
    session = draftReducer(session, { type: 'replayNext' }, ctx)
    assert.strictEqual(session.actions.length, 1)
    assert.strictEqual(session.replay!.remaining.length, 0)
    session = draftReducer(session, { type: 'undo' }, ctx)
    assert.strictEqual(session.actions.length, 0)
    assert.strictEqual(session.replay!.remaining.length, 1)
    assert.strictEqual(session.replay!.remaining[0].championId, 'c1')
  })

  test('a red-first session', () => {
    const session: DraftSession = { firstTeamId: 'tB', actions: [], replay: null }
    assert.strictEqual(actingTeam(session, ['tA', 'tB']), 'tB')
  })

  test('setFirstTeam only works when no actions', () => {
    let session = initialSession
    session = draftReducer(session, { type: 'ban', championId: 'c1' }, ctx)
    const before = session.firstTeamId
    session = draftReducer(session, { type: 'setFirstTeam', teamId: 'tB' }, ctx)
    assert.strictEqual(session.firstTeamId, before)
  })
})

describe('actingTeam', () => {
  test('returns first team for side 1', () => {
    const session: DraftSession = { firstTeamId: 'tA', actions: [], replay: null }
    assert.strictEqual(actingTeam(session, ['tA', 'tB']), 'tA')
  })

  test('returns second team for side 2', () => {
    const session: DraftSession = { firstTeamId: 'tA', actions: [{ type: 'ban', teamId: 'tA', championId: 'c1' }], replay: null }
    assert.strictEqual(actingTeam(session, ['tA', 'tB']), 'tB')
  })
})

describe('firstTeamOfGame', () => {
  test('returns the team of the first action', () => {
    const actions: DraftActionInput[] = [
      { type: 'ban', teamId: 'tB', championId: 'c1' },
      { type: 'ban', teamId: 'tA', championId: 'c2' },
    ]
    assert.strictEqual(firstTeamOfGame(actions), 'tB')
  })

  test('returns null for empty actions', () => {
    assert.strictEqual(firstTeamOfGame([]), null)
  })
})

describe('liveGamePlan', () => {
  const picks: PickRow[] = []
  for (let g = 0; g < 20; g++) {
    const date = `2025-01-${String(g + 1).padStart(2, '0')}`
    const champ = g % 3 === 0 ? 'c2' : 'c1'
    for (const pid of ['p1', 'p2', 'p3', 'p4', 'p5']) {
      picks.push(pickRow(date, `s${g}`, 1, 'tA', pid, champ, true))
    }
    for (const pid of ['p6', 'p7', 'p8', 'p9', 'p10']) {
      picks.push(pickRow(date, `s${g}`, 1, 'tB', pid, champ, false))
    }
  }
  const model = makeModel()
  const draft = makeDraft() as any
  const playerRole = new Map<string, Role | null>()
  for (const [id, p] of playerMap) playerRole.set(id, p.role)
  const plan = gamePlan(draft, 2, picks, model, playerRole)

  test('after one ban: champion is in no list, every list sums to 1', () => {
    const session: DraftSession = {
      firstTeamId: 'tA',
      actions: [{ type: 'ban', teamId: 'tA', championId: 'c2' }],
      replay: null,
    }
    const live = liveGamePlan(plan, session, picks, model, playerRole, draft)

    for (const [, roleMap] of live.players) {
      for (const [, gp] of roleMap) {
        const hasC2 = gp.likelihoods.some(l => l.championId === 'c2')
        assert.strictEqual(hasC2, false)
        const sum = gp.likelihoods.reduce((s, l) => s + l.probability, 0)
        if (gp.likelihoods.length > 0) {
          assert.ok(Math.abs(sum - 1) < 0.0001, `sum ${sum} should be close to 1`)
        }
      }
    }
  })

  test('after one pick: the player has no list, the champion is gone for all', () => {
    const session: DraftSession = {
      firstTeamId: 'tA',
      actions: [
        { type: 'ban', teamId: 'tA', championId: 'c2' },
        { type: 'ban', teamId: 'tB', championId: 'c5' },
        { type: 'ban', teamId: 'tA', championId: 'c6' },
        { type: 'ban', teamId: 'tB', championId: 'c7' },
        { type: 'ban', teamId: 'tA', championId: 'c8' },
        { type: 'ban', teamId: 'tB', championId: 'c9' },
        { type: 'pick', teamId: 'tA', championId: 'c10', playerId: 'p1' },
      ],
      replay: null,
    }
    const live = liveGamePlan(plan, session, picks, model, playerRole, draft)

    // Find p1 across all roles and teams
    let p1gp = undefined
    for (const [, roleMap] of live.players) {
      for (const [, gp] of roleMap) {
        if (gp.playerId === 'p1') { p1gp = gp; break }
      }
      if (p1gp) break
    }
    assert.ok(p1gp !== undefined, 'p1 should exist in plan')
    assert.strictEqual(p1gp!.likelihoods.length, 0)

    for (const [, roleMap] of live.players) {
      for (const [, gp] of roleMap) {
        if (gp.playerId === 'p1') continue
        const hasC10 = gp.likelihoods.some(l => l.championId === 'c10')
        assert.strictEqual(hasC10, false)
      }
    }
  })
})
