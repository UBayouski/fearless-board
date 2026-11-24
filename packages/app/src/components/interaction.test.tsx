// @vitest-environment jsdom
// Behaviour that only happens in a live page: an image that fails to load, focus that moves after a click, toggles.
import { afterEach, describe, it, expect, vi } from 'vitest'
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { UiContext } from '../ui'
import { ChampIcon } from './ChampIcon'
import { SeriesPicker } from './SeriesPicker'
import { HeaderSwitches } from './HeaderSwitches'
import { type ChampionRef, type DraftEvent, type SeriesIndexEntry } from '@fearless-board/shared'
import { board, leveragePlanFor, sessionAfter, teamMap } from './boardFixture'

// Tell React that updates are wrapped in act(), so it flushes them and does not warn
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// ── Helpers ──────────────────────────────────────────────────────────

const roots: Root[] = []

async function render(element: React.ReactElement) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  await act(async () => root.render(element))
  return container
}

// Every test starts with an empty page, so a query never finds an element left by an earlier test
afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount())
  document.body.innerHTML = ''
})

/** Click an element and wait one animation frame, where the board moves focus to Undo. */
async function clickAndWaitFrame(element: Element) {
  await act(async () => {
    (element as HTMLElement).click()
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
  })
}

const filledSlots = (container: Element) => container.querySelectorAll('#draft-order .slot.filled').length

const iconMap = new Map<string, ChampionRef>([['c1', { id: 'c1', name: 'Champion One', icon: 'ChampOne.png' }]])

// ── Tests ────────────────────────────────────────────────────────────

