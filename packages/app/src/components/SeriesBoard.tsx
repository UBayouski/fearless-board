import { useMemo, useState } from 'react'
import type { ChampionRef, PickRow, PlayerRef, SeriesDraft, TeamRef } from '@fearless-board/shared'
import { BurnedStrip } from './BurnedStrip'
import { CompactHistoryCard } from './CompactHistoryCard'
import { GameColumn } from './GameColumn'
import { PoolMatrix } from './PoolMatrix'
import './SeriesBoard.css'

export function SeriesBoard({
  draft,
  picks,
  teamMap,
  championMap,
  playerMap,
  selectedGame,
  onSelectGame,
}: {
  draft: SeriesDraft
  picks: PickRow[]
  teamMap: Map<string, TeamRef>
  championMap: Map<string, ChampionRef>
  playerMap: Map<string, PlayerRef>
  selectedGame: number | null
  onSelectGame: (gameNumber: number) => void
}) {
  const gameNumber = selectedGame ?? (() => {
    if (draft.games.length >= 3) return 3
    if (draft.games.length >= 2) return 2
    return draft.games.length
  })()

  void onSelectGame

  const [revealedGames, setRevealedGames] = useState<Set<number>>(new Set())

  const t0 = teamMap.get(draft.teamIds[0])
  const t1 = teamMap.get(draft.teamIds[1])

  const score = useMemo(() => {
    let score0 = 0
    let score1 = 0
    for (const g of draft.games) {
      if (g.gameNumber >= gameNumber) break
      if (g.winnerTeamId === draft.teamIds[0]) score0++
      else if (g.winnerTeamId === draft.teamIds[1]) score1++
    }
    return { score0, score1 }
  }, [draft.games, draft.teamIds, gameNumber])

  const gameSides = useMemo(() => {
    const g = draft.games.find((g) => g.gameNumber === gameNumber)
    return g?.sides ?? null
  }, [draft.games, gameNumber])

  const pastGames = draft.games.filter((g) => g.gameNumber < gameNumber)
  const revealedUpcoming = draft.games.filter((g) => g.gameNumber >= gameNumber && revealedGames.has(g.gameNumber))

  return (
    <div className="series-board">
      <h2>
        {t0?.name ?? draft.teamIds[0]} vs {t1?.name ?? draft.teamIds[1]}
      </h2>
      <p className="series-info">
        {draft.event} · {draft.stage} · {new Date(draft.scheduledStart).toLocaleDateString()}
      </p>

      {gameSides && (
        <div className="series-state">
          <span className="state-score">
            {t0?.name ?? draft.teamIds[0]} {score.score0}–{score.score1} {t1?.name ?? draft.teamIds[1]}
          </span>
          <span className="state-sides">
            · Game {gameNumber}:{' '}
            {(() => {
              const blueTeam = teamMap.get(gameSides.blue)
              const redTeam = teamMap.get(gameSides.red)
              return `${blueTeam?.name ?? gameSides.blue} blue, ${redTeam?.name ?? gameSides.red} red`
            })()}
          </span>
        </div>
      )}

      {pastGames.length > 0 && (
        <div className="history-row">
          {pastGames.map((g) => (
            <CompactHistoryCard
              key={g.gameId}
              game={g}
              teamMap={teamMap}
              championMap={championMap}
              playerMap={playerMap}
            />
          ))}
        </div>
      )}

      {revealedUpcoming.length > 0 && (
        <div className="games-row">
          {revealedUpcoming.map((g) => (
            <GameColumn
              key={g.gameId}
              game={g}
              teamMap={teamMap}
              championMap={championMap}
              playerMap={playerMap}
              isSelected={false}
              onSelect={() => {}}
            />
          ))}
        </div>
      )}

      {(() => {
        const selectedUpcoming = draft.games.find((g) => g.gameNumber === gameNumber && !revealedGames.has(g.gameNumber))
        if (selectedUpcoming) {
          return (
            <div className="reveal-section">
              <button
                className="reveal-btn"
                onClick={() => {
                  const next = new Set(revealedGames)
                  next.add(selectedUpcoming.gameNumber)
                  setRevealedGames(next)
                }}
              >
                Reveal Game {selectedUpcoming.gameNumber}
              </button>
            </div>
          )
        }
        const revealedSelected = draft.games.find((g) => g.gameNumber === gameNumber && revealedGames.has(g.gameNumber))
        if (revealedSelected) {
          const nextGame = draft.games.find((g) => g.gameNumber > gameNumber)
          if (nextGame) {
            return (
              <div className="reveal-section">
                <button
                  className="reveal-btn"
                  onClick={() => {
                    onSelectGame(nextGame.gameNumber)
                  }}
                >
                  Next game (Game {nextGame.gameNumber})
                </button>
              </div>
            )
          }
        }
        return null
      })()}

      {gameNumber && <BurnedStrip games={draft.games} gameNumber={gameNumber} championMap={championMap} />}

      {gameNumber && (
        <PoolMatrix
          draft={draft}
          picks={picks}
          teamMap={teamMap}
          championMap={championMap}
          playerMap={playerMap}
          gameNumber={gameNumber}
          revealedGame={revealedGames.has(gameNumber) ? draft.games.find((g) => g.gameNumber === gameNumber) : undefined}
        />
      )}
    </div>
  )
}
