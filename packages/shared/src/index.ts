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

/** Index file the app loads first. */
export interface Manifest {
  generatedAt: string
  seriesCount: number
  gameCount: number
  teams: TeamRef[]
  champions: ChampionRef[]
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
    for (const action of game.actions) {
      if (action.type === 'pick') burned.add(action.championId)
    }
  }
  return burned
}
