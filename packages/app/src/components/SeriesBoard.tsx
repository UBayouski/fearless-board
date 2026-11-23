import { useEffect, useMemo, useReducer, useState } from 'react'
import type { ChampionRef, DraftActionInput, GameDraft, PickModel, PickRow, PlayerRef, Role, SeriesDraft, TeamRef } from '@fearless-board/shared'
import { gamePlan as computeGamePlan, DRAFT_ORDER } from '@fearless-board/shared'
import { draftReducer, actingTeam, liveGamePlan, firstTeamOfGame, type DraftSession, type DraftEvent } from '@fearless-board/shared'
import { BurnedStrip } from './BurnedStrip'
import { CompactHistoryCard } from './CompactHistoryCard'
import { GameColumn } from './GameColumn'
import { DraftBar } from './DraftBar'
import { LeveragePanel } from './LeveragePanel'
import { PoolMatrix } from './PoolMatrix'
import './SeriesBoard.css'

function createInitialSession(draft: SeriesDraft, game: GameDraft): DraftSession {
  // 5.2.8: Default first team is the blue side of this game
  const firstTeamId = game.sides?.blue ?? draft.teamIds[0]
  return { firstTeamId, actions: [], replay: null }
}

export function SeriesBoard({
  draft,
  picks,
  teamMap,
  championMap,
  playerMap,
  selectedGame,
  onSelectGame,
  backtestStats,
  model: propModel,
  initialSession, // for tests only
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
  /** Optional model prop (for testing); when absent, loaded via fetch. */
  model?: PickModel
  /** Optional initial draft session (for tests only). */
  initialSession?: DraftSession
}) {
  const gameNumber = selectedGame ?? (() => {
    if (draft.games.length >= 3) return 3
    if (draft.games.length >= 2) return 2
    return draft.games.length
  })()

  const [revealedGames, setRevealedGames] = useState<Set<number>>(new Set())

  // Draft mode state
  const [draftMode, setDraftMode] = useState(initialSession != null && initialSession.actions.length > 0)

  // Get the game for this game number
  const currentGame = draft.games.find(g => g.gameNumber === gameNumber)

  // Draft session via useReducer
  const [session, dispatch] = useReducer(
    (s: DraftSession, e: DraftEvent) => draftReducer(s, e, draftContext),
    initialSession ?? createInitialSession(draft, currentGame ?? draft.games[0]),
  )

  // Build draft context for the reducer
  const draftContext = useMemo(() => {
    const burned = new Set<string>()
    for (const g of draft.games) {
      if (g.gameNumber >= gameNumber) break
      for (const p of g.picks) burned.add(p.championId)
    }
    // Team players from the game's picks
    const teamPlayers = new Map<string, Set<string>>()
    for (const teamId of draft.teamIds) {
      teamPlayers.set(teamId, new Set<string>())
    }
    if (currentGame) {
      for (const pick of currentGame.picks) {
        teamPlayers.get(pick.teamId)?.add(pick.playerId)
      }
    }
    return { teamIds: draft.teamIds, burned, teamPlayers }
  }, [draft, gameNumber, currentGame])

  // Get the real game's draft actions for replay
  const realGameActions = useMemo(() => {
    if (!currentGame || !currentGame.actions.length) return []
    const result: DraftActionInput[] = []
    for (const action of currentGame.actions) {
      const pick = currentGame.picks.find(p => p.teamId === action.teamId && p.championId === action.championId)
      result.push({
        type: action.type,
        teamId: action.teamId,
        championId: action.championId,
        playerId: pick?.playerId,
      })
    }
    return result
  }, [currentGame])

  // Handle draft actions via reducer
  const handleBan = (championId: string) => {
    dispatch({ type: 'ban', championId })
  }

  // 5.2.1: Pass playerId, not playerName
  const handlePick = (playerId: string, championId: string) => {
    dispatch({ type: 'pick', playerId, championId })
  }

  const handleUndo = () => {
    dispatch({ type: 'undo' })
  }

  const handleReset = () => {
    dispatch({ type: 'reset' })
  }

  const handleFirstTeamChange = (teamId: string) => {
    dispatch({ type: 'setFirstTeam', teamId })
  }

  // Replay handlers
  const handleStartReplay = () => {
    // 5.2.7: Take first team from the real draft
    const firstTeam = firstTeamOfGame(realGameActions)
    if (firstTeam) {
      dispatch({ type: 'setFirstTeam', teamId: firstTeam })
    }
    dispatch({ type: 'startReplay', actions: realGameActions })
  }

  const handleReplayNext = () => {
    dispatch({ type: 'replayNext' })
  }

  // Load model (shared with PoolMatrix and LeveragePanel)
  const [loadedModel, setLoadedModel] = useState<PickModel | undefined>()
  const model = propModel ?? loadedModel
  useEffect(() => {
    if (propModel) return // model provided as prop, skip fetch
    fetch(`${import.meta.env.BASE_URL}data/model.json`).then(async (r) => {
      if (r.ok) setLoadedModel(await r.json())
    }).catch(() => {})
  }, [propModel])

  // Compute gamePlan once (memoised on series, game number, and model)
  const plan = useMemo(() => {
    if (!model) return undefined
    const playerRole = new Map<string, Role | null>()
    for (const [id, p] of playerMap) {
      playerRole.set(id, p.role)
    }
    return computeGamePlan(draft, gameNumber, picks, model, playerRole)
  }, [draft, gameNumber, picks, model, playerMap])

  // 5.1: Use liveGamePlan in draft mode for conditioned likelihoods and leverage
  const livePlan = useMemo(() => {
    if (!draftMode || !plan || !model) return plan
    const playerRole = new Map<string, Role | null>()
    for (const [id, p] of playerMap) {
      playerRole.set(id, p.role)
    }
    return liveGamePlan(plan, session, picks, model, playerRole, draft)
  }, [draftMode, plan, session, picks, model, playerMap, draft])

  const usedPlan = livePlan ?? plan

  // Current draft slot info for PoolMatrix
  const currentDraftSlot = useMemo(() => {
    if (!draftMode) return null
    const slot = DRAFT_ORDER[session.actions.length]
    if (!slot) return null
    const side = slot[0] as '1' | '2'
    const type = slot[2] as 'b' | 'p'
    const teamId = actingTeam(session, draft.teamIds)
    return { slot, side, type, teamId: teamId ?? '' }
  }, [draftMode, session, draft.teamIds])

  // Derive unavailable and picked players for draft mode
  const draftConditioned = useMemo(() => {
    if (!draftMode || !plan) return null
    const unavailable = new Set(plan.burned)
    const pickedPlayers = new Set<string>()
    for (const a of session.actions) {
      unavailable.add(a.championId)
      if (a.type === 'pick' && a.playerId) pickedPlayers.add(a.playerId)
    }
    return { unavailable, pickedPlayers }
  }, [draftMode, plan, session])

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

      {/* ── Reveal / Draft buttons ─────────────────────────── */}
      {(() => {
        const selectedUpcoming = draft.games.find((g) => g.gameNumber === gameNumber && !revealedGames.has(g.gameNumber))
        if (selectedUpcoming) {
          const isInReplay = session.replay !== null
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
              {!draftMode && (
                <button
                  className="draft-btn-inline"
                  onClick={() => setDraftMode(true)}
                >
                  Draft Game {selectedUpcoming.gameNumber}
                </button>
              )}
              {draftMode && (
                <button
                  className="draft-btn-inline"
                  onClick={() => { setDraftMode(false); dispatch({ type: 'reset' }) }}
                >
                  Exit Draft
                </button>
              )}
              {draftMode && realGameActions.length > 0 && !isInReplay && (
                <button
                  className="draft-btn-inline replay"
                  onClick={handleStartReplay}
                >
                  Replay Draft
                </button>
              )}
              {isInReplay && (
                <button
                  className="draft-btn-inline replay"
                  onClick={handleReplayNext}
                  disabled={session.replay!.remaining.length === 0}
                >
                  {session.replay!.remaining.length > 0 ? 'Next action' : 'Replay complete'}
                </button>
              )}
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

      {/* ── Draft bar (when in draft mode) ────────────────── */}
      {draftMode && gameNumber && usedPlan && (
        <DraftBar
          draft={draft}
          plan={usedPlan}
          teamMap={teamMap}
          championMap={championMap}
          state={{ actions: session.actions, turnIndex: session.actions.length, firstTeamId: session.firstTeamId }}
          onBan={handleBan}
          onUndo={handleUndo}
          onReset={handleReset}
          onFirstTeamChange={handleFirstTeamChange}
          isInReplay={session.replay !== null}
        />
      )}

      {/* ── Pool matrix (first, within 300px) ─────────────── */}
      {gameNumber && usedPlan && (
        <PoolMatrix
          plan={usedPlan}
          draft={draft}
          teamMap={teamMap}
          championMap={championMap}
          gameNumber={gameNumber}
          revealedGame={revealedGames.has(gameNumber) ? draft.games.find((g) => g.gameNumber === gameNumber) : undefined}
          draftMode={draftMode}
          draftConditioned={draftConditioned}
          currentDraftSlot={currentDraftSlot}
          onPick={handlePick}
        />
      )}

      {/* ── Leverage panel (after matrix) ──────────────────── */}
      {gameNumber && usedPlan && (
        <LeveragePanel
          plan={usedPlan}
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
