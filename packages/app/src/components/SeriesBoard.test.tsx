import { describe, it, expect } from 'vitest'
import React from 'react'
import { renderToReadableStream } from 'react-dom/server'
import { SeriesBoard } from './SeriesBoard'
import { UiContext } from '../ui'
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

/** The board inside the context the app gives it. Icons are off unless a case turns them on. */
function board(props: Partial<React.ComponentProps<typeof SeriesBoard>> & { selectedGame: number }, ui: { icons?: boolean } = {}) {
  return React.createElement(
    UiContext.Provider,
    { value: { championMap, teamMap, icons: ui.icons ?? false, ddragon: '1.2.3' } },
    React.createElement(SeriesBoard, { draft, planFor, playerMap, onSelectGame: () => {}, ...props }),
  )
}

const allPlayers = (plan: GamePlan) => plan.players.flatMap(([, roles]) => [...roles.values()])
const count = (html: string, needle: string) => html.split(needle).length - 1
const PICK_BUTTON = '<button type="button" class="tile'
const PLAYER_NAMES = ['One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'].map(n => `Player ${n}`)

describe('SeriesBoard: planning', () => {
  it('shows the header, both teams, ten players and the forecast as plain content', async () => {
    const html = await renderToString(board({ selectedGame: 2 }))

    expect(html).toContain('Player forecasts')
    expect(html).toContain('Team Alpha')
    expect(html).toContain('Team Beta')
    for (const name of PLAYER_NAMES) expect(html).toContain(name)

    // Header: the game number once, in the details line; the state line does not repeat it
    expect(html).toMatch(/<b>game (?:<!-- -->)?2<\/b>/u)
    expect(html).toContain('Score before the draft')
    expect(html).toContain('Blue side')
    expect(html).toContain('Red side')

    // The pool label sits beside every player's name
    expect(count(html, 'of usual picks burned</b>')).toBe(10)

    // Planning tiles are content, not buttons; the main action is the reveal
    expect(html).not.toContain(PICK_BUTTON)
    expect(html).toMatch(/class="primary"[^>]*>Reveal game (?:<!-- -->)?2</u)
    expect(html).toContain('Practice the draft')

    expect(html).not.toContain('NaN')
    expect(html).not.toContain('undefined')
  })

  it('shows five ranked picks per player, the first one as the large tile', async () => {
    const html = await renderToString(board({ selectedGame: 2 }))
    const plan = planFor(2)!
    const expected = allPlayers(plan).reduce((sum, p) => sum + Math.min(5, p.likelihoods.length), 0)
    expect(count(html, '<div class="tile')).toBe(expected)
    expect(count(html, '<div class="tile lead')).toBe(allPlayers(plan).filter(p => p.likelihoods.length > 0).length)
  })

  it('never shows 0% for a positive likelihood', async () => {
    for (const game of [1, 2, 3]) {
      const html = await renderToString(board({ selectedGame: game }))
      expect(html).not.toContain('class="pc num">0%<')
    }
  })

  it('burn track: played games name their winner and their picks; the current game counts the burned champions', async () => {
    const html = await renderToString(board({ selectedGame: 3 }))
    const plan = planFor(3)!
    expect(html).toContain('Team Alpha won')
    expect(html).toContain('Team Beta won')
    expect(html).toContain('planning now')
    expect(html).toContain(`<div class="gone num">${plan.burned.size}</div>`)
    // Names only: the burned champions of earlier games are written out, and there is no image
    expect(html).toContain(championMap.get(draft.games[0].picks[0].championId)!.name)
    expect(html).not.toContain('<img')
  })

  it('icons on: icons come from Data Dragon and the ones standing alone carry the champion name', async () => {
    const withIcons = new Map([...championMap].map(([id, c]) => [id, { ...c, icon: `${c.name.replace(/\W/gu, '')}.png` }]))
    const el = React.createElement(
      UiContext.Provider,
      { value: { championMap: withIcons, teamMap, icons: true, ddragon: '1.2.3' } },
      React.createElement(SeriesBoard, { draft, planFor, playerMap, onSelectGame: () => {}, selectedGame: 3 }),
    )
    const html = await renderToString(el)
    expect(html).toContain('https://ddragon.leagueoflegends.com/cdn/1.2.3/img/champion/')
    const first = withIcons.get(draft.games[0].picks[0].championId)!
    expect(html).toContain(`alt="${first.name}"`)
  })

  it('note: shown for the planning team only, with the model as a name', async () => {
    const notesData = {
      model: 'test-model',
      games: {
        '2': {
          tA: { headline: 'Other team note', points: [] },
          tB: {
            headline: 'Ten champions are gone entering game two',
            points: [
              { title: 'Their pools', text: 'First point.' },
              { title: 'Our pools', text: 'Second point.' },
              { title: 'Bans and picks', text: 'Third point.' },
            ],
          },
        },
      },
    }
    // Team Beta is on the blue side in game 2, so it is the planning team by default
    const html = await renderToString(board({ selectedGame: 2, notesData }))
    expect(html).toContain('Ten champions are gone entering game two')
    for (const title of ['Their pools', 'Our pools', 'Bans and picks']) expect(html).toContain(title)
    expect(html).toMatch(/Written by (?:<!-- -->)?Test Model(?:<!-- -->)? from the figures/u)
    expect(html).not.toContain('Other team note')
    // Open by default, in the same collapsible design as the other panels
    expect(html).toMatch(/<details open="">\s*<summary>Before game/u)
  })

  it('note: without a note there is no note block', async () => {
    const html = await renderToString(board({ selectedGame: 2 }))
    expect(html).not.toContain('class="note"')
    expect(html).not.toContain('Before game')
  })

  it('pick cost: names the champion and gives a combined figure for each team', async () => {
    const html = await renderToString(board({ selectedGame: 2, initialCostChampion: 'c2' }))
    expect(html).toContain('What does a pick cost?')
    expect(html).toContain(championMap.get('c2')!.name)
    expect(count(html, ', combined ')).toBe(2)
    expect(html).not.toContain('NaN')
  })

  it('series outlook: one row per player with the burned share', async () => {
    const html = await renderToString(board({ selectedGame: 2 }))
    expect(html).toContain('Series outlook')
    expect(html.match(/\d+(?:<!-- -->)?% burned<\/td>/gu)?.length).toBe(10)
  })

  it('a decoded plan gives the same page as a computed one', async () => {
    const html = await renderToString(board({ selectedGame: 2, planFor: decodedPlanFor }))
    const computed = await renderToString(board({ selectedGame: 2 }))
    expect(visibleText(html)).toBe(visibleText(computed))
  })
})