describe('Interaction: HeaderSwitches', () => {
  it('gives each option an accessible name and hides its icon from assistive technology', async () => {
    const container = await render(
      React.createElement(HeaderSwitches, { icons: true, theme: 'light', onIcons: () => {}, onTheme: () => {} }),
    )
    const expected = ['Champion icons', 'Names only', 'Light theme', 'Dark theme']

    for (const name of expected) {
      const button = container.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`)
      expect(button).not.toBeNull()
      expect(button!.getAttribute('title')).toBe(name)
      expect(button!.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true')
      expect(button!.querySelector('svg')?.getAttribute('focusable')).toBe('false')
    }

    // Both groups are there, each with its own name, and each has exactly one pressed option
    const groups = [...container.querySelectorAll('[role="group"]')]
    expect(groups.map(group => group.getAttribute('aria-label'))).toEqual(['Champion icons', 'Theme'])
    for (const group of groups) {
      expect(group.querySelectorAll('button[aria-pressed="true"]')).toHaveLength(1)
    }
  })

  it('updates the pressed options and reports each selected value', async () => {
    const onTheme = vi.fn()
    const onIcons = vi.fn()
    function StatefulSwitches() {
      const [theme, setTheme] = React.useState<'light' | 'dark'>('light')
      const [icons, setIcons] = React.useState(true)
      return React.createElement(HeaderSwitches, {
        icons,
        theme,
        onIcons: value => { setIcons(value); onIcons(value) },
        onTheme: value => { setTheme(value); onTheme(value) },
      })
    }
    const container = await render(React.createElement(StatefulSwitches))
    const dark = container.querySelector<HTMLButtonElement>('button[aria-label="Dark theme"]')!
    const names = container.querySelector<HTMLButtonElement>('button[aria-label="Names only"]')!

    await act(async () => { dark.click() })

    expect(onTheme).toHaveBeenCalledWith('dark')
    expect(dark.getAttribute('aria-pressed')).toBe('true')
    expect(container.querySelector('button[aria-label="Light theme"]')?.getAttribute('aria-pressed')).toBe('false')

    await act(async () => { names.click() })

    expect(onIcons).toHaveBeenCalledWith(false)
    expect(names.getAttribute('aria-pressed')).toBe('true')
    expect(container.querySelector('button[aria-label="Champion icons"]')?.getAttribute('aria-pressed')).toBe('false')
  })
})

describe('Interaction: ChampIcon', () => {
  it('icon fails to load: the name takes its place', async () => {
    const container = await render(
      React.createElement(
        UiContext.Provider,
        { value: { championMap: iconMap, teamMap, icons: true, ddragon: '1.2.3' } },
        React.createElement(ChampIcon, { id: 'c1', named: true }),
      ),
    )
    const img = container.querySelector('img')
    expect(img?.getAttribute('src')).toBe('https://ddragon.leagueoflegends.com/cdn/1.2.3/img/champion/ChampOne.png')
    expect(container.querySelector('.icon-fallback')).toBeNull()

    await act(async () => { img!.dispatchEvent(new Event('error')) })

    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('.icon-fallback')?.textContent).toBe('Champion One')
  })
})

describe('Interaction: practice draft focus', () => {
  const sixBans = (): DraftEvent[] => [
    { type: 'ban', championId: 'c1' }, { type: 'ban', championId: 'c2' }, { type: 'ban', championId: 'c3' },
    { type: 'ban', championId: 'c4' }, { type: 'ban', championId: 'c6' }, { type: 'ban', championId: 'c7' },
  ]

  it('a ban from the side column moves focus to Undo', async () => {
    const container = await render(board({ selectedGame: 3, initialSession: sessionAfter({ type: 'ban', championId: 'c1' }), planFor: leveragePlanFor }))
    expect(filledSlots(container)).toBe(1)
    // The first row under "Bans to consider", not a "Picks that also deny" row (those show a cost, not a ban)
    const section = [...container.querySelectorAll('.rail section')].find(x => x.querySelector('h3')?.textContent === 'Bans to consider')
    const ban = section?.querySelector<HTMLElement>('button.opt') ?? null
    expect(ban?.textContent).toContain('Champion Eight')
    expect(ban).not.toBeNull()
    ban!.focus()

    await clickAndWaitFrame(ban!)

    expect(filledSlots(container)).toBe(2)
    expect(document.activeElement?.id).toBe('draft-undo')
  })

  it('a ban chosen in the strip search moves focus to Undo', async () => {
    const container = await render(board({ selectedGame: 3, initialSession: sessionAfter(...sixBans().slice(0, 5)) }))
    expect(filledSlots(container)).toBe(5)
    const input = container.querySelector<HTMLInputElement>('.strip input')
    expect(input).not.toBeNull()
    input!.focus()

    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'Champion')
      input!.dispatchEvent(new Event('input', { bubbles: true }))
    })

    const firstResult = container.querySelector<HTMLElement>('.strip .champ-search-results button.champ-search-result')
    expect(firstResult?.textContent).toBe('Champion Seven')

    await clickAndWaitFrame(firstResult!)

    expect(filledSlots(container)).toBe(6)
    expect(document.activeElement?.id).toBe('draft-undo')
  })

  it('a pick in a lane moves focus to Undo', async () => {
    const container = await render(board({ selectedGame: 3, initialSession: sessionAfter(...sixBans()) }))
    expect(filledSlots(container)).toBe(6)
    const pick = container.querySelector<HTMLElement>('button.tile')
    expect(pick).not.toBeNull()
    pick!.focus()

    await clickAndWaitFrame(pick!)

    expect(filledSlots(container)).toBe(7)
    expect(document.activeElement?.id).toBe('draft-undo')
  })

  it('Undo after a pick takes the pick back and keeps focus', async () => {
    const container = await render(board({ selectedGame: 3, initialSession: sessionAfter(...sixBans()) }))
    await clickAndWaitFrame(container.querySelector('button.tile')!)
    const undo = document.getElementById('draft-undo')!
    expect(document.activeElement).toBe(undo)

    await clickAndWaitFrame(undo)

    expect(filledSlots(container)).toBe(6)
    // Undo is still in the page and still focused, not replaced or disabled under the keyboard
    expect(document.getElementById('draft-undo')).toBe(undo)
    expect(document.activeElement).toBe(undo)
  })

  it('Undo of the last action stays focusable, so the keyboard does not lose its place', async () => {
    const container = await render(board({ selectedGame: 3, initialSession: sessionAfter({ type: 'ban', championId: 'c1' }) }))
    const undo = document.getElementById('draft-undo')!
    undo.focus()

    await clickAndWaitFrame(undo)

    expect(filledSlots(container)).toBe(0)
    // Nothing is left to undo: marked with aria-disabled, never the disabled attribute, which would drop focus
    expect(undo.getAttribute('aria-disabled')).toBe('true')
    expect(undo.hasAttribute('disabled')).toBe(false)
    expect(document.activeElement).toBe(undo)
  })

  it('the draft order toggle opens the strip and changes its label', async () => {
    const container = await render(board({ selectedGame: 3, initialSession: sessionAfter({ type: 'ban', championId: 'c1' }) }))
    const toggle = container.querySelector<HTMLElement>('button.order-toggle')!
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(toggle.textContent).toBe('Draft order, 1 of 20')
    expect(container.querySelector('.strip')?.classList.contains('open')).toBe(false)

    await act(async () => { toggle.click() })

    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(toggle.textContent).toBe('Less')
    expect(container.querySelector('.strip')?.classList.contains('open')).toBe(true)
  })
})

describe('Interaction: SeriesPicker', () => {
  it('clicking All adds the series that are not featured, never the single game', async () => {
    const teams = ['tA', 'tB'] as [string, string]
    const index: SeriesIndexEntry[] = [
      { seriesId: 's1', scheduledStart: '2025-03-01', event: 'Spring', stage: 'Groups', teamIds: teams, gameCount: 5, winnerTeamId: 'tA' },
      { seriesId: 's2', scheduledStart: '2025-04-01', event: 'Spring', stage: 'Playoffs', teamIds: teams, gameCount: 3, winnerTeamId: 'tB' },
      { seriesId: 's3', scheduledStart: '2025-05-01', event: 'Summer', stage: 'Groups', teamIds: teams, gameCount: 4, winnerTeamId: 'tA' },
      { seriesId: 's4', scheduledStart: '2025-06-01', event: 'Worlds', stage: 'Groups', teamIds: teams, gameCount: 2, winnerTeamId: 'tB' },
      { seriesId: 's5', scheduledStart: '2025-07-01', event: 'Worlds', stage: 'Finals', teamIds: teams, gameCount: 1, winnerTeamId: 'tA' },
    ]
    const container = await render(
      React.createElement(SeriesPicker, { index, featuredIds: new Set(['s1', 's3']), teamMap, selectedId: null, onSelect: () => {} }),
    )
    const listed = () => [...container.querySelectorAll('.series-list li')].map(li => li.textContent ?? '')
    expect(listed()).toHaveLength(2)
    expect(listed().some(text => text.includes('Playoffs'))).toBe(false)

    const all = [...container.querySelectorAll('button')].find(b => /^All\s*4$/u.test(b.textContent ?? ''))
    expect(all?.getAttribute('aria-pressed')).toBe('false')
    await act(async () => { all!.click() })

    expect(all?.getAttribute('aria-pressed')).toBe('true')
    expect(listed()).toHaveLength(4)
    expect(listed().some(text => text.includes('Playoffs'))).toBe(true)
    expect(listed().some(text => text.includes('Finals'))).toBe(false)
  })
})
