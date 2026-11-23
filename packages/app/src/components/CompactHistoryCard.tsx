import { useMemo } from 'react'
import type { GameDraft, ChampionRef, PlayerRef, TeamRef } from '@fearless-board/shared'
import { picksByTeamInRoleOrder } from './gamePicks'
import './CompactHistoryCard.css'

export function CompactHistoryCard({
  game,
  teamMap,
  championMap,
  playerMap,
}: {
  game: GameDraft
  teamMap: Map<string, TeamRef>
  championMap: Map<string, ChampionRef>
  playerMap: Map<string, PlayerRef>
}) {
  const picksByTeam = useMemo(() => picksByTeamInRoleOrder(game.picks, playerMap), [game.picks, playerMap])

  const bans = useMemo(() => {
    return game.actions.filter((a) => a.type === 'ban')
  }, [game.actions])

  return (
    <div className={`compact-history ${game.winnerTeamId ? 'winner' : ''}`}>
      <div className="compact-header">
        <strong>Game {game.gameNumber}</strong>
        {game.winnerTeamId && (
          <span className="compact-winner">
            ✓ {teamMap.get(game.winnerTeamId)?.name ?? game.winnerTeamId}
          </span>
        )}
      </div>

      {['blue', 'red'].map((side) => {
        const teamId = game.sides[side as 'blue' | 'red']
        const team = teamMap.get(teamId)
        const picks = picksByTeam.get(teamId) ?? []
        return (
          <div key={side} className={`compact-side ${side}`}>
            <span className="compact-side-label">{side === 'blue' ? 'B' : 'R'}</span>
            <span className="compact-team-name">{team?.name ?? teamId}</span>
            <span className="compact-picks">
              {picks.map((p) => {
                const champ = championMap.get(p.championId)
                return <span key={p.playerId} className="champ-tile compact-champ">{champ?.name ?? p.championId}</span>
              })}
            </span>
          </div>
        )
      })}

      {bans.length > 0 && (
        <div className="compact-bans">
          {(() => {
            const bansByTeam = new Map<string, string[]>()
            for (const b of bans) {
              const list = bansByTeam.get(b.teamId) ?? []
              const champ = championMap.get(b.championId)
              list.push(champ?.name ?? b.championId)
              bansByTeam.set(b.teamId, list)
            }
            return (
              <>
                {[...bansByTeam.entries()].map(([teamId, names]) => {
                  const team = teamMap.get(teamId)
                  return (
                    <div key={teamId} className="compact-ban-team">
                      <span className="compact-ban-team-label">{team?.name ?? teamId}:</span>
                      {names.map((name, i) => (
                        <span key={i} className="champ-tile banned compact-ban-champ">{name}</span>
                      ))}
                    </div>
                  )
                })}
              </>
            )
          })()}
        </div>
      )}
    </div>
  )
}