describe('SeriesBoard: reveal', () => {
  it('shows who won, the updated score and both counts from the data', async () => {
    const html = await renderToString(board({ selectedGame: 2, initialRevealed: true }))
    const plan = planFor(2)!
    const game = draft.games[1]
    let topFive = 0
    let inPool = 0
    for (const pick of game.picks) {
      const player = allPlayers(plan).find(p => p.playerId === pick.playerId)!
      const rank = player.likelihoods.findIndex(l => l.championId === pick.championId) + 1
      if (rank >= 1 && rank <= 5) topFive++
      if (player.pool.credible.some(e => e.championId === pick.championId)) inPool++
    }

    expect(html).toContain('The real draft')
    // Game 2 of three: Team Beta won it, and it did not decide the series
    expect(html).toContain('Team Beta won this game')
    expect(html).toMatch(/1<small>–<\/small>(?:<!-- -->)?1/u)

    expect(html).toMatch(new RegExp(`>${topFive}(?:<!-- -->)? of (?:<!-- -->)?10</strong><span>forecast hits`, 'u'))
    expect(html).toMatch(new RegExp(`>${inPool}(?:<!-- -->)? of (?:<!-- -->)?10</strong><span>from available pools`, 'u'))

    // First level: one row per player; second level: the comparison, closed
    expect(count(html, 'class="lane result')).toBe(10)
    expect(html).toContain('<summary>Compare with forecasts</summary>')
    expect(count(html, 'tile lead actual')).toBe(10)
    expect(count(html, 'class="mini"')).toBe(10)
    expect(count(html, '<li class="was"')).toBe(topFive)
    expect(html).not.toContain('NaN')
    expect(html).not.toContain('undefined')
  })

  it('the last game of a series decides it', async () => {
    const decided = { ...draft, games: draft.games.slice(0, 2) }
    const html = await renderToString(board({ draft: decided, selectedGame: 2, initialRevealed: true }))
    expect(html).toContain('Team Beta won the series')
  })
})

