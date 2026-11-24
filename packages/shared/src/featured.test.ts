// Tests for selectFeatured (the featured series: marked in the series list, and the demo build)

import { describe, it } from 'node:test'
import { strict as assert } from 'node:assert'
import { selectFeatured } from './featured.ts'
import type { SeriesIndexEntry, PickRow } from './types.ts'

describe('selectFeatured', () => {
  // Build a small fixture: 3 series, picks for each
  function buildFixture(): { index: SeriesIndexEntry[]; picks: PickRow[] } {
    const index: SeriesIndexEntry[] = [
      // Series A: 5 games, newest — all players have 20+ earlier series
      { seriesId: 'A', scheduledStart: '2026-03-01', event: 'Test', stage: 'Finals', teamIds: ['T1', 'T2'], gameCount: 5, winnerTeamId: 'T1' },
      // Series B: 4 games, middle — all players have 20+ earlier series
      { seriesId: 'B', scheduledStart: '2026-02-01', event: 'Test', stage: 'Semis', teamIds: ['T1', 'T2'], gameCount: 4, winnerTeamId: 'T2' },
      // Series C: 3 games — does not qualify (gameCount < 4)
      { seriesId: 'C', scheduledStart: '2026-01-01', event: 'Test', stage: 'Groups', teamIds: ['T1', 'T2'], gameCount: 3, winnerTeamId: 'T1' },
    ]

    const picks: PickRow[] = []
    const players = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8', 'P9', 'P10']

    // Give each player 25 earlier series (before Series A)
    for (const pid of players) {
      for (let i = 0; i < 25; i++) {
        const seriesId = `${pid}-earlier-${i}`
        picks.push({
          scheduledStart: `2025-${String(Math.floor(i / 30 + 1)).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}`,
          seriesId,
          gameNumber: 1,
          teamId: 'T1',
          playerId: pid,
          championId: 'C1',
          won: true,
        })
      }
    }

    // Series A game 1 picks (10 players)
    for (let i = 0; i < 10; i++) {
      picks.push({
        scheduledStart: '2026-03-01',
        seriesId: 'A',
        gameNumber: 1,
        teamId: i < 5 ? 'T1' : 'T2',
        playerId: players[i],
        championId: 'C1',
        won: true,
      })
    }

    // Series B game 1 picks (10 players)
    for (let i = 0; i < 10; i++) {
      picks.push({
        scheduledStart: '2026-02-01',
        seriesId: 'B',
        gameNumber: 1,
        teamId: i < 5 ? 'T1' : 'T2',
        playerId: players[i],
        championId: 'C1',
        won: true,
      })
    }

    // Series C game 1 picks (10 players)
    for (let i = 0; i < 10; i++) {
      picks.push({
        scheduledStart: '2026-01-01',
        seriesId: 'C',
        gameNumber: 1,
        teamId: i < 5 ? 'T1' : 'T2',
        playerId: players[i],
        championId: 'C1',
        won: true,
      })
    }

    return { index, picks }
  }

  it('selects series with 4+ games and all players qualified', () => {
    const { index, picks } = buildFixture()
    const result = selectFeatured(index, picks)
    assert.equal(result.length, 2, 'should select 2 series (A and B)')
    assert.equal(result[0].seriesId, 'A', 'newest first')
    assert.equal(result[1].seriesId, 'B', 'second newest')
  })

  it('excludes series with fewer than 4 games', () => {
    const { index, picks } = buildFixture()
    const result = selectFeatured(index, picks)
    const ids = result.map(e => e.seriesId)
    assert.ok(!ids.includes('C'), 'series C (3 games) should be excluded')
  })

  it('respects the count parameter', () => {
    const { index, picks } = buildFixture()
    const result = selectFeatured(index, picks, 1)
    assert.equal(result.length, 1)
    assert.equal(result[0].seriesId, 'A')
  })

  it('excludes series where a player has fewer than 20 earlier series', () => {
    const { index, picks } = buildFixture()
    // Remove most earlier series for P1 so they have only 10
    const filteredPicks = picks.filter(p => !(p.playerId === 'P1' && p.seriesId.startsWith('P1-earlier') && Number(p.seriesId.split('-').pop()) >= 10))
    const result = selectFeatured(index, filteredPicks)
    const ids = result.map(e => e.seriesId)
    assert.ok(!ids.includes('A'), 'series A should be excluded when P1 has <20 earlier series')
  })

  it('returns empty when no series qualifies', () => {
    const result = selectFeatured([], [])
    assert.equal(result.length, 0)
  })
})
