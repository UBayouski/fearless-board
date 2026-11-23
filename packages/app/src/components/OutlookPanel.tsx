import { useMemo, useState } from 'react'
import type { ChampionRef, GamePlan, SeriesDraft, TeamRef, WrittenNote } from '@fearless-board/shared'
import { seriesOutlook, pickCost, type OutlookPlayer } from '@fearless-board/shared'
import { ChampionSearch } from './PoolMatrixCell'
import './OutlookPanel.css'

const ROLE_ORDER: (string | null)[] = ['top', 'jungle', 'mid', 'bot', 'support', null]

function pct(v: number): string {
  return Math.round(v * 100) + '%'
}

export function OutlookPanel({
  plan,
  draft,
  teamMap,
  championMap,
  selectedChampion: searchChampion,
  onSelectChampion: setSearchChampion,
  unavailable,
  notesData,
  gameNumber,
  draftMode,
}: {
  plan: GamePlan
  draft: SeriesDraft
  teamMap: Map<string, TeamRef>
  championMap: Map<string, ChampionRef>
  /** The champion chosen for "What does a pick cost?" (held by the board, so other panels can set it). */
  selectedChampion: string | null
  onSelectChampion: (championId: string | null) => void
  /** Champions that cannot be picked any more: burned, and banned or picked in the current draft. */
  unavailable: Set<string>
  /** Optional notes data for this series. */
  notesData?: { model: string; games: Record<string, Record<string, WrittenNote>> }
  /** Current game number. */
  gameNumber: number
  /** Whether draft mode is active. */
  draftMode: boolean
}) {
  const outlook = useMemo(() => seriesOutlook(plan), [plan])

  // 3.1: Pre-game note — switch between teams (matrix order)
  const [noteTeamIdx, setNoteTeamIdx] = useState(0)
  const noteForGame = notesData?.games[String(gameNumber)]
  // 3.4: No note, no block — game 1, no notes data, or failed check
  // If the selected team has no note (its check failed), show the other team's
  const shownIdx = noteForGame?.[draft.teamIds[noteTeamIdx]] ? noteTeamIdx : 1 - noteTeamIdx
  const note: WrittenNote | undefined = noteForGame?.[draft.teamIds[shownIdx]]
  const noteModel = notesData?.model
  // 3.3: In draft mode, dim with "written before this draft"
  const noteIsDimmed = draftMode && note

  // Pick cost for selected champion
  const costResult = useMemo(() => {
    if (!searchChampion) return null
    return pickCost(plan, searchChampion)
  }, [plan, searchChampion])

  // Compute team-level stats
  const teamStats = useMemo(() => {
    const result = new Map<string, { meanBurned: number; deepestRole: string; deepestShare: number }>()
    for (const team of outlook.teams) {
      const players = team.players
      if (players.length === 0) continue
      const meanBurned = players.reduce((s, p) => s + p.burnedShare, 0) / players.length
      let deepestRole = ''
      let deepestShare = 0
      for (const p of players) {
        if (p.burnedShare > deepestShare) {
          deepestShare = p.burnedShare
          deepestRole = p.role ?? '?'
        }
      }
      result.set(team.teamId, { meanBurned, deepestRole, deepestShare })
    }
    return result
  }, [outlook])

  return (
    <div className="outlook-panel">
      {/* 3.1-3.4: Pre-game note block — only when a note exists */}
      {note && (
        <div className={`outlook-note ${noteIsDimmed ? 'outlook-note-dimmed' : ''}`}>
          <div className="outlook-note-header">
            <span className="outlook-note-label">Pre-game note</span>
            <div className="outlook-note-switch">
              {draft.teamIds.map((teamId, idx) => {
                const teamName = teamMap.get(teamId)?.name ?? teamId
                const hasNote = !!noteForGame?.[teamId]
                return (
                  <button
                    key={teamId}
                    type="button"
                    className={`outlook-note-team-btn ${idx === shownIdx ? 'selected' : ''} ${!hasNote ? 'disabled' : ''}`}
                    onClick={() => hasNote && setNoteTeamIdx(idx)}
                    disabled={!hasNote}
                  >
                    {teamName}
                  </button>
                )
              })}
            </div>
          </div>
          <div className="outlook-note-headline">{note.headline}</div>
          {note.points.map((point, idx) => (
            <div key={idx} className="outlook-note-point">
              <div className="outlook-note-point-title">{point.title}</div>
              <div className="outlook-note-point-text">{point.text}</div>
            </div>
          ))}
          {/* 3.2: Attribution line */}
          <div className="outlook-note-attribution">
            Written by {noteModel} from the figures on this board. Every champion and percentage in it was checked against them.
          </div>
          {noteIsDimmed && (
            <div className="outlook-note-draft-label">written before this draft</div>
          )}
        </div>
      )}

      <div className="outlook-panel-title">Series outlook</div>
      <div className="outlook-panel-explanation">
        How much of each player's likely picks is already burned, and what the coming game is expected to burn.
      </div>

      {/* Burned share grid */}
      <div className="outlook-grid">
        {draft.teamIds.map((teamId) => {
          const team = outlook.teams.find(t => t.teamId === teamId)
          if (!team) return null
          const teamName = teamMap.get(teamId)?.name ?? teamId
          const stats = teamStats.get(teamId)
          return (
            <div key={teamId} className="outlook-team-column">
              <div className="outlook-team-name">{teamName}</div>
              <div className="outlook-role-rows">
                {ROLE_ORDER.map((role) => {
                  const player = team.players.find(p => p.role === role)
                  if (!player) return null
                  return (
                    <OutlookRow key={player.playerId} player={player} />
                  )
                })}
              </div>
              {/* Team line */}
              {stats && (
                <div className="outlook-team-line">
                  <span className="outlook-team-mean">
                    Mean {pct(stats.meanBurned)} burned
                  </span>
                  <span className="outlook-deepest">
                    · deepest: {stats.deepestRole}, {pct(stats.deepestShare)}
                  </span>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Pick cost section */}
      <div className="outlook-pick-cost">
        <div className="outlook-pick-cost-title">What does a pick cost?</div>
        <div className="outlook-pick-cost-explanation">
          Choosing a champion shows what share it takes from each team's players for the rest of the series.
        </div>
        <div className="outlook-search-row">
          <ChampionSearch
            placeholder="Search champion..."
            unavailable={unavailable}
            championMap={championMap}
            onSelect={(championId) => setSearchChampion(championId)}
          />
          {searchChampion && (
            <button
              type="button"
              className="outlook-clear-btn"
              onClick={() => setSearchChampion(null)}
            >
              Clear
            </button>
          )}
        </div>

        {searchChampion && costResult && (
          <div className="outlook-cost-results">
            <div className="outlook-cost-champion">
              {championMap.get(searchChampion)?.name ?? searchChampion}
              {unavailable.has(searchChampion) ? ' (no longer available)' : ' is gone for the rest of the series once picked. Share of each list it takes:'}
            </div>
            {draft.teamIds.map((teamId) => {
              const teamPlayers = costResult.players.get(teamId)
              const combined = costResult.combined.get(teamId)
              if (!teamPlayers) return null
              const teamName = teamMap.get(teamId)?.name ?? teamId
              // Filter to players with non-trivial probability
              const significant = teamPlayers.filter(p => p.probability >= 0.01)
              return (
                <div key={teamId} className="outlook-cost-team">
                  <span className="outlook-cost-team-name">{teamName}:</span>
                  {significant.length > 0
                    ? significant.map(p => (
                      <span key={p.playerId} className="outlook-cost-player">
                        {p.playerName} {pct(p.probability)}
                      </span>
                    ))
                    : <span className="outlook-cost-none">in nobody's list</span>
                  }
                  <span className="outlook-cost-combined">
                    · combined {pct(combined ?? 0)}
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

function OutlookRow({ player }: { player: OutlookPlayer }) {
  const burnedPct = Math.round(player.burnedShare * 100)
  const expectedPct = Math.round(player.expectedBurn * 100)

  return (
    <div className="outlook-row">
      <span className="outlook-player-name">{player.playerName}</span>
      <div className="outlook-bar-container">
        <div
          className="outlook-bar"
          style={{ width: `${burnedPct}%` }}
        />
      </div>
      <span className="outlook-burned-pct">{burnedPct + '% burned'}</span>
      {player.limitedHistory
        ? <span className="outlook-limited">limited history</span>
        : <span className="outlook-expected">this game: about +{expectedPct}%</span>
      }
    </div>
  )
}
