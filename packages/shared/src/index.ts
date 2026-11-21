// Types and rules shared by the data pipeline and the app.
// The pipeline writes these shapes as JSON; the app reads them.

export type Side = 'blue' | 'red'

export interface TeamRef {
  id: string
  name: string
}

export interface ChampionRef {
  id: string
  name: string
}

export interface DraftAction {
  /** Position in the draft, starting at 1. */
  order: number
  type: 'pick' | 'ban'
  teamId: string
  championId: string
}

export interface PlayerPick {
  teamId: string
  playerId: string
  playerName: string
  championId: string
}

export interface GameDraft {
  gameId: string
  /** 1-based position of the game within its series. */
  gameNumber: number
  patch: string | null
  sides: Record<Side, string>
  winnerTeamId: string | null
  actions: DraftAction[]
  picks: PlayerPick[]
}

export interface SeriesDraft {
  seriesId: string
  event: string
  stage: string
  scheduledStart: string
  teamIds: [string, string]
  games: GameDraft[]
}

export type Role = 'top' | 'jungle' | 'mid' | 'bot' | 'support'

export interface PlayerRef {
  id: string
  name: string
  role: Role | null
}

/** Index file the app loads first. */
export interface Manifest {
  generatedAt: string
  seriesCount: number
  gameCount: number
  teams: TeamRef[]
  champions: ChampionRef[]
  players: PlayerRef[]
}

/** One row per series for the series picker. */
export interface SeriesIndexEntry {
  seriesId: string
  scheduledStart: string
  event: string
  stage: string
  teamIds: [string, string]
  gameCount: number
  winnerTeamId: string | null
}

/** One compact row per player pick across all games. */
export interface PickRow {
  scheduledStart: string
  seriesId: string
  gameNumber: number
  teamId: string
  playerId: string
  championId: string
  won: boolean
}

/** Compact picks file structure: lists + array rows. */
export interface CompactPicks {
  /** Ordered lists for decoding: index → id */
  series: string[]
  teams: string[]
  players: string[]
  champions: string[]
  /** Rows: [seriesIdx, gameNumber, teamIdx, playerIdx, championIdx, wonAs0or1] */
  rows: number[][]
}

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

/** A champion entry in a player's pool. */
export interface PoolEntry {
  championId: string
  games: number
  wins: number
  lastPlayed: string
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

/** Backtest result for a single game. */
export interface BacktestGame {
  seriesId: string
  gameNumber: number
  /** Per-player results. */
  players: BacktestPlayer[]
}

export interface BacktestPlayer {
  playerId: string
  playerName: string
  championId: string
  /** Whether the pick was in the player's available (credible) pool. */
  inPool: boolean
  /** Rank in the credible pool (1-based), or 0 if not in pool. */
  rank: number
  /** Total number of prior games for this player. */
  priorGames: number
}

/** Backtest summary statistics. */
export interface BacktestSummary {
  /** All picks: share that were in the available pool. */
  inPool: number
  /** All picks: share that were in top 3. */
  inTop3: number
  /** All picks: share that were in top 5. */
  inTop5: number
  /** Same three numbers restricted to players with >= 20 prior games. */
  inPool20: number
  inTop320: number
  inTop520: number
  /** Total picks analyzed. */
  totalPicks: number
  /** Total picks from players with >= 20 prior games. */
  totalPicks20: number
}

/**
 * Run a backtest over every game numbered 2 or higher in multi-game series.
 *
 * For each pick, checks whether the champion was in the player's credible pool
 * (available after burning) as of that series, and what rank it held.
 *
 * Returns per-game results and an overall summary.
 */
export function backtest(
  seriesList: readonly SeriesDraft[],
  picks: readonly PickRow[],
): { games: BacktestGame[]; summary: BacktestSummary } {
  const games: BacktestGame[] = []

  let totalInPool = 0
  let totalInTop3 = 0
  let totalInTop5 = 0
  let totalPicks = 0
  let totalInPool20 = 0
  let totalInTop320 = 0
  let totalInTop520 = 0
  let totalPicks20 = 0

  for (const series of seriesList) {
    if (series.games.length < 2) continue

    for (const game of series.games) {
      if (game.gameNumber < 2) continue

      const burned = burnedChampions(series.games, game.gameNumber)
      const playerResults: BacktestPlayer[] = []

      for (const pick of game.picks) {
        const pool = playerPool(picks, pick.playerId, series.scheduledStart)
        const { credible } = crediblePool(pool, burned)
        const rank = credible.findIndex((e) => e.championId === pick.championId) + 1
        const inPool = rank > 0
        const priorGames = pool.reduce((sum, e) => sum + e.games, 0)

        playerResults.push({
          playerId: pick.playerId,
          playerName: pick.playerName,
          championId: pick.championId,
          inPool,
          rank: inPool ? rank : 0,
          priorGames,
        })

        // Count for overall stats
        totalPicks++
        if (inPool) totalInPool++
        if (rank >= 1 && rank <= 3) totalInTop3++
        if (rank >= 1 && rank <= 5) totalInTop5++

        // Count for >= 20 prior games stats
        if (priorGames >= 20) {
          totalPicks20++
          if (inPool) totalInPool20++
          if (rank >= 1 && rank <= 3) totalInTop320++
          if (rank >= 1 && rank <= 5) totalInTop520++
        }
      }

      games.push({
        seriesId: series.seriesId,
        gameNumber: game.gameNumber,
        players: playerResults,
      })
    }
  }

  const pct = (num: number, den: number) => (den > 0 ? Math.round((num / den) * 100) : 0)

  const summary: BacktestSummary = {
    inPool: pct(totalInPool, totalPicks),
    inTop3: pct(totalInTop3, totalPicks),
    inTop5: pct(totalInTop5, totalPicks),
    inPool20: pct(totalInPool20, totalPicks20),
    inTop320: pct(totalInTop320, totalPicks20),
    inTop520: pct(totalInTop520, totalPicks20),
    totalPicks,
    totalPicks20,
  }

  return { games, summary }
}
