import { useMemo } from 'react'
import type { GameDraft, ChampionRef, PlayerRef, Role, TeamRef } from '@fearless-board/shared'
import './GameColumn.css'

const ROLE_ORDER = ['top', 'jungle', 'mid', 'bot', 'support']

function roleLabel(role: Role | null | undefined): string {
  return role ?? '?'
}

export function GameColumn({
  game,
  teamMap,
  championMap,
  playerMap,
  isSelected,
  onSelect,
}: {
  game: GameDraft
  teamMap: Map<string, TeamRef>
  championMap: Map<string, ChampionRef>
  playerMap: Map<string, PlayerRef>
  isSelected: boolean
  onSelect: () => void
}) {
  const hasActions = game.actions.length > 0

  const picksByTeam = useMemo(() => {
    const map = new Map<string, typeof game.picks>()
    for (const p of game.picks) {
      const list = map.get(p.teamId) ?? []
      list.push(p)
      map.set(p.teamId, list)
    }
    return map
  }, [game.picks])

  const sortByRole = (picks: typeof game.picks) => {
    const roleOrderMap = new Map<string, number>()
    for (let i = 0; i < ROLE_ORDER.length; i++) roleOrderMap.set(ROLE_ORDER[i], i)
    return [...picks].sort((a, b) => {
      const ra = roleOrderMap.get(playerMap.get(a.playerId)?.role ?? '') ?? 99
      const rb = roleOrderMap.get(playerMap.get(b.playerId)?.role ?? '') ?? 99
      return ra - rb
    })
  }

  return (
    <div className={`game-column ${isSelected ? 'selected' : ''}`} onClick={onSelect}>
      <div className="game-header">
        <strong>Game {game.gameNumber}</strong>
        {game.patch && <span className="game-patch">({game.patch})</span>}
        {game.winnerTeamId && (
          <span className="game-winner">
            Winner: {teamMap.get(game.winnerTeamId)?.name ?? game.winnerTeamId}
          </span>
        )}
      </div>

      {['blue', 'red'].map((side) => {
        const teamId = game.sides[side as 'blue' | 'red']
        const team = teamMap.get(teamId)
        const picks = sortByRole(picksByTeam.get(teamId) ?? [])
        return (
          <div key={side} className={`side ${side}`}>
            <div className="side-label">{side.toUpperCase()} — {team?.name ?? teamId}</div>
            {picks.map((p) => {
              const champ = championMap.get(p.championId)
              const player = playerMap.get(p.playerId)
              return (
                <div key={p.playerId} className="pick-row">
                  <span className="pick-role">{roleLabel(player?.role)}</span>
                  <span className="pick-player">{p.playerName}</span>
                  <span className="champ-tile">{champ?.name ?? p.championId}</span>
                </div>
              )
            })}
          </div>
        )
      })}

      {hasActions && (
        <div className="bans">
          <div className="bans-label">Bans</div>
          {game.actions
            .filter((a) => a.type === 'ban')
            .map((a) => {
              const champ = championMap.get(a.championId)
              const team = teamMap.get(a.teamId)
              return (
                <div key={a.order} className="ban-row">
                  <span className="ban-team">{team?.name ?? a.teamId}</span>
                  <span className="champ-tile banned">{champ?.name ?? a.championId}</span>
                </div>
              )
            })}
        </div>
      )}

      {!hasActions && <div className="no-actions-note">No draft data</div>}
    </div>
  )
}
