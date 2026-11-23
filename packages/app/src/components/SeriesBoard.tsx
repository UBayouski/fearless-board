import { useEffect, useMemo, useReducer, useState } from 'react'
import type { ChampionRef, DraftActionInput, GameDraft, GamePlan, PickModel, PickRow, PlayerRef, Role, SeriesDraft, TeamRef, WrittenNote } from '@fearless-board/shared'
import { gamePlan as computeGamePlan, DRAFT_ORDER, conditionLikelihoods } from '@fearless-board/shared'
import { draftReducer, actingTeam, liveGamePlan, firstTeamOfGame, type DraftSession, type DraftEvent, type DraftContext } from '@fearless-board/shared'
import { BurnedStrip } from './BurnedStrip'
import { CompactHistoryCard } from './CompactHistoryCard'
import { GameColumn } from './GameColumn'
import { DraftBar } from './DraftBar'
import { LeveragePanel } from './LeveragePanel'
import { OutlookPanel } from './OutlookPanel'
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
  initialCostChampion, // for tests only
  notesData,
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
  /** Optional champion preselected for "What does a pick cost?" (for tests only). */
  initialCostChampion?: string
  /** Optional notes data for this series. */
  notesData?: { model: string; games: Record<string, Record<string, WrittenNote>> }
}) {
  const gameNumber = selectedGame ?? (() => {
    if (draft.games.length >= 3) return 3
    if (draft.games.length >= 2) return 2
    return draft.games.length
  })()

  const [revealedGames, setRevealedGames] = useState<Set<number>>(new Set())

  // Draft mode state
  const [draftMode, setDraftMode] = useState(initialSession != null && initialSession.actions.length > 0)

  // 6.2.5: Replay confirmation — ask once before starting
  const [replayConfirm, setReplayConfirm] = useState(false)

  // Champion chosen for "What does a pick cost?" (set from the outlook search or a denial row)
  const [costChampion, setCostChampion] = useState<string | null>(initialCostChampion ?? null)

  // Get the game for this game number
  const currentGame = draft.games.find(g => g.gameNumber === gameNumber)

  // Build draft context for the reducer (6.1.1: from previous game's picks, not currentGame.picks which is future)
  // (6.1.2: declared before useReducer to fix lint warnings)
  const draftContext: DraftContext = useMemo(() => {
    const burned = new Set<string>()
    for (const g of draft.games) {
      if (g.gameNumber >= gameNumber) break
      for (const p of g.picks) burned.add(p.championId)
    }
    // Team players from the previous game's picks (lineup before), not currentGame.picks (future)
    const teamPlayers = new Map<string, Set<string>>()
    for (const teamId of draft.teamIds) {
      teamPlayers.set(teamId, new Set<string>())
    }
    // Same lineup rule as the plan: the game before, or game 1 itself for game 1
    const prevGame = draft.games.filter(g => g.gameNumber < gameNumber).pop() ?? draft.games.find(g => g.gameNumber === gameNumber)
    if (prevGame) {
      for (const pick of prevGame.picks) {
        teamPlayers.get(pick.teamId)?.add(pick.playerId)
      }
    }
    return { teamIds: draft.teamIds, burned, teamPlayers }
  }, [draft, gameNumber])

  // Draft session via useReducer
  const [session, dispatch] = useReducer(
    (s: DraftSession, e: DraftEvent) => draftReducer(s, e, draftContext),
    initialSession ?? createInitialSession(draft, currentGame ?? draft.games[0]),
  )

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
    // 6.2.5: Ask for confirmation once before starting
    if (!replayConfirm) {
      setReplayConfirm(true)
      return
    }
    // 5.2.7: Take first team from the real draft
    const firstTeam = firstTeamOfGame(realGameActions)
    if (firstTeam) {
      dispatch({ type: 'setFirstTeam', teamId: firstTeam })
    }
    dispatch({ type: 'startReplay', actions: realGameActions })
    setReplayConfirm(false)
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
  // (6.1.4: liveGamePlan takes only plan and session)
  const livePlan = useMemo(() => {
    if (!draftMode || !plan) return plan
    return liveGamePlan(plan, session)
  }, [draftMode, plan, session])

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
    const pickedChampions = new Map<string, string>() // playerId -> championId (6.2.4)
    for (const a of session.actions) {
      unavailable.add(a.championId)
      if (a.type === 'pick' && a.playerId) {
        pickedPlayers.add(a.playerId)
        pickedChampions.set(a.playerId, a.championId)
      }
    }
    return { unavailable, pickedPlayers, pickedChampions }
  }, [draftMode, plan, session])

  // 6.2.5: Replay pick ranks — for each picked player, compute the rank in the list before the pick
  const replayPickRanks = useMemo(() => {
    if (!plan || !session.replay) return new Map<string, number>()
    const ranks = new Map<string, number>()
    // For each pick action in the session, find the player's likelihood rank at that point
    const pickActions = session.actions.filter(a => a.type === 'pick')
    for (const action of pickActions) {
      if (!action.playerId) continue
      // Build the unavailable set before this action
      const idx = session.actions.indexOf(action)
      const unavailableBefore = new Set(plan.burned)
      for (let i = 0; i < idx; i++) {
        unavailableBefore.add(session.actions[i].championId)
      }
      // Find the player's likelihoods and rank the champion
      for (const [, roleMap] of plan.players) {
        for (const [, gp] of roleMap) {
          if (gp.playerId === action.playerId) {
            // Condition the likelihoods on unavailable before this action
            const cond = conditionLikelihoods(gp.likelihoods, unavailableBefore, gp.playerId, new Set<string>())
            const rank = cond.findIndex(l => l.championId === action.championId) + 1
            ranks.set(action.playerId, rank > 0 && rank <= 10 ? rank : 0) // 0 = outside top 10
            break
          }
        }
      }
    }
    return ranks
  }, [plan, session])

  // Players who had the champion removed by the last action in their top 10 just before it
  const removedForPlayers = useMemo(() => {
    const result = new Set<string>()
    if (!draftMode || !plan || session.actions.length === 0) return result
    const last = session.actions[session.actions.length - 1]
    const before = liveGamePlan(plan, { ...session, actions: session.actions.slice(0, -1) })
    for (const [, roleMap] of before.players) {
      for (const [, gp] of roleMap) {
        if (gp.likelihoods.slice(0, 10).some(l => l.championId === last.championId)) result.add(gp.playerId)
      }
    }
    return result
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
                <span className="draft-replay-group">
                  <button
                    className="draft-btn-inline replay"
                    onClick={handleStartReplay}
                  >
                    {replayConfirm ? 'Replay Draft — this shows the actual picks' : 'Replay Draft'}
                  </button>
                  {replayConfirm && (
                    <button
                      className="draft-btn-inline"
                      onClick={() => setReplayConfirm(false)}
                    >
                      Cancel
                    </button>
                  )}
                </span>
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

      {/* ── Series outlook panel ──────────────────────────── */}
      {gameNumber && usedPlan && (
        <OutlookPanel
          plan={usedPlan}
          draft={draft}
          teamMap={teamMap}
          championMap={championMap}
          selectedChampion={costChampion}
          onSelectChampion={setCostChampion}
          unavailable={draftConditioned?.unavailable ?? usedPlan.burned}
          notesData={notesData}
          gameNumber={gameNumber}
          draftMode={draftMode && session.actions.length > 0}
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
          lastRemoved={draftMode && 'lastRemoved' in usedPlan ? (usedPlan as GamePlan & { lastRemoved: { championId: string; type: 'ban' | 'pick' } | null }).lastRemoved : undefined}
          removedForPlayers={removedForPlayers}
          replayPickRanks={session.replay ? replayPickRanks : undefined}
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
          onBan={draftMode && currentDraftSlot?.type === 'b' ? handleBan : undefined}
          actingTeamId={draftMode && currentDraftSlot?.type === 'b' ? currentDraftSlot.teamId : undefined}
          onSelectChampion={setCostChampion}
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
