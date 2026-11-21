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
 * Assumed rule: a champion picked by either team in an earlier game of the series is
 * unavailable to both teams for the rest of it; bans do not carry over.
 * This variant still has to be confirmed per league and season against the match data.
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
