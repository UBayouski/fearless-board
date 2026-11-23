import { useState } from 'react'
import type { ChampionRef, DraftActionInput, GamePlan, SeriesDraft, TeamRef } from '@fearless-board/shared'
import { DRAFT_ORDER } from '@fearless-board/shared'
import './DraftBar.css'

export interface DraftBarState {
  actions: DraftActionInput[]
  turnIndex: number
  firstTeamId: string // the team that acts first (not necessarily blue)
}

export function DraftBar({
  draft,
  plan,
  teamMap,
  championMap,
  state,
  onBan,
  onUndo,
  onReset,
  onFirstTeamChange,
  isInReplay,
}: {
  draft: SeriesDraft
  plan: GamePlan
  teamMap: Map<string, TeamRef>
  championMap: Map<string, ChampionRef>
  state: DraftBarState
  onBan: (championId: string) => void
  onUndo: () => void
  onReset: () => void
  onFirstTeamChange: (teamId: string) => void
  isInReplay?: boolean
}) {
  const { actions, turnIndex, firstTeamId } = state
  const secondTeamId = draft.teamIds.find(id => id !== firstTeamId) ?? draft.teamIds[1]

  // Map side back to team ID
  const sideToTeam = new Map<'1' | '2', string>([
    ['1', firstTeamId],
    ['2', secondTeamId],
  ])

  // Determine which team's turn it is
  const currentSlot = turnIndex < DRAFT_ORDER.length ? DRAFT_ORDER[turnIndex] : null
  const currentSide = currentSlot ? currentSlot[0] as '1' | '2' : null
  const currentType = currentSlot ? currentSlot[2] as 'b' | 'p' : null
  const isComplete = turnIndex >= DRAFT_ORDER.length

  // Ban search state
  const [banSearch, setBanSearch] = useState('')

  const filteredBans = (() => {
    if (!banSearch) return null
    const query = banSearch.toLowerCase()
    const unavailable = new Set(actions.map(a => a.championId))
    return Array.from(championMap.values())
      .filter(c => c.name.toLowerCase().includes(query) && !unavailable.has(c.id))
      .slice(0, 5)
  })()

  return (
    <div className="draft-bar">
      {/* First team selector */}
      <div className="draft-first-team">
        <span className="draft-label">First team:</span>
        <select
          value={firstTeamId}
          onChange={(e) => onFirstTeamChange(e.target.value)}
          disabled={actions.length > 0}
          className="draft-first-team-select"
        >
          {draft.teamIds.map((teamId) => {
            const team = teamMap.get(teamId)
            return (
              <option key={teamId} value={teamId}>
                {team?.name ?? teamId}
              </option>
            )
          })}
        </select>
      </div>

      {/* 20-slot turn sequence */}
      <div className="draft-slots">
        {DRAFT_ORDER.map((slot, i) => {
          const side = slot[0] as '1' | '2'
          const type = slot[2] as 'b' | 'p'
          const isCurrent = i === turnIndex
          const action = i < actions.length ? actions[i] : null
          const teamId = sideToTeam.get(side)
          const team = teamId ? teamMap.get(teamId) : null
          const isBlueSide = plan.game.sides?.blue === teamId
          const sideColor = isBlueSide ? 'blue' : 'red'

          return (
            <div
              key={i}
              className={`draft-slot draft-slot-${type} ${isCurrent ? 'draft-slot-current' : ''} ${action ? 'draft-slot-filled' : ''} draft-slot-${sideColor}`}
              title={`${team?.name ?? teamId} ${type === 'b' ? 'ban' : 'pick'}`}
            >
              {action ? (
                <span className="draft-slot-content">
                  {championMap.get(action.championId)?.name ?? action.championId}
                </span>
              ) : (
                <span className="draft-slot-placeholder">
                  {type === 'b' ? 'B' : 'P'}
                </span>
              )}
            </div>
          )
        })}
      </div>

      {/* Controls */}
      <div className="draft-controls">
        {isInReplay && <span className="draft-label">Replay of the real draft</span>}
        <button className="draft-btn" onClick={onUndo} disabled={actions.length === 0 || !!isInReplay}>
          Undo
        </button>
        <button className="draft-btn" onClick={onReset} disabled={actions.length === 0}>
          Reset
        </button>
        {isComplete && <span className="draft-complete">Draft complete</span>}
      </div>

      {/* Ban entry */}
      {currentType === 'b' && !isComplete && !isInReplay && (
        <div className="draft-ban-entry">
          <input
            type="text"
            className="draft-search"
            placeholder="Search champion to ban..."
            value={banSearch}
            onChange={(e) => setBanSearch(e.target.value)}
          />
          {filteredBans && filteredBans.length > 0 && (
            <div className="draft-search-results">
              {filteredBans.map((champ) => (
                <button
                  key={champ.id}
                  className="draft-search-result"
                  onClick={() => { onBan(champ.id); setBanSearch('') }}
                >
                  {champ.name}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Pick entry - shown in pool matrix cells, not here */}
      {currentType === 'p' && !isComplete && (
        <div className="draft-pick-entry">
          <span className="draft-pick-label">
            {(() => {
              if (!currentSide) return 'Pick turn'
              const teamId = sideToTeam.get(currentSide)
              const team = teamId ? teamMap.get(teamId) : null
              return `${team?.name ?? teamId} to pick — click a champion in the pool matrix`
            })()}
          </span>
        </div>
      )}
    </div>
  )
}
