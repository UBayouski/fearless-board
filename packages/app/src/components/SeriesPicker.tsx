import { useMemo, useState } from 'react'
import type { SeriesIndexEntry, TeamRef } from '@fearless-board/shared'
import './SeriesPicker.css'

export function SeriesPicker({
  index,
  featuredIds,
  teamMap,
  selectedId,
  onSelect,
}: {
  index: SeriesIndexEntry[]
  /** Series with enough player history for the forecasts and a written note; shown first and marked. */
  featuredIds: Set<string>
  teamMap: Map<string, TeamRef>
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  const [filter, setFilter] = useState('')
  // Featured first: all series only when asked for, or when the selected series is not featured
  const [showAll, setShowAll] = useState(() => selectedId !== null && !featuredIds.has(selectedId))
  const allFeatured = index.every((e) => featuredIds.has(e.seriesId))
  const [teamFilter, setTeamFilter] = useState('')

  const teamIds = useMemo(() => {
    const ids = new Set<string>()
    for (const e of index) {
      ids.add(e.teamIds[0])
      ids.add(e.teamIds[1])
    }
    return [...ids].sort()
  }, [index])

  const eventSet = useMemo(() => {
    const events = new Set<string>()
    for (const e of index) events.add(e.event)
    return [...events].sort()
  }, [index])

  const [eventFilter, setEventFilter] = useState('')

  const filtered = useMemo(() => {
    return index.filter((e) => {
      if (e.gameCount < 2) return false
      if (!showAll && !featuredIds.has(e.seriesId)) return false
      if (filter) {
        const query = filter.toLowerCase()
        const t0 = teamMap.get(e.teamIds[0])
        const t1 = teamMap.get(e.teamIds[1])
        const teamNames = `${t0?.name ?? ''} ${t1?.name ?? ''}`.toLowerCase()
        if (!teamNames.includes(query) && !e.event.toLowerCase().includes(query)) return false
      }
      if (teamFilter && !e.teamIds.includes(teamFilter)) return false
      return !eventFilter || e.event === eventFilter
    }).sort((a, b) => b.scheduledStart.localeCompare(a.scheduledStart)) // newest first
  }, [index, filter, teamFilter, eventFilter, teamMap, showAll, featuredIds])
  const shownTotal = index.filter((e) => e.gameCount >= 2).length

  return (
    <div className="series-picker">
      {!allFeatured && (
        <div className="picker-scope">
          <div className="seg" role="group" aria-label="Series shown">
            <button type="button" aria-pressed={!showAll} onClick={() => setShowAll(false)}>Featured {featuredIds.size}</button>
            <button type="button" aria-pressed={showAll} onClick={() => setShowAll(true)}>All {shownTotal}</button>
          </div>
          <p>Featured: four or more games, every player with 20 or more earlier series, and a written note before each game. All: every series of two or more games; single games are left out, since nothing carries over.</p>
        </div>
      )}
      <div className="picker-controls">
        <input
          type="text"
          aria-label="Search teams or events"
          placeholder="Search teams or events…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <select aria-label="Team" value={teamFilter} onChange={(e) => setTeamFilter(e.target.value)}>
          <option value="">All teams</option>
          {teamIds.map((tid) => {
            const t = teamMap.get(tid)
            return <option key={tid} value={tid}>{t?.name ?? tid}</option>
          })}
        </select>
        <select aria-label="Event" value={eventFilter} onChange={(e) => setEventFilter(e.target.value)}>
          <option value="">All events</option>
          {eventSet.map((ev) => <option key={ev} value={ev}>{ev}</option>)}
        </select>
      </div>
      <ul className="series-list">
        {filtered.map((e) => {
          const t0 = teamMap.get(e.teamIds[0])
          const t1 = teamMap.get(e.teamIds[1])
          const label = `${t0?.name ?? e.teamIds[0]} vs ${t1?.name ?? e.teamIds[1]}`
          return (
            <li key={e.seriesId}>
              <button
                type="button"
                className="series-option"
                aria-current={selectedId === e.seriesId ? 'true' : undefined}
                onClick={() => onSelect(e.seriesId)}
              >
                <span className="series-teams">
                  {label}
                  {showAll && !allFeatured && featuredIds.has(e.seriesId) && <span className="series-featured">Featured</span>}
                </span>
                <span className="series-meta">
                  {e.event} · {e.stage} · {e.gameCount} game{e.gameCount > 1 ? 's' : ''} · {new Date(e.scheduledStart).toLocaleDateString()}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
