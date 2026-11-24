import { useState, type KeyboardEvent } from 'react'
import type { ChampionRef } from '@fearless-board/shared'

/** A champion search: type, then choose with the mouse or with the arrow keys and Enter. Escape clears it. */
export function ChampionSearch({
  placeholder,
  onSelect,
  unavailable,
  championMap,
}: {
  placeholder: string
  onSelect: (championId: string) => void
  unavailable: Set<string>
  championMap: Map<string, ChampionRef>
}) {
  const [query, setQuery] = useState('')
  const [focusedIndex, setFocusedIndex] = useState(-1)
  const filtered = query
    ? Array.from(championMap.values())
        .filter(c => c.name.toLowerCase().includes(query.toLowerCase()) && !unavailable.has(c.id))
        .slice(0, 5)
    : []

  const choose = (championId: string) => {
    onSelect(championId)
    setQuery('')
    setFocusedIndex(-1)
  }

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      setQuery('')
      setFocusedIndex(-1)
      return
    }
    if (!filtered.length) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setFocusedIndex(i => Math.min(i + 1, filtered.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setFocusedIndex(i => Math.max(i - 1, 0))
    } else if (e.key === 'Enter' && focusedIndex >= 0) {
      e.preventDefault()
      choose(filtered[focusedIndex].id)
    }
  }

  return (
    <div className="champ-search">
      <input
        type="text"
        className="champ-search-input"
        placeholder={placeholder}
        aria-label={placeholder}
        value={query}
        onChange={e => { setQuery(e.target.value); setFocusedIndex(-1) }}
        onKeyDown={handleKeyDown}
      />
      {filtered.length > 0 && (
        <div className="champ-search-results">
          {filtered.map((c, idx) => (
            <button
              key={c.id}
              type="button"
              className={`champ-search-result ${idx === focusedIndex ? 'focused' : ''}`}
              onClick={() => choose(c.id)}
              onMouseEnter={() => setFocusedIndex(idx)}
            >
              {c.name}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
