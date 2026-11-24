import { describe, it, expect } from 'vitest'
import React from 'react'
import { renderToString, textOf } from './renderHtml'
import { SeriesPicker } from './SeriesPicker'
import type { SeriesIndexEntry, TeamRef } from '@fearless-board/shared'

// ── Helpers ──────────────────────────────────────────────────────────


const teamMap = new Map<string, TeamRef>([
  ['tA', { id: 'tA', name: 'Team Alpha' }],
  ['tB', { id: 'tB', name: 'Team Beta' }],
  ['tC', { id: 'tC', name: 'Team Charlie' }],
  ['tD', { id: 'tD', name: 'Team Delta' }],
])

function makeIndex(): SeriesIndexEntry[] {
  return [
    { seriesId: 's1', scheduledStart: '2025-03-01', event: 'Spring', stage: 'Groups', teamIds: ['tA', 'tB'], gameCount: 5, winnerTeamId: 'tA' },
    { seriesId: 's2', scheduledStart: '2025-04-01', event: 'Spring', stage: 'Playoffs', teamIds: ['tC', 'tD'], gameCount: 3, winnerTeamId: 'tC' },
    { seriesId: 's3', scheduledStart: '2025-05-01', event: 'Summer', stage: 'Groups', teamIds: ['tA', 'tC'], gameCount: 4, winnerTeamId: 'tA' },
    { seriesId: 's4', scheduledStart: '2025-06-01', event: 'Worlds', stage: 'Groups', teamIds: ['tB', 'tD'], gameCount: 2, winnerTeamId: 'tB' },
    { seriesId: 's5', scheduledStart: '2025-07-01', event: 'Worlds', stage: 'Playoffs', teamIds: ['tA', 'tD'], gameCount: 1, winnerTeamId: 'tA' }, // single game
  ]
}

function picker(props: Partial<React.ComponentProps<typeof SeriesPicker>> & { index: SeriesIndexEntry[] }) {
  return React.createElement(SeriesPicker, {
    featuredIds: new Set(['s1', 's3']),
    teamMap,
    selectedId: null,
    onSelect: () => {},
    ...props,
  })
}

// ── Tests ────────────────────────────────────────────────────────────

describe('SeriesPicker', () => {
  it('featured switch: shows "Featured 2" pressed and "All 4", lists only the two featured series', async () => {
    const html = await renderToString(picker({ index: makeIndex() }))

    // "Featured 2" pressed, "All 4" not (s5 is a single game and is not counted)
    expect(html).toMatch(new RegExp(`aria-pressed="true"[^>]*>${textOf('Featured 2')}</button>`, 'u'))
    expect(html).toMatch(new RegExp(`aria-pressed="false"[^>]*>${textOf('All 4')}</button>`, 'u'))

    // Only featured series appear in the list
    expect(html).toContain('Team Alpha vs Team Beta') // s1
    expect(html).toContain('Team Alpha vs Team Charlie') // s3
    expect(html).not.toContain('Team Charlie vs Team Delta') // s2 not featured
    expect(html).not.toContain('Team Beta vs Team Delta') // s4 not featured
  })

  it('all featured (demo case): no switch is rendered', async () => {
    const index = makeIndex()
    const allFeatured = new Set(index.map(e => e.seriesId))
    const html = await renderToString(picker({ index, featuredIds: allFeatured }))

    // No switch when everything is featured
    expect(html).not.toContain('picker-scope')

    // All multi-game series are listed
    expect(html).toContain('Team Alpha vs Team Beta')
    expect(html).toContain('Team Charlie vs Team Delta')
    expect(html).toContain('Team Alpha vs Team Charlie')
    expect(html).toContain('Team Beta vs Team Delta')
    // Single game still excluded
    expect(html).not.toContain('Team Alpha vs Team Delta')
  })

  it('selected series not featured: list starts on "All", featured ones carry the mark', async () => {
    const html = await renderToString(picker({ index: makeIndex(), selectedId: 's2' }))

    // "All" is pressed
    expect(html).toMatch(new RegExp(`aria-pressed="true"[^>]*>${textOf('All 4')}</button>`, 'u'))

    // Exactly the two featured series carry the mark
    expect(html.match(/class="series-featured"/gu)?.length).toBe(2)

    // Non-selected non-featured series also appear
    expect(html).toContain('Team Charlie vs Team Delta') // s2 selected
    expect(html).toContain('Team Beta vs Team Delta') // s4
  })

  it('list is newest first: later team name appears before earlier', async () => {
    const html = await renderToString(picker({ index: makeIndex(), selectedId: 's2' }))

    // s5 (2025-07) is single game, excluded. s4 (2025-06) should appear before s1 (2025-03).
    const s4Pos = html.indexOf('Team Beta vs Team Delta')
    const s1Pos = html.indexOf('Team Alpha vs Team Beta')
    expect(s4Pos).toBeLessThan(s1Pos)
  })

  it('search field and filters have accessible names', async () => {
    const html = await renderToString(picker({ index: makeIndex() }))

    expect(html).toContain('aria-label="Search teams or events"')
    expect(html).toContain('aria-label="Team"')
    expect(html).toContain('aria-label="Event"')
  })
})
