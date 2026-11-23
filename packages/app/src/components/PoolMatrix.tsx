import { useEffect, useMemo, useState } from 'react'
import type { ChampionRef, GameDraft, PickModel, PickRow, PlayerRef, Role, SeriesDraft, TeamRef } from '@fearless-board/shared'
import { burnedChampions, crediblePool, playerPool } from '@fearless-board/shared'
import { PoolMatrixCell } from './PoolMatrixCell'
import './PoolMatrix.css'

const ROLE_ORDER: Role[] = ['top', 'jungle', 'mid', 'bot', 'support']

export function PoolMatrix({
  draft,
  picks,
  teamMap,
  championMap,
  playerMap,
  gameNumber,
  revealedGame,
}: {
  draft: SeriesDraft
  picks: PickRow[]
  teamMap: Map<string, TeamRef>
  championMap: Map<string, ChampionRef>
  playerMap: Map<string, PlayerRef>
  gameNumber: number
  revealedGame?: GameDraft
}) {
  // Load model
  const [model, setModel] = useState<PickModel | undefined>()
  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}data/model.json`).then(async (r) => {
      if (r.ok) setModel(await r.json())
    }).catch(() => {})
  }, [])
  const burned = burnedChampions(draft.games, gameNumber)

  const burnedByGame = useMemo(() => {
    const map = new Map<string, number>()
    for (const g of draft.games) {
      if (g.gameNumber >= gameNumber) break
      if (g.picks.length > 0) {
        for (const p of g.picks) {
          if (!map.has(p.championId)) {
            map.set(p.championId, g.gameNumber)
          }
        }
      }
    }
    return map
  }, [draft.games, gameNumber])

  const playerGrid = useMemo(() => {
    const grid = new Map<string, Map<Role, PlayerRef>>()
    for (const teamId of draft.teamIds) {
      const teamPlayers = new Map<Role, PlayerRef>()
      for (const role of ROLE_ORDER) {
        for (const game of draft.games) {
          for (const pick of game.picks) {
            if (pick.teamId === teamId) {
              const player = playerMap.get(pick.playerId)
              if (player && player.role === role) {
                teamPlayers.set(role, player)
                break
              }
            }
          }
          if (teamPlayers.has(role)) break
        }
      }
      grid.set(teamId, teamPlayers)
    }
    return grid
  }, [draft.teamIds, draft.games, playerMap])

  const revealedPickMap = useMemo(() => {
    if (!revealedGame) return undefined
    const map = new Map<string, { championId: string; rank: number } | null>()
    const picksByTeam = new Map<string, typeof revealedGame.picks>()
    for (const p of revealedGame.picks) {
      const list = picksByTeam.get(p.teamId) ?? []
      list.push(p)
      picksByTeam.set(p.teamId, list)
    }
    for (const teamId of draft.teamIds) {
      const teamPicks = picksByTeam.get(teamId) ?? []
      for (const pick of teamPicks) {
        const player = playerMap.get(pick.playerId)
        if (!player) continue
        const pool = playerPool(picks, player.id, draft.scheduledStart)
        const { credible } = crediblePool(pool, burned)
        const rank = credible.findIndex((e) => e.championId === pick.championId) + 1
        if (rank > 0) {
          map.set(pick.playerId, { championId: pick.championId, rank })
        } else {
          map.set(pick.playerId, null)
        }
      }
    }
    return map
  }, [revealedGame, picks, draft.scheduledStart, draft.teamIds, playerMap, burned])

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
            return <div key={teamId} className="pool-matrix-team-header">{team?.name ?? teamId}</div>
          })}
        </div>

        {ROLE_ORDER.map((role) => (
          <div key={role} className="pool-matrix-row">
            <div className="pool-matrix-role-label">{role.toUpperCase()}</div>
            {draft.teamIds.map((teamId) => {
              const player = playerGrid.get(teamId)?.get(role)
              if (!player) {
                return <div key={teamId} className="pool-cell pool-cell-empty">—</div>
              }
              const pool = playerPool(picks, player.id, draft.scheduledStart)
              const { credible, burned: burnedEntries } = crediblePool(pool, burned)
              const allChampionIds = draft.championsSeen ? new Set(draft.championsSeen) : undefined
              return (
                <div key={teamId} className="pool-matrix-cell">
                  <PoolMatrixCell
                    playerId={player.id}
                    playerName={player.name}
                    role={player.role}
                    pool={{ credible, burned: burnedEntries }}
                    burnedByGame={burnedByGame}
                    championMap={championMap}
                    seriesDate={draft.scheduledStart}
                    revealedPick={revealedPickMap?.get(player.id)}
                    model={model}
                    picks={picks}
                    roleCounts={draft.roleCounts}
                    allChampionIds={allChampionIds}
                  />
                </div>
              )
            })}
          </div>
        ))}
      </div>
    </>
  )
}
