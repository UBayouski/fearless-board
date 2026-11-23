import { useMemo } from 'react'
import type { ChampionRef, GameDraft, GamePlan, GamePlanPlayer, Role, SeriesDraft, TeamRef } from '@fearless-board/shared'
import { PLANNING_PICKS, PoolMatrixCell } from './PoolMatrixCell'
import './PoolMatrix.css'

const ROLE_ORDER: Role[] = ['top', 'jungle', 'mid', 'bot', 'support']

export function PoolMatrix({
  plan,
  forecastPlan = plan,
  draft,
  teamMap,
  championMap,
  gameNumber,
  revealedGame,
  draftMode,
  draftConditioned,
  currentDraftSlot,
  onPick,
  lastRemoved,
  removedForPlayers,
  replayPickRanks,
  actingTeamId,
}: {
  plan: GamePlan
  forecastPlan?: GamePlan
  draft: SeriesDraft
  teamMap: Map<string, TeamRef>
  championMap: Map<string, ChampionRef>
  gameNumber: number
  revealedGame?: GameDraft
  draftMode?: boolean
  draftConditioned?: { unavailable: Set<string>; pickedPlayers: Set<string>; pickedChampions: Map<string, string> } | null
  currentDraftSlot?: { slot: string; side: '1' | '2'; type: 'b' | 'p'; teamId: string } | null
  onPick?: (playerId: string, championId: string) => void
  /** 6.2.3: The last removed champion for one-step visibility. */
  lastRemoved?: { championId: string; type: 'ban' | 'pick' } | null
  /** Players who had that champion in their top 10 just before it was removed. */
  removedForPlayers?: Set<string>
  /** 6.2.5: Replay pick ranks — playerId → rank (0 = outside top 10). */
  replayPickRanks?: Map<string, number>
  /** 2.3: The team acting on the current turn (for ember underline). */
  actingTeamId?: string | null
}) {
  const { burnedByGame, players } = plan

  const reveal = useMemo(() => {
    if (!revealedGame) return undefined
    const lineup = [
      ...forecastPlan.players.flatMap(([, roles]) => Array.from(roles.values())),
      ...forecastPlan.unknownRolePlayers.flatMap(([, group]) => group),
    ]
    const byPlayer = new Map<string, { championId: string; rank: number }>()
    let inPool = 0
    let forecastCount = 0
    let topFive = 0
    for (const pick of revealedGame.picks) {
      const player = lineup.find(p => p.playerId === pick.playerId)
      if (!player) continue
      const rank = player.likelihoods.findIndex(l => l.championId === pick.championId) + 1
      if (player.likelihoods.length > 0) {
        forecastCount++
        if (rank > 0 && rank <= PLANNING_PICKS) topFive++
      }
      byPlayer.set(player.playerId, { championId: pick.championId, rank })
      if (player.pool.credible.some(c => c.championId === pick.championId)) inPool++
    }
    return { byPlayer, inPool, total: byPlayer.size, forecastCount, topFive, actualCount: revealedGame.picks.length }
  }, [revealedGame, forecastPlan])


  const cellClass = (teamId: string) => {
    const isOtherTeam = draftMode && currentDraftSlot?.type === 'p' && currentDraftSlot.teamId !== teamId
    return isOtherTeam ? 'pool-matrix-cell pool-matrix-other-team' : 'pool-matrix-cell'
  }

  const renderPlayer = (teamId: string, gp: GamePlanPlayer) => {
    const hasPicked = draftConditioned?.pickedPlayers.has(gp.playerId) ?? false
    const isPickingPlayer = draftMode && currentDraftSlot?.type === 'p'
      && currentDraftSlot.teamId === teamId && !hasPicked
    return (
      <PoolMatrixCell
        key={gp.playerId}
        teamName={teamMap.get(teamId)?.name ?? teamId}
        playerName={gp.playerName}
        playerId={gp.playerId}
        role={gp.role}
        pool={gp.pool}
        burnedByGame={burnedByGame}
        championMap={championMap}
        seriesDate={draft.scheduledStart}
        revealedPick={reveal?.byPlayer.get(gp.playerId)}
        likelihoods={gp.likelihoods}
        priorGames={gp.priorGames}
        substitute={gp.substitute}
        isPickingPlayer={isPickingPlayer}
        onPick={isPickingPlayer ? onPick : undefined}
        unavailable={draftMode ? draftConditioned?.unavailable : undefined}
        hasPicked={hasPicked}
        pickedChampionId={draftConditioned?.pickedChampions.get(gp.playerId)}
        lastRemoved={removedForPlayers?.has(gp.playerId) ? lastRemoved : undefined}
        replayRank={replayPickRanks?.get(gp.playerId)}
      />
    )
  }

  return (
    <>
      {reveal && (
        <div className="reveal-summary">
          <span>{reveal.inPool} of {reveal.total} picks came from the available pools</span>
          {reveal.forecastCount > 0 && (
            <span>
              {reveal.topFive} of {reveal.forecastCount} picks{reveal.forecastCount < reveal.actualCount ? ' with a forecast' : ''} were in the model’s top five
            </span>
          )}
        </div>
      )}
      <div className="pool-matrix">
        <div className="pool-matrix-header">
          <div className="pool-matrix-corner"></div>
          {draft.teamIds.map((teamId) => {
            const team = teamMap.get(teamId)
            const name = team?.name ?? teamId
            const teamLineupChanged = plan.lineupChanged.get(teamId)
            const isActing = actingTeamId === teamId
            return (
              <div key={teamId} className={`pool-matrix-team-header ${isActing ? 'pool-matrix-acting' : ''}`}>
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
                <div key={teamId} className={cellClass(teamId)}>
                  {renderPlayer(teamId, gp)}
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
                  <div key={teamId} className={cellClass(teamId)}>
                    {unknownGps.map(gp => renderPlayer(teamId, gp))}
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
