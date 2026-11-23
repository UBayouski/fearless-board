import { describe, it, expect } from 'vitest'
import React from 'react'
import { renderToReadableStream } from 'react-dom/server'
import { SeriesBoard } from './SeriesBoard'
import { trainPickModel, gamePlan as computeGamePlan, draftReducer, encodePlan, decodePlan, type DraftEvent, type DraftSession } from '@fearless-board/shared'
import type { SeriesDraft, PickRow, PlayerRef, TeamRef, ChampionRef, PickExample, Role, GamePlan } from '@fearless-board/shared'

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

// Need at least 10 distinct champions for 6 bans + 2 picks
const championMap = new Map<string, ChampionRef>([
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
const model = trainPickModel(examples)

// Build planFor from computed plans (full mode)
const playerRole = new Map<string, Role | null>()
for (const [id, p] of playerMap) {
  playerRole.set(id, p.role)
}
const plans: Record<number, GamePlan> = {}
for (const game of draft.games) {
  plans[game.gameNumber] = computeGamePlan(draft, game.gameNumber, picks, model, playerRole)
}
const planFor = (gameNumber: number): GamePlan | null => plans[gameNumber] ?? null

// Build planFor from encoded plans (demo mode)
const encodedPlans: Record<number, any> = {}
for (const game of draft.games) {
  encodedPlans[game.gameNumber] = encodePlan(plans[game.gameNumber])
}
const decodedPlanFor = (gameNumber: number): GamePlan | null => {
  const encoded = encodedPlans[gameNumber]
  if (!encoded) return null
  return decodePlan(encoded)
}

// ── Test ─────────────────────────────────────────────────────────────

/** The page without the unrounded widths of the comfort bars (a style value, not text). */
function visibleText(html: string): string {
  return html.replace(/(--comfort|width):[0-9.]+%/gu, '$1')
}

/** The draft context of the fixture series in game 3: both lineups, with c5 burned in game 1. */
const draftContext = {
  teamIds: ['tA', 'tB'],
  burned: new Set(['c5']),
  teamPlayers: new Map([
    ['tA', new Set(['p1', 'p2', 'p3', 'p4', 'p5'])],
    ['tB', new Set(['p6', 'p7', 'p8', 'p9', 'p10'])],
  ]),
}

/** A draft session of the fixture with team A first, after the given bans and picks. */
function sessionAfter(...events: DraftEvent[]): DraftSession {
  let session: DraftSession = { firstTeamId: 'tA', actions: [], replay: null }
  for (const event of events) session = draftReducer(session, event, draftContext)
  return session
}

describe('SeriesBoard render', () => {
  it('renders both team names, ten player names, and the panel title', async () => {
    const el = React.createElement(SeriesBoard, {
      draft,
      planFor,
      teamMap,
      championMap,
      playerMap,
      selectedGame: 2,
      onSelectGame: () => {},
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
    // Build a valid session by running draftReducer over 6 distinct bans and 2 picks

    const session = sessionAfter(
      { type: 'ban', championId: 'c1' },
      { type: 'ban', championId: 'c2' },
      { type: 'ban', championId: 'c3' },
      { type: 'ban', championId: 'c4' },
      { type: 'ban', championId: 'c6' },
      { type: 'ban', championId: 'c7' },
      { type: 'pick', playerId: 'p1', championId: 'c8' },
      { type: 'pick', playerId: 'p6', championId: 'c9' },
    )

    const el = React.createElement(SeriesBoard, {
      draft,
      planFor,
      teamMap,
      championMap,
      playerMap,
      selectedGame: 3,
      onSelectGame: () => {},
      initialSession: session,
    })

    const html = await renderToString(el)

    // Both team names in the draft bar
    expect(html).toContain('Team Alpha')
    expect(html).toContain('Team Beta')

    // Champion names in the slots (6 bans + 2 picks = 8 slots filled)
    expect(html).toContain('Champion One')
    expect(html).toContain('Champion Two')
    expect(html).toContain('Champion Three')
    expect(html).toContain('Champion Four')
    expect(html).toContain('Champion Six')
    expect(html).toContain('Champion Seven')
    expect(html).toContain('Champion Eight')
    expect(html).toContain('Champion Nine')

    // The two picking players' cells show "picked" with the champion name
    expect(html).toContain('picked')
    // Player One picked Champion Eight
    expect(html).toContain('Champion Eight')
    // Player Six picked Champion Nine
    expect(html).toContain('Champion Nine')

    // Banned champions should not appear in any open cell's tile list
    // (they are in the unavailable set, so dimmed or hidden)

    // No NaN or undefined
    expect(html).not.toContain('NaN')
    expect(html).not.toContain('undefined')
  })

  it('item 1: ban rows render as buttons in draft mode', async () => {
    // Session with 1 ban — next turn is a ban turn
    const session = sessionAfter({ type: 'ban', championId: 'c1' })

    const el = React.createElement(SeriesBoard, {
      draft, planFor, teamMap, championMap, playerMap,
      selectedGame: 3, onSelectGame: () => {}, initialSession: session,
    })
    const html = await renderToString(el)

    // Leverage panel renders with ban rows
    expect(html).toContain('Bans to consider')
    // Ban rows are <button> elements (not just <div>)
    expect(html).toContain('leverage-row')
    expect(html).not.toContain('NaN')
  })

  it('item 2: other champion search appears on pick turn', async () => {
    // Session with 6 bans — next turn is a pick turn
    const session = sessionAfter(
      { type: 'ban', championId: 'c1' },
      { type: 'ban', championId: 'c2' },
      { type: 'ban', championId: 'c3' },
      { type: 'ban', championId: 'c4' },
      { type: 'ban', championId: 'c6' },
      { type: 'ban', championId: 'c7' },
    )

    const el = React.createElement(SeriesBoard, {
      draft, planFor, teamMap, championMap, playerMap,
      selectedGame: 3, onSelectGame: () => {}, initialSession: session,
    })
    const html = await renderToString(el)

    // "Other champion" search input appears in picking team's cells
    expect(html).toContain('Other champion')
    expect(html).not.toContain('NaN')
  })

  it('item 3: last removed champion shown in draft bar', async () => {
    // Session with 1 ban — lastRemoved is c2 (c1 is already burned in game 3)
    const session = sessionAfter({ type: 'ban', championId: 'c2' })

    const el = React.createElement(SeriesBoard, {
      draft, planFor, teamMap, championMap, playerMap,
      selectedGame: 3, onSelectGame: () => {}, initialSession: session,
    })
    const html = await renderToString(el)

    // Banned champion appears in the draft bar slot
    expect(html).toContain('Champion Two')
    expect(html).toContain('draft-slot-filled')
    // Cells that had the champion in their top 10 show it struck, labelled "banned"
    expect(html).toContain('draft-removed')
    expect(html).toMatch(/Champion Two(<!-- -->| )*<small>banned<\/small>/u)
    expect(html).not.toContain('NaN')
  })

  it('item 4: picked cell shows champion name', async () => {
    const session = sessionAfter(
      { type: 'ban', championId: 'c1' },
      { type: 'ban', championId: 'c2' },
      { type: 'ban', championId: 'c3' },
      { type: 'ban', championId: 'c4' },
      { type: 'ban', championId: 'c6' },
      { type: 'ban', championId: 'c7' },
      { type: 'pick', playerId: 'p1', championId: 'c8' },
    )

    const el = React.createElement(SeriesBoard, {
      draft, planFor, teamMap, championMap, playerMap,
      selectedGame: 3, onSelectGame: () => {}, initialSession: session,
    })
    const html = await renderToString(el)

    // Picked cell shows champion name and "picked"
    expect(html).toContain('Champion Eight')
    expect(html).toContain('picked')
    expect(html).not.toContain('NaN')
  })

  it('item 5: draft mode shows Exit Draft and draft bar', async () => {
    // Session with 1 ban so draftMode is true
    const session = sessionAfter({ type: 'ban', championId: 'c1' })

    const el = React.createElement(SeriesBoard, {
      draft, planFor, teamMap, championMap, playerMap,
      selectedGame: 3, onSelectGame: () => {}, initialSession: session,
    })
    const html = await renderToString(el)

    // "Exit Draft" button exists (proves draft mode is active)
    expect(html).toContain('Exit Draft')
    // Draft bar renders
    expect(html).toContain('draft-bar')
    expect(html).not.toContain('NaN')
  })

  it('item 6: two slot rows render with team names', async () => {
    // Session with 1 ban so draftMode is true and DraftBar renders
    const session = sessionAfter({ type: 'ban', championId: 'c1' })

    const el = React.createElement(SeriesBoard, {
      draft, planFor, teamMap, championMap, playerMap,
      selectedGame: 3, onSelectGame: () => {}, initialSession: session,
    })
    const html = await renderToString(el)

    // Both team names appear as row labels in the draft bar
    expect(html).toContain('Team Alpha')
    expect(html).toContain('Team Beta')
    // Draft slots exist
    expect(html).toContain('draft-slot')
    expect(html).not.toContain('NaN')
  })

  it('outlook: panel shows ten player names and burned shares', async () => {
    const el = React.createElement(SeriesBoard, {
      draft, planFor, teamMap, championMap, playerMap,
      selectedGame: 2, onSelectGame: () => {},
    })
    const html = await renderToString(el)

    // Outlook panel renders with compact team tables
    expect(html).toContain('outlook-panel')

    // Ten player names
    const playerNames = ['One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten']
    for (const name of playerNames) {
      expect(html).toContain(`Player ${name}`)
    }

    // The team line gives the mean burned share
    expect(html.match(/Mean (?:<!-- -->)?\d+%(?:<!-- -->)? burned/gu)?.length).toBe(2)

    // No NaN or undefined
    expect(html).not.toContain('NaN')
    expect(html).not.toContain('undefined')
  })

  it('outlook: game 1 shows 0% burned', async () => {
    const el = React.createElement(SeriesBoard, {
      draft, planFor, teamMap, championMap, playerMap,
      selectedGame: 1, onSelectGame: () => {},
    })
    const html = await renderToString(el)

    // Game 1 has no burned champions, so all burned shares are 0%
    expect(html.match(/Mean (?:<!-- -->)?0%(?:<!-- -->)? burned/gu)?.length).toBe(2)
    expect(html).not.toContain('NaN')
  })

  it('outlook: pick cost shows both team figures', async () => {
    const el = React.createElement(SeriesBoard, {
      draft, planFor, teamMap, championMap, playerMap,
      selectedGame: 2, onSelectGame: () => {}, initialCostChampion: 'c2',
    })
    const html = await renderToString(el)

    // Pick cost: the search, the chosen champion and a combined figure for each team
    expect(html).toContain('What does a pick cost')
    expect(html).toContain('outlook-cost-champion')
    expect(html.match(/combined (?:<!-- -->)?\d+%/gu)?.length).toBe(2)

    // Both team names appear in the panel
    expect(html).toContain('Team Alpha')
    expect(html).toContain('Team Beta')
    expect(html).not.toContain('NaN')
  })

  it('outlook: draft mode collapses briefing row', async () => {
    // Session with 1 ban — briefing row should be collapsed
    const session = sessionAfter({ type: 'ban', championId: 'c1' })

    const el = React.createElement(SeriesBoard, {
      draft, planFor, teamMap, championMap, playerMap,
      selectedGame: 3, onSelectGame: () => {}, initialSession: session,
    })
    const html = await renderToString(el)

    // Briefing row is collapsed — shows the toggle text
    expect(html).toContain('Pre-game note and series outlook')
    expect(html).not.toContain('NaN')
    expect(html).not.toContain('undefined')
  })

  it('note: shows headline and three point titles for the selected team', async () => {
    const notesData = {
      model: 'test-model',
      games: {
        '2': {
          'tA': { headline: 'Opponent-only note', points: [] },
          'tB': {
            headline: 'Ten champions are gone entering game two',
            points: [
              { title: 'Their pools', text: 'Every opponent player has lost 0% of their usual picks.' },
              { title: 'Our pools', text: 'All our players have lost 0% of their usual picks.' },
              { title: 'Bans and picks', text: 'The list of bans to consider is empty.' },
            ],
          },
        },
      },
    }

    const el = React.createElement(SeriesBoard, {
      draft, planFor, teamMap, championMap, playerMap,
      selectedGame: 2, onSelectGame: () => {}, notesData,
    })
    const html = await renderToString(el)

    // Note block renders
    expect(html).toContain('Pre-game note')
    expect(html).toContain('Ten champions are gone entering game two')
    expect(html).toContain('Their pools')
    expect(html).toContain('Our pools')
    expect(html).toContain('Bans and picks')
    // Attribution line (React server rendering inserts <!-- --> between expressions)
    // The model id is shown as a name
    expect(html).toMatch(/Written by (?:<!-- -->)?Test Model(?:<!-- -->)? from the figures/u)
    expect(html).not.toContain('Opponent-only note')
    // Both team names are on the page
    expect(html).toContain('Team Alpha')
    expect(html).toContain('Team Beta')
    expect(html).not.toContain('NaN')
    expect(html).not.toContain('undefined')
  })

  it('note: no note shows no block', async () => {
    const el = React.createElement(SeriesBoard, {
      draft, planFor, teamMap, championMap, playerMap,
      selectedGame: 2, onSelectGame: () => {},
    })
    const html = await renderToString(el)

    // No note block when no notes data
    expect(html).not.toContain('Pre-game note')
    expect(html).not.toContain('outlook-note')
    expect(html).not.toContain('NaN')
  })

  it('item 11: draft mode with one action — briefing collapsed, ban panel before matrix', async () => {
    const session = sessionAfter({ type: 'ban', championId: 'c1' })

    const el = React.createElement(SeriesBoard, {
      draft, planFor, teamMap, championMap, playerMap,
      selectedGame: 3, onSelectGame: () => {}, initialSession: session,
    })
    const html = await renderToString(el)

    // Briefing row is collapsed: the toggle is there, the outlook is not
    expect(html).toContain('Pre-game note and series outlook — show')
    expect(html).not.toContain('outlook-panel')

    // Ban panel comes before the matrix in the document
    const leverageIndex = html.indexOf('leverage-panel')
    const matrixIndex = html.indexOf('pool-matrix')
    expect(leverageIndex).toBeGreaterThan(0)
    expect(matrixIndex).toBeGreaterThan(0)
    expect(leverageIndex).toBeLessThan(matrixIndex)

    // Draft bar is present
    expect(html).toContain('draft-bar')

    expect(html).not.toContain('NaN')
    expect(html).not.toContain('undefined')
  })

  it('item 6a: board renders from a decoded plan with same tile names and percentages', async () => {
    const props = { draft, teamMap, championMap, playerMap, selectedGame: 2, onSelectGame: () => {} }
    const html = await renderToString(React.createElement(SeriesBoard, { ...props, planFor: decodedPlanFor }))
    const computed = await renderToString(React.createElement(SeriesBoard, { ...props, planFor }))

    // The whole page is the same from both sources: every name, count and percentage.
    // Only the unrounded bar widths differ, by the rounding of the stored probabilities.
    expect(visibleText(html)).toBe(visibleText(computed))

    // Both team names
    expect(html).toContain('Team Alpha')
    expect(html).toContain('Team Beta')

    // Ten player names
    const playerNames = ['One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten']
    for (const name of playerNames) {
      expect(html).toContain(`Player ${name}`)
    }

    // At least one "% of recent" from role share labels
    expect(html).toContain('% of recent')

    // No NaN or undefined
    expect(html).not.toContain('NaN')
    expect(html).not.toContain('undefined')
  })

  it('item 6b: in demo mode with a draft action entered, ban panel and matrix still update', async () => {
    const session = sessionAfter({ type: 'ban', championId: 'c1' })

    const el = React.createElement(SeriesBoard, {
      draft, planFor: decodedPlanFor, teamMap, championMap, playerMap,
      selectedGame: 3, onSelectGame: () => {}, initialSession: session,
    })
    const html = await renderToString(el)
    const computed = await renderToString(React.createElement(SeriesBoard, {
      draft, planFor, teamMap, championMap, playerMap,
      selectedGame: 3, onSelectGame: () => {}, initialSession: session,
    }))
    const before = await renderToString(React.createElement(SeriesBoard, {
      draft, planFor: decodedPlanFor, teamMap, championMap, playerMap,
      selectedGame: 3, onSelectGame: () => {}, initialSession: { firstTeamId: 'tA', actions: [], replay: null },
    }))

    // The live draft gives the same page from a decoded plan as from a computed one,
    // and the ban changed the page
    expect(visibleText(html)).toBe(visibleText(computed))
    expect(visibleText(html)).not.toBe(visibleText(before))

    // Draft bar renders
    expect(html).toContain('draft-bar')
    // Ban panel renders
    expect(html).toContain('leverage-panel')
    // Matrix renders
    expect(html).toContain('pool-matrix')
    // Exit Draft button
    expect(html).toContain('Exit Draft')
    expect(html).not.toContain('NaN')
    expect(html).not.toContain('undefined')
  })
})
