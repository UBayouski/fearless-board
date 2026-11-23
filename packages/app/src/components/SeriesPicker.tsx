import { useMemo, useState } from 'react'
import type { SeriesIndexEntry, TeamRef } from '@fearless-board/shared'
import './SeriesPicker.css'

export function SeriesPicker({
  index,
  teamMap,
  selectedId,
  onSelect,
}: {
  index: SeriesIndexEntry[]
  teamMap: Map<string, TeamRef>
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  const [filter, setFilter] = useState('')
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
      if (filter) {
        const query = filter.toLowerCase()
        const t0 = teamMap.get(e.teamIds[0])
        const t1 = teamMap.get(e.teamIds[1])
        const teamNames = `${t0?.name ?? ''} ${t1?.name ?? ''}`.toLowerCase()
        if (!teamNames.includes(query) && !e.event.toLowerCase().includes(query)) return false
      }
      if (teamFilter && !e.teamIds.includes(teamFilter)) return false
      return !eventFilter || e.event === eventFilter
    })
  }, [index, filter, teamFilter, eventFilter, teamMap])

  return (
    <div className="series-picker">
      <div className="picker-controls">
        <input
          type="text"
          placeholder="Search teams or events…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <select value={teamFilter} onChange={(e) => setTeamFilter(e.target.value)}>
          <option value="">All teams</option>
          {teamIds.map((tid) => {
            const t = teamMap.get(tid)
            return <option key={tid} value={tid}>{t?.name ?? tid}</option>
          })}
        </select>
        <select value={eventFilter} onChange={(e) => setEventFilter(e.target.value)}>
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
                <span className="series-teams">{label}</span>
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
