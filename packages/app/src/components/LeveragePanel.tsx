import { useState } from 'react'
import type { ChampionRef, GameDraft, GamePlan, SeriesDraft, TeamRef } from '@fearless-board/shared'
import './LeveragePanel.css'

const COLLAPSED_ROWS = 3

export function LeveragePanel({
  plan,
  draft,
  teamMap,
  championMap,
  revealedGame,
  onBan,
  actingTeamId,
  onSelectChampion,
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
  /** Called when a row in "Picks that also deny" is clicked: shows that champion's cost in the outlook. */
  onSelectChampion?: (championId: string) => void
}) {
  const { leverage, players } = plan
  const [expanded, setExpanded] = useState(false)

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
      <div className="leverage-panel-header">
        <div className="leverage-panel-title">Bans & Denial Picks</div>
        <button
          type="button"
          className="leverage-show-all"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? 'show fewer' : 'show all'}
        </button>
      </div>
      <div className={`leverage-panel-grid ${!expanded ? 'leverage-collapsed' : ''}`}>
        {draft.teamIds.map((teamId) => {
          const teamLeverage = leverage.get(teamId)
          if (!teamLeverage) return null
          const { leverage: leverageEntries, denial } = teamLeverage
          const team = teamMap.get(teamId)
          return (
            <div key={teamId} className={`leverage-team-column ${actingTeamId === teamId ? 'acting-team' : ''}`}>
              <div className="leverage-team-name">{team?.name ?? teamId}</div>
              <div className="leverage-sections">

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
                    return <div className="leverage-none">No ban stands out.</div>
                  }
                  // Find max net for bar scaling
                  const maxNet = Math.max(...filtered.map((entry) => Math.round((entry.threatFromOpponent - entry.threatFromOwn) * 100)), 1)
                  const rows = filtered.map((entry) => {
                    const champ = championMap.get(entry.championId)
                    const isBanned = bannedByTeam.get(teamId)?.has(entry.championId)
                    const net = Math.round((entry.threatFromOpponent - entry.threatFromOwn) * 100)
                    const oppPct = Math.round(entry.threatFromOpponent * 100)
                    const ownPct = Math.round(entry.threatFromOwn * 100)
                    const oppTop = entry.opponentHits.find((h) => h.probability >= 0.05)
                    const themStr = oppTop ? `them ${oppPct}% (${oppTop.playerName} ${Math.round(oppTop.probability * 100)}%)` : `them ${oppPct}%`
                    const ownTop = entry.ownHits.find((h) => h.probability >= 0.05)
                    const youStr = ownTop ? `you ${ownPct}% (${ownTop.playerName} ${Math.round(ownTop.probability * 100)}%)` : `you ${ownPct}%`
                    const limitedHistoryPlayers: string[] = []
                    for (const h of entry.opponentHits) {
                      if ((playerPriorGames.get(h.playerId) ?? 0) < 20) limitedHistoryPlayers.push(h.playerName)
                    }
                    for (const h of entry.ownHits) {
                      if ((playerPriorGames.get(h.playerId) ?? 0) < 20 && !limitedHistoryPlayers.includes(h.playerName)) limitedHistoryPlayers.push(h.playerName)
                    }
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
                  if (!expanded) return rows.slice(0, COLLAPSED_ROWS)
                  return rows
                })()}
              </div>

              {/* Denial picks */}
              <div className="leverage-section">
                <div className="leverage-section-heading">Picks that also deny</div>
                {(() => {
                  const denialRows = denial.map((entry) => {
                    const champ = championMap.get(entry.championId)
                    const isPicked = pickedByTeam.get(teamId)?.has(entry.championId)
                    const themStr = entry.opponentHits.length > 0
                      ? entry.opponentHits.map((h) => `${h.playerName} ${Math.round(h.probability * 100)}%`).join(' · ')
                      : `${Math.round(entry.threatFromOpponent * 100)}%`
                    return (
                      <button
                        key={entry.championId}
                        type="button"
                        className={`leverage-row ${onSelectChampion ? 'leverage-row-clickable' : ''}`}
                        onClick={onSelectChampion ? () => onSelectChampion(entry.championId) : undefined}
                        aria-label={`${champ?.name ?? entry.championId}, show what this pick costs both teams`}
                      >
                        <div className="leverage-row-left">
                          <span className="leverage-champ-name">{champ?.name ?? entry.championId}</span>
                          {isPicked && <span className="leverage-label-picked">picked</span>}
                        </div>
                        <span className="leverage-detail">
                          you: {entry.ownPlayerName} {Math.round(entry.ownProbability * 100)}% ({entry.gamesPlayed} g) · them: {themStr}
                        </span>
                      </button>
                    )
                  })
                  if (!expanded) return denialRows.slice(0, COLLAPSED_ROWS)
                  return denialRows
                })()}
              </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
