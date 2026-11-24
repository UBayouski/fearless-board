// The fixture series shared by the board's render tests and interaction tests: two teams of five players
// with twenty earlier games, a three-game series, a small trained model, and the board inside the app's context.
import React from 'react'
import { SeriesBoard } from './SeriesBoard'
import { UiContext } from '../ui'
import { trainPickModel, gamePlan as computeGamePlan, draftReducer, encodePlan, decodePlan, type DraftEvent, type DraftSession } from '@fearless-board/shared'
import type { SeriesDraft, PickRow, PlayerRef, TeamRef, ChampionRef, PickExample, Role, GamePlan } from '@fearless-board/shared'

// ── Helpers ──────────────────────────────────────────────────────────

export const pickRow = (scheduledStart: string, seriesId: string, gameNumber: number, teamId: string, playerId: string, championId: string, won: boolean): PickRow => ({
  scheduledStart, seriesId, gameNumber, teamId, playerId, championId, won,
})

// ── Fixture ──────────────────────────────────────────────────────────

export const teamMap = new Map<string, TeamRef>([
  ['tA', { id: 'tA', name: 'Team Alpha' }],
  ['tB', { id: 'tB', name: 'Team Beta' }],
])

// Need at least 10 distinct champions for 6 bans + 2 picks
export const championMap = new Map<string, ChampionRef>([
  ['c1', { id: 'c1', name: 'Champion One' }],
  ['c2', { id: 'c2', name: 'Champion Two' }],
  ['c3', { id: 'c3', name: 'Champion Three' }],
  ['c4', { id: 'c4', name: 'Champion Four' }],
  ['c5', { id: 'c5', name: 'Champion Five' }],
  ['c6', { id: 'c6', name: 'Champion Six' }],
  ['c7', { id: 'c7', name: 'Champion Seven' }],
  ['c8', { id: 'c8', name: 'Champion Eight' }],
  ['c9', { id: 'c9', name: 'Champion Nine' }],
  ['c10', { id: 'c10', name: 'Champion Ten' }],
])