describe('SeriesBoard: practice draft', () => {
  it('ban turn: the ban rows are buttons, and a filled slot keeps its label', async () => {
    const session = sessionAfter({ type: 'ban', championId: 'c1' })
    const html = await renderToString(board({ selectedGame: 3, initialSession: session }))

    expect(html).toContain('Practice draft')
    expect(html).toContain('Exit practice')
    expect(html).toMatch(/<span class="slot ban filled[^"]*"><small>ban<\/small><span class="v">Champion One<\/span>/u)
    // Team B bans next: its rows in the side column enter the ban
    expect(html).toContain('Team Beta to ban')
    expect(html).toContain('<button type="button" class="opt"')
    // No pick buttons on a ban turn
    expect(html).not.toContain(PICK_BUTTON)
  })

  it('pick turn: only the picking team has pick buttons, up to ten per player', async () => {
    const session = sessionAfter(
      { type: 'ban', championId: 'c1' }, { type: 'ban', championId: 'c2' }, { type: 'ban', championId: 'c3' },
      { type: 'ban', championId: 'c4' }, { type: 'ban', championId: 'c6' }, { type: 'ban', championId: 'c7' },
    )
    const html = await renderToString(board({ selectedGame: 3, initialSession: session }))
    expect(html).toContain('Team Alpha to pick')
    const buttons = count(html, PICK_BUTTON)
    expect(buttons).toBeGreaterThan(0)
    expect(buttons).toBeLessThanOrEqual(50)
    // The other team's five lanes are dimmed and have no buttons
    expect(count(html, 'class="lane right dim"')).toBe(5)
    expect(html).toContain('Other champion for Player One')
  })

  it('a pick shows as picked for that player and fills the slot', async () => {
    const session = sessionAfter(
      { type: 'ban', championId: 'c1' }, { type: 'ban', championId: 'c2' }, { type: 'ban', championId: 'c3' },
      { type: 'ban', championId: 'c4' }, { type: 'ban', championId: 'c6' }, { type: 'ban', championId: 'c7' },
      { type: 'pick', playerId: 'p1', championId: 'c8' },
    )
    const html = await renderToString(board({ selectedGame: 3, initialSession: session }))
    expect(html).toContain('<span class="pc word">picked</span>')
    expect(html).toMatch(/<span class="slot pick filled[^"]*"><small>pick<\/small><span class="v">Champion Eight<\/span>/u)
    expect(html).toContain('Team Beta to pick')
  })

  it('the note is not shown during a practice draft', async () => {
    const notesData = { model: 'test-model', games: { '3': { tA: { headline: 'A note', points: [] }, tB: { headline: 'B note', points: [] } } } }
    const session = sessionAfter({ type: 'ban', championId: 'c1' })
    const html = await renderToString(board({ selectedGame: 3, initialSession: session, notesData }))
    expect(html).not.toContain('A note')
    expect(html).not.toContain('B note')
  })

  it('a decoded plan gives the same draft page as a computed one, and the ban changes the page', async () => {
    const session = sessionAfter({ type: 'ban', championId: 'c1' })
    const html = await renderToString(board({ selectedGame: 3, initialSession: session, planFor: decodedPlanFor }))
    const computed = await renderToString(board({ selectedGame: 3, initialSession: session }))
    const other = await renderToString(board({ selectedGame: 3, initialSession: sessionAfter({ type: 'ban', championId: 'c2' }), planFor: decodedPlanFor }))
    expect(visibleText(html)).toBe(visibleText(computed))
    expect(visibleText(html)).not.toBe(visibleText(other))
  })
})
