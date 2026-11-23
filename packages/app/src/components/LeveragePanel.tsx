import { useMemo } from 'react'
import type { ChampionRef, GameDraft, PickModel, PickRow, PlayerRef, SeriesDraft, TeamRef } from '@fearless-board/shared'
import { banLeverage, buildPickLikelihoods, burnedChampions, denialPicks, playerPool, type BanLeverageEntry, type DenialPickEntry, type PickLikelihood } from '@fearless-board/shared'
import './LeveragePanel.css'

export function LeveragePanel({
  draft,
  picks,
  teamMap,
  championMap,
  playerMap,
  gameNumber,
  model,
  revealedGame,
}: {
  draft: SeriesDraft
  picks: PickRow[]
  teamMap: Map<string, TeamRef>
  championMap: Map<string, ChampionRef>
  playerMap: Map<string, PlayerRef>
  gameNumber: number
  model?: PickModel
  revealedGame?: GameDraft
}) {
  // If no model loaded yet, don't render
  if (!model) return null

  const game = draft.games.find((g) => g.gameNumber === gameNumber)
  if (!game) return null

  const burned = burnedChampions(draft.games, gameNumber)
  const allChampionIds = draft.championsSeen ? new Set(draft.championsSeen) : new Set<string>()
  const available = new Set<string>()
  for (const c of allChampionIds) {
    if (!burned.has(c)) available.add(c)
  }

  // Build per-player likelihoods
  const likelihoodsByPlayer = useMemo(() => {
    const map = new Map<string, PickLikelihood[]>()
    for (const pick of game.picks) {
      const player = playerMap.get(pick.playerId)
      if (!player || !player.role) {
        map.set(pick.playerId, [])
        continue
      }
      const lks = buildPickLikelihoods(
        model,
        pick.playerId,
        player.role,
        draft.scheduledStart,
        picks,
        burned,
        draft.roleCounts ?? {},
        allChampionIds,
      )
      map.set(pick.playerId, lks)
    }
    return map
  }, [game.picks, playerMap, model, draft.scheduledStart, picks, burned, draft.roleCounts, allChampionIds])

  // Build per-player pools (for denial picks)
  const playerPools = useMemo(() => {
    const pools = new Map<string, Map<string, number>>()
    for (const pick of game.picks) {
      const pool = playerPool(picks, pick.playerId, draft.scheduledStart)
      const champGames = new Map<string, number>()
      for (const entry of pool) {
        champGames.set(entry.championId, entry.games)
      }
      pools.set(pick.playerId, champGames)
    }
    return pools
  }, [game.picks, picks, draft.scheduledStart])

  // Compute leverage and denial for each team
  const teamData = useMemo(() => {
    return draft.teamIds.map((teamId) => {
      const oppTeamId = draft.teamIds.find((t) => t !== teamId)
      if (!oppTeamId) return null

      const ownPlayerIds = game.picks.filter((p) => p.teamId === teamId).map((p) => p.playerId)
      const oppPlayerIds = game.picks.filter((p) => p.teamId === oppTeamId).map((p) => p.playerId)

      const ownPlayerLikelihoods = ownPlayerIds.map((pid) => likelihoodsByPlayer.get(pid) ?? [])
      const oppPlayerLikelihoods = oppPlayerIds.map((pid) => likelihoodsByPlayer.get(pid) ?? [])

      const ownPlayers: PlayerRef[] = ownPlayerIds.map((pid) => ({
        id: pid,
        name: game.picks.find((p) => p.playerId === pid)?.playerName ?? '',
        role: playerMap.get(pid)?.role ?? null,
      }))
      const oppPlayers: PlayerRef[] = oppPlayerIds.map((pid) => ({
        id: pid,
        name: game.picks.find((p) => p.playerId === pid)?.playerName ?? '',
        role: playerMap.get(pid)?.role ?? null,
      }))

      const leverage = banLeverage(oppPlayerLikelihoods, ownPlayerLikelihoods, oppPlayers, ownPlayers, available)
      const denial = denialPicks(
        ownPlayerLikelihoods,
        oppPlayerLikelihoods,
        ownPlayers,
        oppPlayers,
        available,
        playerPools,
      )

      return { teamId, leverage, denial }
    }).filter(Boolean) as { teamId: string; leverage: BanLeverageEntry[]; denial: DenialPickEntry[] }[]
  }, [draft.teamIds, game.picks, likelihoodsByPlayer, playerMap, available, playerPools])

  // Build set of actually banned champions per team (for reveal)
  const bannedByTeam = useMemo(() => {
    if (!revealedGame) return new Map<string, Set<string>>()
    const map = new Map<string, Set<string>>()
    for (const teamId of draft.teamIds) {
      map.set(teamId, new Set<string>())
    }
    for (const action of revealedGame.actions) {
      if (action.type === 'ban') {
        const set = map.get(action.teamId)
        if (set) set.add(action.championId)
      }
    }
    return map
  }, [revealedGame, draft.teamIds])

  // Build set of actually picked champions per team (for reveal)
  const pickedByTeam = useMemo(() => {
    if (!revealedGame) return new Map<string, Set<string>>()
    const map = new Map<string, Set<string>>()
    for (const teamId of draft.teamIds) {
      map.set(teamId, new Set<string>())
    }
    for (const pick of revealedGame.picks) {
      const set = map.get(pick.teamId)
      if (set) set.add(pick.championId)
    }
    return map
  }, [revealedGame, draft.teamIds])

  return (
    <div className="leverage-panel">
      <div className="leverage-panel-title">
        Bans & Denial Picks
      </div>
      <div className="leverage-panel-explanation">
        A ban removes a champion for this game. A pick removes it for both teams for the rest of the series.
      </div>
      <div className="leverage-panel-grid">
        {teamData.map(({ teamId, leverage, denial }) => {
          const team = teamMap.get(teamId)
          return (
            <div key={teamId} className="leverage-team-column">
              <div className="leverage-team-name">{team?.name ?? teamId}</div>

              {/* Bans to consider */}
              <div className="leverage-section">
                <div className="leverage-section-heading">Bans to consider</div>
                {(() => {
                  // Filter: only rows where net value > 2 percentage points
                  const filtered = leverage.filter((entry) => {
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
                    return (
                      <div key={entry.championId} className="leverage-row">
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
                        </div>
                      </div>
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
