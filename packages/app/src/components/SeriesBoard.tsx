import { useEffect, useMemo, useReducer, useRef, useState } from 'react'
import type { DraftActionInput, GameDraft, GamePlanPlayer, PlayerRef, SeriesDraft, WrittenNote } from '@fearless-board/shared'
import { DRAFT_ORDER, conditionLikelihoods, seriesOutlook } from '@fearless-board/shared'
import { draftReducer, actingTeam, liveGamePlan, firstTeamOfGame, type DraftSession, type DraftEvent, type DraftContext } from '@fearless-board/shared'
import type { PlanFor } from '../data'
import { PLANNING_PICKS, useUi } from '../ui'
import { BurnTrack, Scoreboard, type BoardView } from './Header'
import { Board, DraftLane, PlanningLane, ResultLane, TableLane, type RevealedPick, type Row } from './Lanes'
import { Rail } from './Rail'
import { DraftStrip } from './DraftStrip'
import './board.css'

function createInitialSession(draft: SeriesDraft, game: GameDraft): DraftSession {
  // The blue side of the game acts first unless the user says otherwise
  const firstTeamId = game.sides?.blue ?? draft.teamIds[0]
  return { firstTeamId, actions: [], replay: null }
}

/**
 * One game of a series in one of three views: planning (the forecast), the practice draft, and the reveal
 * (the real draft against the forecast). The component is mounted once per series and game.
 */
