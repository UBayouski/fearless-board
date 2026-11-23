import type { ChampionRef, GameDraft, GamePlan, SeriesDraft, TeamRef } from '@fearless-board/shared'
import './LeveragePanel.css'

export function LeveragePanel({
  plan,
  draft,
  teamMap,
  championMap,
  revealedGame,
  onBan,
  actingTeamId,
}: {
  plan: GamePlan
  draft: SeriesDraft
  teamMap: Map<string, TeamRef>
  championMap: Map<string, ChampionRef>
  revealedGame?: GameDraft
  /** Called when a ban row is clicked (6.2.1). */
  onBan?: (championId: string) => void
  /** The team acting on a ban turn (6.2.1). */
  actingTeamId?: string
}) {
  const { leverage, players } = plan

  // Build set of actually banned champions per team (for reveal)
  const bannedByTeam = new Map<string, Set<string>>()
  if (revealedGame) {
    for (const teamId of draft.teamIds) {
      bannedByTeam.set(teamId, new Set<string>())
    }
    for (const action of revealedGame.actions) {
      if (action.type === 'ban') {
        const set = bannedByTeam.get(action.teamId)
        if (set) set.add(action.championId)
      }
    }
  }

  // Build set of actually picked champions per team (for reveal)
  const pickedByTeam = new Map<string, Set<string>>()
  if (revealedGame) {
    for (const teamId of draft.teamIds) {
      pickedByTeam.set(teamId, new Set<string>())
    }
    for (const pick of revealedGame.picks) {
      const set = pickedByTeam.get(pick.teamId)
      if (set) set.add(pick.championId)
    }
  }

  // Build player prior games count for "limited history" note
  const playerPriorGames = new Map<string, number>()
  for (const [, roleMap] of players) {
    for (const [, gp] of roleMap) {
      playerPriorGames.set(gp.playerId, gp.priorGames)
    }
  }

  return (
    <div className="leverage-panel">
      <div className="leverage-panel-title">
        Bans & Denial Picks
      </div>
      <div className="leverage-panel-explanation">
        A ban removes a champion for this game. A pick removes it for both teams for the rest of the series.
      </div>
      <div className="leverage-panel-grid">
        {draft.teamIds.map((teamId) => {
          const teamLeverage = leverage.get(teamId)
          if (!teamLeverage) return null
          const { leverage: leverageEntries, denial } = teamLeverage
          const team = teamMap.get(teamId)
          return (
            <div key={teamId} className="leverage-team-column">
              <div className="leverage-team-name">{team?.name ?? teamId}</div>

              {/* Bans to consider */}
              <div className="leverage-section">
                <div className="leverage-section-heading">Bans to consider</div>
                {(() => {
                  // Filter: only rows where net value > 2 percentage points
                  const filtered = leverageEntries.filter((entry) => {
                    const net = Math.round((entry.threatFromOpponent - entry.threatFromOwn) * 100)
                    return net > 2
                  })
                  if (filtered.length === 0) {
                    return <div className="leverage-none">No ban stands out: both teams want the same champions.</div>
                  }
                  // Find max net for bar scaling
                  const maxNet = Math.max(...filtered.map((entry) => Math.round((entry.threatFromOpponent - entry.threatFromOwn) * 100)), 1)
                  return filtered.map((entry) => {
                    const champ = championMap.get(entry.championId)
                    const isBanned = bannedByTeam.get(teamId)?.has(entry.championId)
                    const net = Math.round((entry.threatFromOpponent - entry.threatFromOwn) * 100)
                    const oppPct = Math.round(entry.threatFromOpponent * 100)
                    const ownPct = Math.round(entry.threatFromOwn * 100)
                    // Build "them" string: percentage with top player at ≥5%
                    const oppTop = entry.opponentHits.find((h) => h.probability >= 0.05)
                    const themStr = oppTop ? `them ${oppPct}% (${oppTop.playerName} ${Math.round(oppTop.probability * 100)}%)` : `them ${oppPct}%`
                    // Build "you" string: percentage with top player at ≥5%
                    const ownTop = entry.ownHits.find((h) => h.probability >= 0.05)
                    const youStr = ownTop ? `you ${ownPct}% (${ownTop.playerName} ${Math.round(ownTop.probability * 100)}%)` : `you ${ownPct}%`
                    // Section 4: "limited history" for players with <20 earlier games
                    const limitedHistoryPlayers: string[] = []
                    for (const h of entry.opponentHits) {
                      if ((playerPriorGames.get(h.playerId) ?? 0) < 20) limitedHistoryPlayers.push(h.playerName)
                    }
                    for (const h of entry.ownHits) {
                      if ((playerPriorGames.get(h.playerId) ?? 0) < 20 && !limitedHistoryPlayers.includes(h.playerName)) limitedHistoryPlayers.push(h.playerName)
                    }
                    // 6.2.1: On a ban turn, the acting team's ban rows are clickable buttons
                    const isClickable = onBan !== undefined && actingTeamId === teamId
                    return (
                      <button
                        key={entry.championId}
                        type="button"
                        className={`leverage-row ${isClickable ? 'leverage-row-clickable' : ''}`}
                        onClick={isClickable ? () => onBan(entry.championId) : undefined}
                        aria-label={`${champ?.name ?? entry.championId}, net leverage +${net}${isClickable ? ', click to ban' : ''}`}
                      >
                        <div className="leverage-row-left">
                          <span className="leverage-champ-name">{champ?.name ?? entry.championId}</span>
                          <span className={`leverage-net ${net > 0 ? 'leverage-net-positive' : ''}`}>+{net}</span>
                          {isBanned && <span className="leverage-label-banned">banned</span>}
                        </div>
                        <div className="leverage-row-right">
                          <div className="leverage-threat-bar">
                            <div
                              className="leverage-threat-fill"
                              style={{ width: `${(net / maxNet) * 100}%` }}
                            />
                          </div>
                          <span className="leverage-detail">{themStr} · {youStr}</span>
                          {limitedHistoryPlayers.length > 0 && (
                            <span className="leverage-limited-history">limited history: {limitedHistoryPlayers.join(', ')}</span>
                          )}
                        </div>
                      </button>
                    )
                  })
                })()}
              </div>

              {/* Denial picks */}
              <div className="leverage-section">
                <div className="leverage-section-heading">Picks that also deny</div>
                {denial.map((entry) => {
                  const champ = championMap.get(entry.championId)
                  const isPicked = pickedByTeam.get(teamId)?.has(entry.championId)
                  // Single-line format: "Champion · you: Player X% (N g) · them: Player Y%"
                  const themStr = entry.opponentHits.length > 0
                    ? entry.opponentHits.map((h) => `${h.playerName} ${Math.round(h.probability * 100)}%`).join(' · ')
                    : `${Math.round(entry.threatFromOpponent * 100)}%`
                  return (
                    <div key={entry.championId} className="leverage-row">
                      <div className="leverage-row-left">
                        <span className="leverage-champ-name">{champ?.name ?? entry.championId}</span>
                        {isPicked && <span className="leverage-label-picked">picked</span>}
                      </div>
                      <span className="leverage-detail">
                        you: {entry.ownPlayerName} {Math.round(entry.ownProbability * 100)}% ({entry.gamesPlayed} g) · them: {themStr}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
