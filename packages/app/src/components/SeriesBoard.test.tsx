import { describe, it, expect } from 'vitest'
import React from 'react'
import { SeriesBoard } from './SeriesBoard'
import { UiContext } from '../ui'
import { renderToString } from './renderHtml'
import type { GamePlan } from '@fearless-board/shared'
import { board, championMap, decodedPlanFor, draft, planFor, playerMap, sessionAfter, teamMap } from './boardFixture'

/** The page without the unrounded widths of the comfort bars (a style value, not text). */
function visibleText(html: string): string {
  return html.replace(/(--comfort|width):[0-9.]+%/gu, '$1')
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

  it('draft strip has Undo button and draft order toggle', async () => {
    const session = sessionAfter({ type: 'ban', championId: 'c1' })
    const html = await renderToString(board({ selectedGame: 3, initialSession: session }))

    // Undo button with id
    expect(html).toContain('id="draft-undo"')

    // The draft order toggle: closed, controls the slots, counts the action already taken
    expect(html).toMatch(/<button[^>]*class="ghost order-toggle"[^>]*aria-expanded="false"[^>]*aria-controls="draft-order"[^>]*>Draft order, (?:<!-- -->)?1(?:<!-- -->)? of (?:<!-- -->)?20<\/button>/u)
  })

  it('slot rows are inside the element with id="draft-order"', async () => {
    const session = sessionAfter({ type: 'ban', championId: 'c1' })
    const html = await renderToString(board({ selectedGame: 3, initialSession: session }))

    // The draft-order container exists
    expect(html).toContain('id="draft-order"')

    // Both teams' slot rows come after the start of the container, none before it
    const draftOrderStart = html.indexOf('id="draft-order"')
    expect(html.indexOf('class="slotrow"')).toBeGreaterThan(draftOrderStart)
    expect(html.slice(draftOrderStart).match(/class="slotrow"/gu)?.length).toBe(2)
  })
})
