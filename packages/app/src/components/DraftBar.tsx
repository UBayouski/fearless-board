import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
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
  const [banSearchIndex, setBanSearchIndex] = useState(-1)

  const filteredBans = (() => {
    if (!banSearch) return null
    const query = banSearch.toLowerCase()
    const unavailable = new Set(actions.map(a => a.championId))
    return Array.from(championMap.values())
      .filter(c => c.name.toLowerCase().includes(query) && !unavailable.has(c.id))
      .slice(0, 5)
  })()

  // 2.8: Keyboard navigation for ban search
  const handleBanSearchKeyDown = (e: KeyboardEvent) => {
    if (!filteredBans || filteredBans.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setBanSearchIndex(i => Math.min(i + 1, filteredBans.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setBanSearchIndex(i => Math.max(i - 1, 0))
    } else if (e.key === 'Enter' && banSearchIndex >= 0) {
      e.preventDefault()
      onBan(filteredBans[banSearchIndex].id)
      setBanSearch('')
      setBanSearchIndex(-1)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      setBanSearch('')
      setBanSearchIndex(-1)
    }
  }

  // 2.3: Turn line text
  const turnLineText = (() => {
    if (isComplete || !currentSlot || !currentSide) return null
    const teamId = sideToTeam.get(currentSide)
    const team = teamId ? teamMap.get(teamId) : null
    const teamName = team?.name ?? teamId
    if (currentType === 'b') return `${teamName} to ban`
    return `${teamName} to pick: click a champion in their column`
  })()

  // The matrix header sticks below this bar, so publish the bar's height for the stylesheet.
  const barRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const bar = barRef.current
    if (!bar || typeof ResizeObserver === 'undefined') return
    const root = document.documentElement
    const publish = () => root.style.setProperty('--draft-bar-h', `${bar.offsetHeight}px`)
    const observer = new ResizeObserver(publish)
    observer.observe(bar)
    publish()
    return () => {
      observer.disconnect()
      root.style.removeProperty('--draft-bar-h')
    }
  }, [])

  return (
    <div className="draft-bar" ref={barRef}>
      {/* One line: whose turn, ban search, undo and reset, first team */}
      <div className="draft-bar-header">
        <div className="draft-turn-line">
          {isInReplay && <span className="draft-label">Replay of the real draft · </span>}
          {isComplete ? <span className="draft-complete">Draft complete</span> : turnLineText}
        </div>
        {currentType === 'b' && !isComplete && !isInReplay && (
          <div className="draft-ban-entry">
            <input
              type="text"
              className="draft-search"
              placeholder="Search champion to ban..."
              aria-label="Search champion to ban"
              value={banSearch}
              onChange={(e) => { setBanSearch(e.target.value); setBanSearchIndex(-1) }}
              onKeyDown={handleBanSearchKeyDown}
            />
            {filteredBans && filteredBans.length > 0 && (
              <div className="draft-search-results">
                {filteredBans.map((champ, idx) => (
                  <button
                    key={champ.id}
                    type="button"
                    className={`draft-search-result ${idx === banSearchIndex ? 'focused' : ''}`}
                    onClick={() => { onBan(champ.id); setBanSearch(''); setBanSearchIndex(-1) }}
                    onMouseEnter={() => setBanSearchIndex(idx)}
                  >
                    {champ.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        <div className="draft-controls">
          <button type="button" className="draft-btn" onClick={onUndo} disabled={actions.length === 0 || !!isInReplay}>
            Undo
          </button>
          <button type="button" className="draft-btn" onClick={onReset} disabled={actions.length === 0}>
            Reset
          </button>
        </div>
        <div className="draft-first-team">
          <span className="draft-label">First team:</span>
          <div className="draft-first-team-btns">
            {draft.teamIds.map((teamId) => {
              const isSelected = teamId === firstTeamId
              return (
                <button
                  key={teamId}
                  type="button"
                  className={`draft-first-team-btn ${isSelected ? 'selected' : ''}`}
                  aria-pressed={isSelected}
                  onClick={() => onFirstTeamChange(teamId)}
                  disabled={actions.length > 0}
                >
                  {teamMap.get(teamId)?.name ?? teamId}
                </button>
              )
            })}
          </div>
        </div>
      </div>

      {/* Phase labels, then one slot row per team, grouped by phase so the columns line up */}
      <div className="draft-team-row draft-phase-labels" aria-hidden="true">
        <span className="draft-team-row-label" />
        <div className="draft-team-slots">
          {PHASES.map((phase, k) => (
            <span key={k} className={`draft-phase draft-phase-${phase.to - phase.from}`}>{phase.label}</span>
          ))}
        </div>
      </div>
      {draft.teamIds.map((teamId) => {
        const team = teamMap.get(teamId)
        const teamSlots = DRAFT_ORDER.map((slot, i) => ({ slot, index: i }))
          .filter(({ slot }) => sideToTeam.get(slot[0] as '1' | '2') === teamId)
        const sideColor = plan.game.sides?.blue === teamId ? 'blue' : 'red'
        return (
          <div key={teamId} className="draft-team-row">
            <span className="draft-team-row-label">{team?.name ?? teamId}</span>
            <div className="draft-team-slots">
              {PHASES.map((phase, k) => (
                <div key={k} className="draft-phase">
                  {teamSlots.slice(phase.from, phase.to).map(({ slot, index: i }) => {
                    const type = slot[2] as 'b' | 'p'
                    const action = i < actions.length ? actions[i] : null
                    const name = action ? championMap.get(action.championId)?.name ?? action.championId : null
                    return (
                      <div
                        key={i}
                        className={`draft-slot draft-slot-${type} ${i === turnIndex ? 'draft-slot-current' : ''} ${action ? 'draft-slot-filled' : ''} draft-slot-${sideColor}`}
                        title={`${team?.name ?? teamId} ${type === 'b' ? 'ban' : 'pick'}${name ? `: ${name}` : ''}`}
                      >
                        {name
                          ? <span className="draft-slot-content">{name}</span>
                          : <span className="draft-slot-placeholder">{type === 'b' ? 'ban' : 'pick'}</span>}
                      </div>
                    )
                  })}
                </div>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// Each team has ten slots: three bans, three picks, two bans, two picks.
const PHASES = [
  { label: 'Bans', from: 0, to: 3 },
  { label: 'Picks', from: 3, to: 6 },
  { label: 'Bans', from: 6, to: 8 },
  { label: 'Picks', from: 8, to: 10 },
]
