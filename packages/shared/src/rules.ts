// Pure rules: burned champions, pools, lineup, and compact picks decoding.

import type {
  GameDraft, PoolEntry, CompactPicks, PickRow, SeriesDraft,
  LineupResult, Lineup,
} from './types.ts'

/** Decode a compact picks row back to PickRow format. */
export function decodeCompactPicks(cp: CompactPicks): PickRow[] {
  const result: PickRow[] = []
  for (const row of cp.rows) {
    result.push({
      scheduledStart: '',
      seriesId: cp.series[row[0]],
      gameNumber: row[1],
      teamId: cp.teams[row[2]],
      playerId: cp.players[row[3]],
      championId: cp.champions[row[4]],
      won: row[5] === 1,
    })
  }
  return result
}

/**
 * Champions no longer available in game `gameNumber` of a series under Fearless Draft.
 *
 * Confirmed rule: a champion picked by either team in an earlier game of the series is
 * unavailable to both teams for the rest of it; bans do not carry over.
 * This has been confirmed across all 569 multi-game series in the data.
 */
export function burnedChampions(games: readonly GameDraft[], gameNumber: number): Set<string> {
  const burned = new Set<string>()
  for (const game of games) {
    if (game.gameNumber >= gameNumber) continue
    // Prefer picks (always available) over actions (may be missing for forfeits)
    if (game.picks.length > 0) {
      for (const pick of game.picks) {
        burned.add(pick.championId)
      }
    } else {
      for (const action of game.actions) {
        if (action.type === 'pick') burned.add(action.championId)
      }
    }
  }
  return burned
}

/**
 * Champions a player has played before `asOf` (exclusive), sorted by games desc then recency desc.
 *
 * Scans `picks` (all PickRows) for the given player, keeping only games scheduled before `asOf`.
 */
export function playerPool(picks: readonly PickRow[], playerId: string, asOf: string): PoolEntry[] {
  const map = new Map<string, { games: number; wins: number; lastPlayed: string }>()

  for (const row of picks) {
    if (row.playerId !== playerId) continue
    if (row.scheduledStart >= asOf) continue
    const entry = map.get(row.championId)
    if (!entry) {
      map.set(row.championId, { games: 1, wins: row.won ? 1 : 0, lastPlayed: row.scheduledStart })
    } else {
      entry.games++
      if (row.won) entry.wins++
      if (row.scheduledStart > entry.lastPlayed) entry.lastPlayed = row.scheduledStart
    }
  }

  const result: PoolEntry[] = []
  for (const [championId, stats] of map) {
    result.push({ championId, ...stats })
  }

  // Sort by games desc, then lastPlayed desc (most recent first)
  result.sort((a, b) => {
    if (b.games !== a.games) return b.games - a.games
    return b.lastPlayed.localeCompare(a.lastPlayed)
  })

  return result
}

/**
 * Split a pool into credible (available) and burned entries.
 *
 * Returns `{ credible, burned }` where `credible` contains entries whose champion is not
 * in `burned`, and `burned` contains the entries that are struck through on the board.
 */
export function crediblePool(pool: readonly PoolEntry[], burned: Set<string>): {
  credible: PoolEntry[]
  burned: PoolEntry[]
} {
  const credible: PoolEntry[] = []
  const burnedEntries: PoolEntry[] = []

  for (const entry of pool) {
    if (burned.has(entry.championId)) {
      burnedEntries.push(entry)
    } else {
      credible.push(entry)
    }
  }

  return { credible, burned: burnedEntries }
}

/**
 * The share of a player's prior games that were on burned champions.
 *
 * Returns a value in [0, 100] — the percentage of all prior games spent on
 * champions that are now burned.  Can never exceed 100% because burned games
 * are a subset of total games.
 */
export function burnedGameShare(pool: readonly PoolEntry[], burned: Set<string>): number {
  let totalGames = 0
  let burnedGames = 0

  for (const entry of pool) {
    totalGames += entry.games
    if (burned.has(entry.championId)) {
      burnedGames += entry.games
    }
  }

  if (totalGames === 0) return 0
  return Math.round((burnedGames / totalGames) * 100)
}

/**
 * For each team, return the five players of game N-1 (or game 1 for game 1).
 * Also reports whether the lineup changed between any two earlier games.
 *
 * The lineup is used for planning — nothing from game N or later is visible.
 */
export function lineupBefore(draft: SeriesDraft, gameNumber: number): LineupResult {
  const lineup: Lineup = {}
  const lineupChanged = new Map<string, boolean>()

  // Determine which game provides the lineup
  const sourceGameNumber = gameNumber >= 2 ? gameNumber - 1 : 1
  const sourceGame = draft.games.find(g => g.gameNumber === sourceGameNumber)
  if (!sourceGame) {
    // Fallback: use game 1
    const game1 = draft.games.find(g => g.gameNumber === 1)
    if (!game1) {
      for (const teamId of draft.teamIds) lineupChanged.set(teamId, false)
      return { lineup, lineupChanged }
    }
  }

  const effectiveGame = sourceGame ?? draft.games.find(g => g.gameNumber === 1)!

  // Build lineup from the effective game
  for (const teamId of draft.teamIds) {
    const teamPicks = effectiveGame.picks.filter(p => p.teamId === teamId)
    lineup[teamId] = teamPicks.map(p => ({
      playerId: p.playerId,
      playerName: p.playerName,
      role: null, // role comes from manifest
    }))
  }

  // Check if lineup changed between any two earlier games, per team
  const earlierGames = draft.games.filter(g => g.gameNumber < gameNumber)
  if (earlierGames.length >= 2) {
    for (const teamId of draft.teamIds) {
      const playerSets: string[] = []
      for (const g of earlierGames) {
        const pids = g.picks.filter(p => p.teamId === teamId).map(p => p.playerId).sort()
        playerSets.push(pids.join(','))
      }
      const unique = new Set(playerSets)
      lineupChanged.set(teamId, unique.size > 1)
    }
  } else {
    for (const teamId of draft.teamIds) lineupChanged.set(teamId, false)
  }

  return { lineup, lineupChanged }
}