export const playerMap = new Map<string, PlayerRef>([
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

export const picks: PickRow[] = []
// Generate 20 prior games per player so they have enough history
// Alternate between c1 and c2 so both are in each player's pool
for (let g = 0; g < 20; g++) {
  const date = `2025-01-${String(g + 1).padStart(2, '0')}`
  const champ = g % 3 === 0 ? 'c2' : 'c1' // c2 appears ~7 times, c1 ~13 times
  picks.push(pickRow(date, `s${g}`, 1, 'tA', 'p1', champ, true))
  picks.push(pickRow(date, `s${g}`, 1, 'tA', 'p2', champ, true))
  picks.push(pickRow(date, `s${g}`, 1, 'tA', 'p3', champ, true))
  picks.push(pickRow(date, `s${g}`, 1, 'tA', 'p4', champ, true))
  picks.push(pickRow(date, `s${g}`, 1, 'tA', 'p5', champ, true))
  picks.push(pickRow(date, `s${g}`, 1, 'tB', 'p6', champ, false))
  picks.push(pickRow(date, `s${g}`, 1, 'tB', 'p7', champ, false))
  picks.push(pickRow(date, `s${g}`, 1, 'tB', 'p8', champ, false))
  picks.push(pickRow(date, `s${g}`, 1, 'tB', 'p9', champ, false))
  picks.push(pickRow(date, `s${g}`, 1, 'tB', 'p10', champ, false))
}

export const draft: SeriesDraft = {
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
    {
      gameId: 'g2', gameNumber: 2, patch: null,
      sides: { blue: 'tB', red: 'tA' }, winnerTeamId: 'tB', actions: [],
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
    {
      gameId: 'g3', gameNumber: 3, patch: null,
      sides: { blue: 'tA', red: 'tB' }, winnerTeamId: null, actions: [],
      picks: [
        { teamId: 'tA', playerId: 'p1', playerName: 'Player One', championId: 'c1' },
        { teamId: 'tA', playerId: 'p2', playerName: 'Player Two', championId: 'c1' },
        { teamId: 'tA', playerId: 'p3', playerName: 'Player Three', championId: 'c1' },
        { teamId: 'tA', playerId: 'p4', playerName: 'Player Four', championId: 'c1' },
        { teamId: 'tA', playerId: 'p5', playerName: 'Player Five', championId: 'c1' },
        { teamId: 'tB', playerId: 'p6', playerName: 'Player Six', championId: 'c2' },
        { teamId: 'tB', playerId: 'p7', playerName: 'Player Seven', championId: 'c2' },
        { teamId: 'tB', playerId: 'p8', playerName: 'Player Eight', championId: 'c2' },
        { teamId: 'tB', playerId: 'p9', playerName: 'Player Nine', championId: 'c2' },
        { teamId: 'tB', playerId: 'p10', playerName: 'Player Ten', championId: 'c2' },
      ],
    },
  ],
  roleCounts: {
    top: { total45: 20, totalAll: 100, champions: { c1: [3, 10] as [number, number], c2: [5, 20] as [number, number] } },
    jungle: { total45: 20, totalAll: 100, champions: { c1: [3, 10] as [number, number], c2: [5, 20] as [number, number] } },
    mid: { total45: 20, totalAll: 100, champions: { c1: [3, 10] as [number, number], c2: [5, 20] as [number, number] } },
    bot: { total45: 20, totalAll: 100, champions: { c1: [3, 10] as [number, number], c2: [5, 20] as [number, number] } },
    support: { total45: 20, totalAll: 100, champions: { c1: [3, 10] as [number, number], c2: [5, 20] as [number, number] } },
  },
  championsSeen: ['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8', 'c9', 'c10'],
}

// Train a simple model
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
export const model = trainPickModel(examples)

// Build planFor from computed plans (full mode)
export const playerRole = new Map<string, Role | null>()
for (const [id, p] of playerMap) {
  playerRole.set(id, p.role)
}
const plans: Record<number, GamePlan> = {}
for (const game of draft.games) {
  plans[game.gameNumber] = computeGamePlan(draft, game.gameNumber, picks, model, playerRole)
}
export const planFor = (gameNumber: number): GamePlan | null => plans[gameNumber] ?? null

// Build planFor from encoded plans (demo mode)
const encodedPlans: Record<number, any> = {}
for (const game of draft.games) {
  encodedPlans[game.gameNumber] = encodePlan(plans[game.gameNumber])
}
export const decodedPlanFor = (gameNumber: number): GamePlan | null => {
  const encoded = encodedPlans[gameNumber]
  if (!encoded) return null
  return decodePlan(encoded)
}

// The base fixture gives both teams the same pools, so no ban stands out. Here team Alpha's players also
// played Champion Eight in twenty more games, so Team Beta gets a ban row for it.
const alphaOnEight = [...picks]
for (let g = 0; g < 20; g++) {
  for (const playerId of ['p1', 'p2', 'p3', 'p4', 'p5']) {
    alphaOnEight.push(pickRow(`2025-01-${String(g + 2).padStart(2, '0')}`, `e${g}`, 1, 'tA', playerId, 'c8', true))
  }
}
const leveragePlans = new Map(draft.games.map(game => [game.gameNumber, computeGamePlan(draft, game.gameNumber, alphaOnEight, model, playerRole)]))
export const leveragePlanFor = (gameNumber: number): GamePlan | null => leveragePlans.get(gameNumber) ?? null

/** The draft context of the fixture series in game 3: both lineups, with c5 burned in game 1. */
export const draftContext = {
  teamIds: ['tA', 'tB'],
  burned: new Set(['c5']),
  teamPlayers: new Map([
    ['tA', new Set(['p1', 'p2', 'p3', 'p4', 'p5'])],
    ['tB', new Set(['p6', 'p7', 'p8', 'p9', 'p10'])],
  ]),
}

/** A draft session of the fixture with team A first, after the given bans and picks. */
export function sessionAfter(...events: DraftEvent[]): DraftSession {
  let session: DraftSession = { firstTeamId: 'tA', actions: [], replay: null }
  for (const event of events) session = draftReducer(session, event, draftContext)
  return session
}

/** The board inside the context the app gives it. Icons are off unless a case turns them on. */
export function board(props: Partial<React.ComponentProps<typeof SeriesBoard>> & { selectedGame: number }, ui: { icons?: boolean } = {}) {
  return React.createElement(
    UiContext.Provider,
    { value: { championMap, teamMap, icons: ui.icons ?? false, ddragon: '1.2.3' } },
    React.createElement(SeriesBoard, { draft, planFor, playerMap, onSelectGame: () => {}, ...props }),
  )
}
