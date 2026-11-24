// Selects the featured series: marked in the app's series list, and the only series of the demo build.

import type { SeriesIndexEntry, PickRow } from './types.ts'

/**
 * Select featured series from the series index and pick rows.
 *
 * Rule: series with at least four games played where all ten players of game 1
 * have appeared in at least 20 earlier series. Newest first, take the first `count`.
 */
export function selectFeatured(
  index: SeriesIndexEntry[],
  picks: PickRow[],
  count: number = 20,
): SeriesIndexEntry[] {
  // Group picks by series to find players per series
  const picksBySeries = new Map<string, PickRow[]>()
  for (const p of picks) {
    const list = picksBySeries.get(p.seriesId) ?? []
    list.push(p)
    picksBySeries.set(p.seriesId, list)
  }

  // Build playerId -> Map<seriesId, scheduledStart> to count earlier series per player
  const playerSeriesMap = new Map<string, Map<string, string>>()
  for (const p of picks) {
    let seriesMap = playerSeriesMap.get(p.playerId)
    if (!seriesMap) {
      seriesMap = new Map()
      playerSeriesMap.set(p.playerId, seriesMap)
    }
    if (!seriesMap.has(p.seriesId)) {
      seriesMap.set(p.seriesId, p.scheduledStart)
    }
  }

  function earlierSeriesCount(playerId: string, beforeDate: string): number {
    const seriesMap = playerSeriesMap.get(playerId)
    if (!seriesMap) return 0
    let count = 0
    for (const [, date] of seriesMap) {
      if (date < beforeDate) count++
    }
    return count
  }

  // Filter: gameCount >= 4
  const candidates = index.filter(e => e.gameCount >= 4)

  // Sort by scheduledStart descending (newest first)
  candidates.sort((a, b) => b.scheduledStart.localeCompare(a.scheduledStart))

  // Filter: all 10 players of game 1 have 20+ earlier series
  const featured: SeriesIndexEntry[] = []
  for (const entry of candidates) {
    const seriesPicks = picksBySeries.get(entry.seriesId)
    if (!seriesPicks) continue

    // Get game 1 picks
    const game1Picks = seriesPicks.filter(p => p.gameNumber === 1)
    if (game1Picks.length < 10) continue

    // Get distinct playerIds from game 1
    const game1Players = new Set(game1Picks.map(p => p.playerId))
    if (game1Players.size < 10) continue

    // Check each player has 20+ earlier series
    let allQualified = true
    for (const playerId of game1Players) {
      if (earlierSeriesCount(playerId, entry.scheduledStart) < 20) {
        allQualified = false
        break
      }
    }

    if (allQualified) {
      featured.push(entry)
      if (featured.length >= count) break
    }
  }

  return featured
}
