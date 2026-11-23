import { useEffect, useMemo, useState } from 'react'
import type { ChampionRef, PickModel, PickRow, PlayerRef, Role, SeriesDraft, TeamRef } from '@fearless-board/shared'
import { gamePlan as computeGamePlan } from '@fearless-board/shared'
import { BurnedStrip } from './BurnedStrip'
import { CompactHistoryCard } from './CompactHistoryCard'
import { GameColumn } from './GameColumn'
import { LeveragePanel } from './LeveragePanel'
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
  backtestStats,
}: {
  draft: SeriesDraft
  picks: PickRow[]
  teamMap: Map<string, TeamRef>
  championMap: Map<string, ChampionRef>
  playerMap: Map<string, PlayerRef>
  selectedGame: number | null
  onSelectGame: (gameNumber: number) => void
  backtestStats?: {
    modelTop5?: number
    modelTop10?: number
    gamesPlayedTop5?: number
    gamesPlayedTop10?: number
    gameCount?: number
  }
}) {
  const gameNumber = selectedGame ?? (() => {
    if (draft.games.length >= 3) return 3
    if (draft.games.length >= 2) return 2
    return draft.games.length
  })()

  const [revealedGames, setRevealedGames] = useState<Set<number>>(new Set())

  // Load model (shared with PoolMatrix and LeveragePanel)
  const [model, setModel] = useState<PickModel | undefined>()
  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}data/model.json`).then(async (r) => {
      if (r.ok) setModel(await r.json())
    }).catch(() => {})
  }, [])

  // Compute gamePlan once (memoised on series, game number, and model)
  const plan = useMemo(() => {
    if (!model) return undefined
    const playerRole = new Map<string, Role | null>()
    for (const [id, p] of playerMap) {
      playerRole.set(id, p.role)
    }
    return computeGamePlan(draft, gameNumber, picks, model, playerRole)
  }, [draft, gameNumber, picks, model, playerMap])

  const t0 = teamMap.get(draft.teamIds[0])
  const t1 = teamMap.get(draft.teamIds[1])
  const name0 = t0?.name ?? draft.teamIds[0]
  const name1 = t1?.name ?? draft.teamIds[1]

  const score = useMemo(() => {
    // 3c: Show score going into game N — count only games before gameNumber
    let score0 = 0
    let score1 = 0
    for (const g of draft.games) {
      if (g.gameNumber >= gameNumber) continue
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

  const maxGames = draft.games.length

  return (
    <div className="series-board">
      {/* ── Header: team names, score pips, sides ─────────── */}
      <div className="series-header">
        <div className="series-teams-display">
          <span className="team-name display">{name0}</span>
          <span className="series-vs">vs</span>
          <span className="team-name display">{name1}</span>
        </div>
        <div className="series-score-line">
          {/* Team 0 name + pips */}
          <span className="team-name display" style={{ fontSize: '1.2rem' }}>{name0}</span>
          <div className="score-pips">
            {Array.from({ length: maxGames }, (_, i) => {
              // 3c: Fill only for games before gameNumber
              const game = draft.games[i]
              const isPast = game && game.gameNumber < gameNumber
              const won = isPast && game.winnerTeamId === draft.teamIds[0]
              return <div key={i} className={`pip ${won ? 'filled' : ''}`} />
            })}
          </div>
          <span className="score-text">{score.score0}–{score.score1}</span>
          {/* Team 1 name + pips */}
          <span className="team-name display" style={{ fontSize: '1.2rem' }}>{name1}</span>
          <div className="score-pips">
            {Array.from({ length: maxGames }, (_, i) => {
              const game = draft.games[i]
              const isPast = game && game.gameNumber < gameNumber
              const won = isPast && game.winnerTeamId === draft.teamIds[1]
              return <div key={i} className={`pip ${won ? 'filled' : ''}`} />
            })}
          </div>
        </div>
        {gameSides && (
          <div className="series-sides-line">
            Game {gameNumber}:{' '}
            <span style={{ color: 'var(--blue-side)' }}>
              {teamMap.get(gameSides.blue)?.name ?? gameSides.blue} blue
            </span>
            {' · '}
            <span style={{ color: 'var(--red-side)' }}>
              {teamMap.get(gameSides.red)?.name ?? gameSides.red} red
            </span>
          </div>
        )}
        <p className="series-info">
          {draft.event} · {draft.stage} · {new Date(draft.scheduledStart).toLocaleDateString()}
        </p>
      </div>

      {/* ── Game stepper ──────────────────────────────────── */}
      <div className="game-stepper">
        {draft.games.map((g) => (
          <button
            key={g.gameId}
            className={gameNumber === g.gameNumber ? 'selected' : ''}
            onClick={() => onSelectGame(g.gameNumber)}
            disabled={g.gameNumber > gameNumber && !revealedGames.has(g.gameNumber)}
          >
            Game {g.gameNumber}
          </button>
        ))}
      </div>

      {/* ── Reveal button for unrevealed selected game ────── */}
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

      {/* ── Pool matrix (first, within 300px) ─────────────── */}
      {gameNumber && plan && (
        <PoolMatrix
          plan={plan}
          draft={draft}
          teamMap={teamMap}
          championMap={championMap}
          gameNumber={gameNumber}
          revealedGame={revealedGames.has(gameNumber) ? draft.games.find((g) => g.gameNumber === gameNumber) : undefined}
        />
      )}

      {/* ── Leverage panel (after matrix) ──────────────────── */}
      {gameNumber && plan && (
        <LeveragePanel
          plan={plan}
          draft={draft}
          teamMap={teamMap}
          championMap={championMap}
          revealedGame={revealedGames.has(gameNumber) ? draft.games.find((g) => g.gameNumber === gameNumber) : undefined}
        />
      )}

      {/* ── 7: Backtest reliability line — directly under matrix ── */}
      {backtestStats && backtestStats.modelTop5 != null && backtestStats.gamesPlayedTop5 != null && (
        <div className="backtest-inline">
          <span className="backtest-note">
            On games 2 and later of 2026, the actual pick was among the five most likely {backtestStats.modelTop5}% of the time
            ({backtestStats.gamesPlayedTop5}% for a ranking by games played).
          </span>
        </div>
      )}

      {/* ── History cards ─────────────────────────────────── */}
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

      {/* ── Revealed upcoming games ───────────────────────── */}
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

      {/* ── Burned strip (below history) ──────────────────── */}
      {gameNumber && <BurnedStrip games={draft.games} gameNumber={gameNumber} championMap={championMap} />}
    </div>
  )
}
