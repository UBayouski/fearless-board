import { describe, it, expect } from 'vitest'
import React from 'react'
import { renderToReadableStream } from 'react-dom/server'
import { SeriesBoard } from './SeriesBoard'
import { trainPickModel } from '@fearless-board/shared'
import type { SeriesDraft, PickRow, PlayerRef, TeamRef, ChampionRef, PickExample, Role, DraftSession } from '@fearless-board/shared'

// ── Helpers ──────────────────────────────────────────────────────────

async function renderToString(element: React.ReactElement): Promise<string> {
  const stream = renderToReadableStream(element)
  const reader = (await stream).getReader()
  let result = ''
  const decoder = new TextDecoder()
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    result += decoder.decode(value, { stream: true })
  }
  return result
}

const pickRow = (scheduledStart: string, seriesId: string, gameNumber: number, teamId: string, playerId: string, championId: string, won: boolean): PickRow => ({
  scheduledStart, seriesId, gameNumber, teamId, playerId, championId, won,
})

// ── Fixture ──────────────────────────────────────────────────────────

const teamMap = new Map<string, TeamRef>([
  ['tA', { id: 'tA', name: 'Team Alpha' }],
  ['tB', { id: 'tB', name: 'Team Beta' }],
])

const championMap = new Map<string, ChampionRef>([
  ['c1', { id: 'c1', name: 'Champion One' }],
  ['c2', { id: 'c2', name: 'Champion Two' }],
  ['c3', { id: 'c3', name: 'Champion Three' }],
  ['c4', { id: 'c4', name: 'Champion Four' }],
  ['c5', { id: 'c5', name: 'Champion Five' }],
])

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

const picks: PickRow[] = []
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
  championsSeen: ['c1', 'c2', 'c3', 'c4', 'c5'],
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
const model = trainPickModel(examples)

// ── Test ─────────────────────────────────────────────────────────────

describe('SeriesBoard render', () => {
  it('renders both team names, ten player names, and the panel title', async () => {
    const el = React.createElement(SeriesBoard, {
      draft,
      picks,
      teamMap,
      championMap,
      playerMap,
      selectedGame: 2,
      onSelectGame: () => {},
      model,
    })

    const html = await renderToString(el)

    // Both team names
    expect(html).toContain('Team Alpha')
    expect(html).toContain('Team Beta')

    // Ten player names
    const playerNames = ['One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten']
    for (const name of playerNames) {
      expect(html).toContain(`Player ${name}`)
    }

    // Leverage panel title (HTML-escaped)
    expect(html).toMatch(/Bans (&amp;|&) Denial Picks/)

    // At least one "% of recent" from role share labels
    expect(html).toContain('% of recent')

    // No NaN, no undefined, no negative percentages like "-5%"
    expect(html).not.toContain('NaN')
    expect(html).not.toContain('undefined')
    expect(html).not.toMatch(/-\d+%/u)
  })

  it('renders a draft session with 6 bans and 2 picks', async () => {
    // Build a session with 6 bans and 2 picks (using player IDs)
    const session: DraftSession = {
      firstTeamId: 'tA',
      actions: [
        { type: 'ban', teamId: 'tA', championId: 'c1' },
        { type: 'ban', teamId: 'tB', championId: 'c2' },
        { type: 'ban', teamId: 'tA', championId: 'c3' },
        { type: 'ban', teamId: 'tB', championId: 'c4' },
        { type: 'ban', teamId: 'tA', championId: 'c5' },
        { type: 'ban', teamId: 'tB', championId: 'c1' }, // c1 already banned — rejected
        { type: 'pick', teamId: 'tA', championId: 'c2', playerId: 'p1' },
        { type: 'pick', teamId: 'tB', championId: 'c3', playerId: 'p6' },
      ],
      replay: null,
    }

    const el = React.createElement(SeriesBoard, {
      draft,
      picks,
      teamMap,
      championMap,
      playerMap,
      selectedGame: 3,
      onSelectGame: () => {},
      model,
      initialSession: session,
    })

    const html = await renderToString(el)

    // Both team names in the draft bar
    expect(html).toContain('Team Alpha')
    expect(html).toContain('Team Beta')

    // Champion names in the slots
    expect(html).toContain('Champion One')
    expect(html).toContain('Champion Two')
    expect(html).toContain('Champion Three')
    expect(html).toContain('Champion Four')
    expect(html).toContain('Champion Five')

    // The two picking players' cells show "picked" (because playerId matches)
    expect(html).toContain('picked')

    // No NaN or undefined
    expect(html).not.toContain('NaN')
    expect(html).not.toContain('undefined')
  })

  it('fails when pick is recorded under player name instead of id', async () => {
    // Simulate the bug: picks use playerName instead of playerId
    const buggySession: DraftSession = {
      firstTeamId: 'tA',
      actions: [
        { type: 'ban', teamId: 'tA', championId: 'c1' },
        { type: 'ban', teamId: 'tB', championId: 'c2' },
        { type: 'ban', teamId: 'tA', championId: 'c3' },
        { type: 'ban', teamId: 'tB', championId: 'c4' },
        { type: 'ban', teamId: 'tA', championId: 'c5' },
        { type: 'ban', teamId: 'tB', championId: 'c1' },
        // BUG: playerName instead of playerId
        { type: 'pick', teamId: 'tA', championId: 'c2', playerId: 'Player One' },
        { type: 'pick', teamId: 'tB', championId: 'c3', playerId: 'Player Six' },
      ],
      replay: null,
    }

    const el = React.createElement(SeriesBoard, {
      draft,
      picks,
      teamMap,
      championMap,
      playerMap,
      selectedGame: 3,
      onSelectGame: () => {},
      model,
      initialSession: buggySession,
    })

    const html = await renderToString(el)

    // "picked" should NOT appear because playerId 'Player One' doesn't match any real player ID
    expect(html).not.toContain('picked')
  })
})
