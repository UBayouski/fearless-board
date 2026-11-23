import { useMemo } from 'react'
import type { ChampionRef, GameDraft, GamePlan, Role, SeriesDraft, TeamRef } from '@fearless-board/shared'
import { PoolMatrixCell } from './PoolMatrixCell'
import './PoolMatrix.css'

const ROLE_ORDER: Role[] = ['top', 'jungle', 'mid', 'bot', 'support']

export function PoolMatrix({
  plan,
  draft,
  teamMap,
  championMap,
  gameNumber,
  revealedGame,
}: {
  plan: GamePlan
  draft: SeriesDraft
  teamMap: Map<string, TeamRef>
  championMap: Map<string, ChampionRef>
  gameNumber: number
  revealedGame?: GameDraft
}) {
  const { burnedByGame, players } = plan

  // Build revealed pick map: for each player, what champion they actually picked and its rank
  const revealedPickMap = useMemo(() => {
    if (!revealedGame) return undefined
    const map = new Map<string, { championId: string; rank: number } | null>()
    for (const [, roleMap] of players) {
      for (const [, gp] of roleMap) {
        // Find this player's actual pick in the revealed game
        const actualPick = revealedGame.picks.find(p => p.playerId === gp.playerId)
        if (!actualPick) continue
        const rank = gp.likelihoods.findIndex(l => l.championId === actualPick.championId) + 1
        if (rank > 0) {
          map.set(gp.playerId, { championId: actualPick.championId, rank })
        } else {
          map.set(gp.playerId, null)
        }
      }
    }
    return map
  }, [revealedGame, players])

  // Reveal summary: count picks in pool
  const revealSummary = useMemo(() => {
    if (!revealedPickMap) return null
    let inPool = 0
    let total = 0
    for (const [, val] of revealedPickMap) {
      total++
      if (val !== null) inPool++
    }
    return { inPool, total }
  }, [revealedPickMap])

  return (
    <>
      {revealSummary && (
        <div className="reveal-summary">
          {revealSummary.inPool} of {revealSummary.total} picks came from the available pools
        </div>
      )}
      <div className="pool-matrix">
        <div className="pool-matrix-header">
          <div className="pool-matrix-corner"></div>
          {draft.teamIds.map((teamId) => {
            const team = teamMap.get(teamId)
            const name = team?.name ?? teamId
            const teamLineupChanged = plan.lineupChanged.get(teamId)
            return (
              <div key={teamId} className="pool-matrix-team-header">
                {name}
                {teamLineupChanged && <span className="pool-lineup-note">lineup changed during this series; showing the players of game {gameNumber - 1 >= 1 ? gameNumber - 1 : 1}</span>}
              </div>
            )
          })}
        </div>

        {ROLE_ORDER.map((role) => (
          <div key={role} className="pool-matrix-row">
            <div className="pool-matrix-role-label">{role.toUpperCase()}</div>
            {draft.teamIds.map((teamId) => {
              const gp = players.find(([tid]) => tid === teamId)?.[1].get(role)
              if (!gp) {
                return <div key={teamId} className="pool-cell pool-cell-empty">—</div>
              }
              return (
                <div key={teamId} className="pool-matrix-cell">
                  <PoolMatrixCell
                    playerName={gp.playerName}
                    role={gp.role}
                    pool={gp.pool}
                    burnedByGame={burnedByGame}
                    championMap={championMap}
                    seriesDate={draft.scheduledStart}
                    revealedPick={revealedPickMap?.get(gp.playerId)}
                    likelihoods={gp.likelihoods}
                    priorGames={gp.priorGames}
                    substitute={gp.substitute}
                  />
                </div>
              )
            })}
          </div>
        ))}

        {/* Players without a known role */}
        {(() => {
          const hasUnknown = plan.unknownRolePlayers.some(([, gps]) => gps.length > 0)
          if (!hasUnknown) return null
          return (
            <div className="pool-matrix-row">
              <div className="pool-matrix-role-label">ROLE UNKNOWN</div>
              {draft.teamIds.map((teamId) => {
                const unknownGps = plan.unknownRolePlayers.find(([tid]) => tid === teamId)?.[1] ?? []
                if (unknownGps.length === 0) {
                  return <div key={teamId} className="pool-cell pool-cell-empty">—</div>
                }
                return (
                  <div key={teamId} className="pool-matrix-cell">
                    {unknownGps.map((gp) => (
                      <PoolMatrixCell
                        key={gp.playerId}
                        playerName={gp.playerName}
                        role={null}
                        pool={gp.pool}
                        burnedByGame={burnedByGame}
                        championMap={championMap}
                        seriesDate={draft.scheduledStart}
                        revealedPick={revealedPickMap?.get(gp.playerId)}
                        likelihoods={gp.likelihoods}
                        priorGames={gp.priorGames}
                        substitute={gp.substitute}
                      />
                    ))}
                  </div>
                )
              })}
            </div>
          )
        })()}
      </div>
    </>
  )
}