export function SeriesBoard({
  draft,
  planFor,
  playerMap,
  selectedGame,
  onSelectGame,
  notesData,
  initialSession,
  initialCostChampion,
  initialRevealed,
}: {
  draft: SeriesDraft
  planFor: PlanFor
  playerMap: Map<string, PlayerRef>
  selectedGame: number | null
  onSelectGame: (gameNumber: number) => void
  /** Written pre-game notes of this series, by game number and team. */
  notesData?: { model: string; games: Record<string, Record<string, WrittenNote>> }
  /** A draft session to start in (for tests only). */
  initialSession?: DraftSession
  /** A champion preselected for "What does a pick cost?" (for tests only). */
  initialCostChampion?: string
  /** Start with the game revealed (for tests only). */
  initialRevealed?: boolean
}) {
  const { teamMap } = useUi()
  const gameNumber = selectedGame ?? draft.games.length

  const [perspective, setPerspective] = useState<string | null>(null)
  const [revealed, setRevealed] = useState(initialRevealed ?? false)
  const [draftMode, setDraftMode] = useState(initialSession != null && initialSession.actions.length > 0)
  const [replayConfirm, setReplayConfirm] = useState(false)
  const [costChampion, setCostChampion] = useState<string | null>(initialCostChampion ?? null)
  const [activeRole, setActiveRole] = useState<Row>('top')
  const [compareOpen, setCompareOpen] = useState(false)

  const currentGame = draft.games.find(g => g.gameNumber === gameNumber)

  // What the draft rules need: the champions burned so far and each team's lineup. The lineup is the one
  // of the game before (or of game 1 itself), never the one of the game being drafted.
  const draftContext: DraftContext = useMemo(() => {
    const burned = new Set<string>()
    for (const g of draft.games) {
      if (g.gameNumber >= gameNumber) break
      for (const p of g.picks) burned.add(p.championId)
    }
    const teamPlayers = new Map<string, Set<string>>()
    for (const teamId of draft.teamIds) teamPlayers.set(teamId, new Set<string>())
    const lineupGame = draft.games.filter(g => g.gameNumber < gameNumber).pop() ?? currentGame
    for (const pick of lineupGame?.picks ?? []) teamPlayers.get(pick.teamId)?.add(pick.playerId)
    return { teamIds: draft.teamIds, burned, teamPlayers }
  }, [draft, gameNumber, currentGame])

  const [session, dispatch] = useReducer(
    (s: DraftSession, e: DraftEvent) => draftReducer(s, e, draftContext),
    initialSession ?? createInitialSession(draft, currentGame ?? draft.games[0]),
  )

  // The real draft of this game, for the replay
  const realGameActions = useMemo(() => {
    const result: DraftActionInput[] = []
    for (const action of currentGame?.actions ?? []) {
      const pick = currentGame?.picks.find(p => p.teamId === action.teamId && p.championId === action.championId)
      result.push({ type: action.type, teamId: action.teamId, championId: action.championId, playerId: pick?.playerId })
    }
    return result
  }, [currentGame])

  const handleReplay = () => {
    // Ask once: a replay shows the real picks of this game
    if (!replayConfirm) {
      setReplayConfirm(true)
      return
    }
    const firstTeam = firstTeamOfGame(realGameActions)
    if (firstTeam) dispatch({ type: 'setFirstTeam', teamId: firstTeam })
    dispatch({ type: 'startReplay', actions: realGameActions })
    setReplayConfirm(false)
  }

  const plan = planFor(gameNumber)

  // In a practice draft the lists and the ban advice are recomputed after every action
  const usedPlan = useMemo(() => (draftMode && plan ? liveGamePlan(plan, session) : plan), [draftMode, plan, session])
  const lastRemoved = draftMode && usedPlan && 'lastRemoved' in usedPlan
    ? (usedPlan as ReturnType<typeof liveGamePlan>).lastRemoved ?? undefined
    : undefined

  // The reveal always compares with the forecast from before the draft
  const reveal = useMemo(() => {
    if (!revealed || !currentGame || !plan) return undefined
    const lineup: GamePlanPlayer[] = [
      ...plan.players.flatMap(([, roles]) => Array.from(roles.values())),
      ...plan.unknownRolePlayers.flatMap(([, group]) => group),
    ]
    const byPlayer = new Map<string, RevealedPick>()
    let inPool = 0
    let forecastCount = 0
    let topFive = 0
    for (const pick of currentGame.picks) {
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
    return { byPlayer, inPool, total: byPlayer.size, forecastCount, topFive }
  }, [revealed, currentGame, plan])

  const currentSlot = useMemo(() => {
    if (!draftMode) return null
    const slot = DRAFT_ORDER[session.actions.length]
    if (!slot) return null
    return { type: slot[2] === 'b' ? 'ban' as const : 'pick' as const, teamId: actingTeam(session, draft.teamIds) ?? '' }
  }, [draftMode, session, draft.teamIds])

  // What the practice draft has taken so far
  const taken = useMemo(() => {
    if (!draftMode || !plan) return null
    const unavailable = new Set(plan.burned)
    const pickedChampions = new Map<string, string>() // playerId -> championId
    for (const a of session.actions) {
      unavailable.add(a.championId)
      if (a.type === 'pick' && a.playerId) pickedChampions.set(a.playerId, a.championId)
    }
    return { unavailable, pickedChampions }
  }, [draftMode, plan, session])

  // In a replay: the rank each pick had in the player's list just before it was made (0 = outside the top ten)
  const replayPickRanks = useMemo(() => {
    const ranks = new Map<string, number>()
    if (!plan || !session.replay) return ranks
    session.actions.forEach((action, idx) => {
      if (action.type !== 'pick' || !action.playerId) return
      const unavailableBefore = new Set(plan.burned)
      for (let i = 0; i < idx; i++) unavailableBefore.add(session.actions[i].championId)
      for (const [, roleMap] of plan.players) {
        for (const [, gp] of roleMap) {
          if (gp.playerId !== action.playerId) continue
          const cond = conditionLikelihoods(gp.likelihoods, unavailableBefore, gp.playerId, new Set<string>())
          const rank = cond.findIndex(l => l.championId === action.championId) + 1
          ranks.set(action.playerId, rank > 0 && rank <= 10 ? rank : 0)
        }
      }
    })
    return ranks
  }, [plan, session])

  // Players who had the champion of the last action in their top ten just before it
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

  // Share of each player's usual picks that is burned, from the forecast before the draft
  const burnedShares = useMemo(() => {
    const shares = new Map<string, number>()
    if (!plan) return shares
    for (const team of seriesOutlook(plan).teams) for (const p of team.players) shares.set(p.playerId, p.burnedShare)
    return shares
  }, [plan])

  const view: BoardView = revealed ? 'reveal' : draftMode ? 'draft' : 'planning'

  // When the view changes, the keyboard focus moves to its heading
  const heading = useRef<HTMLHeadingElement>(null)
  const firstRender = useRef(true)
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false
      return
    }
    heading.current?.focus()
  }, [view])

  if (!plan || !usedPlan || !currentGame) {
    return <p className="lineup-note">Loading the forecast…</p>
  }

  const name = (teamId: string) => teamMap.get(teamId)?.name ?? teamId
  const planningTeam = perspective ?? session.firstTeamId
  const banTurn = view === 'draft' && currentSlot?.type === 'ban' && session.replay === null
  const pickTurnTeam = view === 'draft' && currentSlot?.type === 'pick' && session.replay === null ? currentSlot.teamId : null
  const railTeam = banTurn && currentSlot ? currentSlot.teamId : planningTeam
  const unavailable = taken?.unavailable ?? plan.burned
  const nextGame = draft.games.find(g => g.gameNumber === gameNumber + 1)
  const changedLineups = draft.teamIds.filter(teamId => plan.lineupChanged.get(teamId))
  const share = (player: GamePlanPlayer) => burnedShares.get(player.playerId) ?? 0

  // A pick or a ban removes the control that was used, so the focus goes to Undo instead of the page
  const focusUndo = () => requestAnimationFrame(() => document.getElementById('draft-undo')?.focus())
  const exitDraft = () => {
    setDraftMode(false)
    dispatch({ type: 'reset' })
    setReplayConfirm(false)
  }
  const revealGame = () => {
    // Revealing ends a practice draft: the reveal compares with the forecast from before it
    if (draftMode) exitDraft()
    setRevealed(true)
  }

  return (
    <div className="series-board">
      <Scoreboard draft={draft} gameNumber={gameNumber} revealed={revealed} />
      <BurnTrack draft={draft} gameNumber={gameNumber} view={view} burnedCount={plan.burned.size} playerMap={playerMap} onSelectGame={onSelectGame} />

      <div className="actions">
        <h2 id="view-title" tabIndex={-1} ref={heading}>
          {view === 'reveal' ? 'The real draft' : view === 'draft' ? 'Practice draft' : 'Player forecasts'}
        </h2>
        {view === 'planning' && (
          <>
            <p className="guide">Five likeliest picks per player. Reveal the real draft to compare.</p>
            <button type="button" className="ghost" onClick={() => setDraftMode(true)}>Practice the draft</button>
            <button type="button" className="primary" onClick={revealGame}>Reveal game {gameNumber}</button>
          </>
        )}
        {view === 'draft' && <p className="guide">Enter bans and picks. The board recomputes after each one.</p>}
        {view === 'reveal' && (
          <>
            <p className="guide">
              The real pick and its rank in the forecast.
              <span className="with-strip"> The five the forecast expected are shown beside it.</span>
            </p>
            <button type="button" className="ghost" onClick={() => setRevealed(false)}>Back to planning</button>
            {nextGame && (
              <button type="button" className="primary" onClick={() => onSelectGame(nextGame.gameNumber)}>
                Next: game {nextGame.gameNumber}
              </button>
            )}
          </>
        )}
      </div>

      {changedLineups.length > 0 && (
        <p className="lineup-note">
          {changedLineups.map(name).join(' and ')} changed lineup during this series. The board shows the players of game{' '}
          {Math.max(1, gameNumber - 1)}.
        </p>
      )}

      {view === 'draft' && (
        <DraftStrip
          draft={draft}
          gameNumber={gameNumber}
          session={session}
          actingTeamId={currentSlot?.teamId ?? null}
          unavailable={unavailable}
          canReplay={realGameActions.length > 0}
          replayConfirm={replayConfirm}
          onBan={championId => dispatch({ type: 'ban', championId })}
          onUndo={() => dispatch({ type: 'undo' })}
          onReset={() => dispatch({ type: 'reset' })}
          onFirstTeam={teamId => dispatch({ type: 'setFirstTeam', teamId })}
          onExit={exitDraft}
          onReveal={revealGame}
          onReplay={handleReplay}
          onReplayCancel={() => setReplayConfirm(false)}
          onReplayNext={() => dispatch({ type: 'replayNext' })}
        />
      )}

      {view === 'reveal' && reveal ? (
        <>
          <div className="counts" aria-label="Result of the forecast">
            <div>
              <strong className="num">{reveal.topFive} of {reveal.forecastCount}</strong>
              <span>forecast hits<small>real picks ranked in the top five</small></span>
            </div>
            <div>
              <strong className="num">{reveal.inPool} of {reveal.total}</strong>
              <span>from available pools<small>real picks the player had played and still had</small></span>
            </div>
          </div>
          <Board
            plan={plan}
            teamIds={draft.teamIds}
            activeRole={activeRole}
            onRole={setActiveRole}
            lane={(player, _teamId, side, index) => {
              const pick = reveal.byPlayer.get(player.playerId)
              return pick ? <ResultLane player={player} side={side} pick={pick} index={index} /> : <div className={`lane ${side}`} />
            }}
          />
          <details className="more" open={compareOpen} onToggle={e => setCompareOpen(e.currentTarget.open)}>
            <summary>Compare with forecasts</summary>
            <div className="inner">
              <Board
                labelSuffix=", compared with forecasts"
                plan={plan}
                teamIds={draft.teamIds}
                activeRole={activeRole}
                onRole={setActiveRole}
                lane={(player, _teamId, side, index) => {
                  const pick = reveal.byPlayer.get(player.playerId)
                  return pick
                    ? <TableLane player={player} side={side} pick={pick} index={index} burnedShare={share(player)} />
                    : <div className={`lane ${side}`} />
                }}
              />
            </div>
          </details>
          <details className="more" open>
            <summary>Bans of game {gameNumber}</summary>
            <div className="inner bans">
              {draft.teamIds.map((teamId) => {
                const bans = currentGame.actions.filter(a => a.type === 'ban' && a.teamId === teamId)
                return (
                  <p key={teamId}>
                    <b>{name(teamId)}</b>{' '}
                    {bans.length > 0 ? bans.map(a => (<BanName key={a.order} id={a.championId} />)) : 'no bans recorded'}
                  </p>
                )
              })}
            </div>
          </details>
        </>
      ) : (
        <div className="layout">
          <Board
            plan={usedPlan}
            teamIds={draft.teamIds}
            activeRole={activeRole}
            onRole={setActiveRole}
            lane={(player, teamId, side) => view === 'draft' ? (
              <DraftLane
                player={player}
                side={side}
                burnedShare={share(player)}
                acting={pickTurnTeam === teamId && !taken?.pickedChampions.has(player.playerId)}
                pickedChampion={taken?.pickedChampions.get(player.playerId)}
                replayRank={session.replay ? replayPickRanks.get(player.playerId) : undefined}
                removed={removedForPlayers.has(player.playerId) ? lastRemoved : undefined}
                unavailable={unavailable}
                onPick={championId => { dispatch({ type: 'pick', playerId: player.playerId, championId }); focusUndo() }}
              />
            ) : (
              <PlanningLane player={player} side={side} burnedShare={share(player)} burnedByGame={plan.burnedByGame} />
            )}
          />
          <Rail
            plan={usedPlan}
            teamIds={draft.teamIds}
            team={railTeam}
            onTeam={setPerspective}
            view={view}
            gameNumber={gameNumber}
            note={notesData?.games[String(gameNumber)]?.[railTeam]}
            noteModel={notesData?.model}
            banTurn={banTurn}
            onBan={championId => { dispatch({ type: 'ban', championId }); focusUndo() }}
            costChampion={costChampion}
            onCostChampion={setCostChampion}
            unavailable={unavailable}
          />
        </div>
      )}
    </div>
  )
}

/** One banned champion in the list under the reveal, followed by a comma unless it is the last. */
function BanName({ id }: { id: string }) {
  const { championMap } = useUi()
  return <span className="ban-name">{championMap.get(id)?.name ?? id}</span>
}
