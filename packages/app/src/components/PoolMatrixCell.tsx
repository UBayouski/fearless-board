import { useState, type CSSProperties } from 'react'
import type { ChampionRef, PickLikelihood, PoolEntry, Role } from '@fearless-board/shared'
import { burnedGameShare } from '@fearless-board/shared'
import './PoolMatrixCell.css'

/** Small champion search input shared by ban search and pick search (6.2.2). */
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
  const filtered = query
    ? Array.from(championMap.values())
        .filter(c => c.name.toLowerCase().includes(query.toLowerCase()) && !unavailable.has(c.id))
        .slice(0, 5)
    : []
  return (
    <div className="champ-search">
      <input
        type="text"
        className="champ-search-input"
        placeholder={placeholder}
        value={query}
        onChange={e => setQuery(e.target.value)}
      />
      {filtered.length > 0 && (
        <div className="champ-search-results">
          {filtered.map(c => (
            <button key={c.id} type="button" className="champ-search-result" onClick={() => { onSelect(c.id); setQuery('') }}>
              {c.name}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function roleLabel(role: Role | null): string {
  return role ?? '?'
}

export function PoolMatrixCell({
  playerName,
  playerId,
  role,
  pool,
  burnedByGame,
  championMap,
  seriesDate,
  revealedPick,
  likelihoods,
  priorGames,
  substitute,
  isPickingPlayer,
  onPick,
  unavailable,
  hasPicked,
  pickedChampionId,
  lastRemoved,
  replayRank,
}: {
  playerName: string
  playerId: string
  role: Role | null
  pool: { credible: PoolEntry[]; burned: PoolEntry[] }
  burnedByGame: Map<string, number>
  championMap: Map<string, ChampionRef>
  seriesDate: string
  revealedPick?: { championId: string; rank: number } | null
  likelihoods: PickLikelihood[]
  priorGames: number
  substitute?: boolean
  isPickingPlayer?: boolean
  onPick?: (playerId: string, championId: string) => void
  /** Champions unavailable (banned/picked this game). */
  unavailable?: Set<string>
  hasPicked?: boolean
  /** 6.2.4: The champion this player picked, so the cell can show the name. */
  pickedChampionId?: string
  /** 6.2.3: The last removed champion for one-step visibility. */
  lastRemoved?: { championId: string; type: 'ban' | 'pick' } | null
  /** 6.2.5: Replay rank — rank in the list before the pick (0 = outside top 10). */
  replayRank?: number
}) {
  const totalGames = pool.credible.length + pool.burned.length
  const burnedCount = pool.burned.length

  const allPool: PoolEntry[] = [...pool.credible, ...pool.burned]
  const burnedSet = new Set(pool.burned.map((e) => e.championId))
  const share = burnedGameShare(allPool, burnedSet)

  const weeksAgo = (lastPlayed: string) => {
    const diff = Date.parse(seriesDate) - Date.parse(lastPlayed)
    const days = Math.round(diff / (24 * 60 * 60 * 1000))
    if (days < 14) return `${days} d ago`
    const weeks = Math.round(days / 7)
    return `${weeks} w ago`
  }

  const isStale = (lastPlayed: string) => {
    const diff = Date.parse(seriesDate) - Date.parse(lastPlayed)
    const weeks = diff / (7 * 24 * 60 * 60 * 1000)
    return weeks > 12
  }

  // If no model, fall back to pool-based display
  const useModel = likelihoods.length > 0

  // Build a map: championId -> pool entry for lookup
  const poolMap = new Map<string, PoolEntry>()
  for (const e of pool.credible) poolMap.set(e.championId, e)

  // 3: Top 10 from model
  const top10 = useModel ? likelihoods.slice(0, 10) : []
  // Remaining credible from model (champions the player has played, not in top 10)
  const alsoPlayed = useModel
    ? likelihoods.filter((l) => poolMap.has(l.championId) && !top10.some((t) => t.championId === l.championId))
    : []

  // Sum of likelihood on champions the player has played
  const likelihoodOnPlayed = useModel
    ? likelihoods.filter((l) => poolMap.has(l.championId)).reduce((sum, l) => sum + l.probability, 0)
    : 0

  // Feature explanation: plain role share from counts, then played/not played
  const featureExplanation = (likelihood: PickLikelihood): string => {
    const poolEntry = poolMap.get(likelihood.championId)
    const played = poolEntry !== undefined
    const { recent, allTime } = likelihood.roleShare ?? { recent: null, allTime: 0 }
    const share = recent !== null ? Math.round(recent * 100) : Math.round(allTime * 100)
    const label = recent !== null ? `recent ${role} picks` : `all ${role} picks`
    const sharePart = `${share}% of ${label}`
    return played ? sharePart : `${sharePart} · not played`
  }

  const hasReveal = revealedPick !== undefined
  const isNewPick = revealedPick === null
  const revealedChampId = revealedPick?.championId

  // Check if revealed pick is in top 10
  const revealedInTop10 = useModel && revealedPick != null && top10.some((l) => l.championId === revealedPick.championId)
  // Check if revealed pick is in alsoPlayed
  const revealedInAlsoPlayed = useModel && revealedPick != null && alsoPlayed.some((l) => l.championId === revealedPick.championId)
  // "unlisted" — not in top 10 and not in alsoPlayed (player hasn't played it)
  const isUnlisted = useModel && revealedPick != null && !revealedInTop10 && !revealedInAlsoPlayed

  // For "Also played" collapsible
  const [expanded, setExpanded] = useState(false)

  // Max probability for comfort bar
  const maxProb = top10.length > 0 ? Math.max(...top10.map((l) => l.probability)) : 0

  // Placeholder player — no earlier games in the data
  const isPlaceholder = totalGames === 0
  // Low-history player — fewer than 5 earlier games
  const isLowHistory = priorGames > 0 && priorGames < 5

  // A player who has picked: the cell collapses to the pick
  if (hasPicked) {
    return (
      <div className="pool-cell pool-cell-picked">
        <div className="pool-cell-header">
          <span className="pool-cell-name">{playerName}</span>
          <span className="pool-cell-role">{roleLabel(role)}</span>
        </div>
        <div className="pool-picked-note">
          <span className="pool-picked-champ">
            {pickedChampionId ? (championMap.get(pickedChampionId)?.name ?? pickedChampionId) : ''}
          </span>
          <span className="pool-picked-label">
            picked
            {replayRank !== undefined ? (replayRank > 0 ? ` · rank ${replayRank} in the list before the pick` : ' · outside the top 10') : ''}
          </span>
        </div>
      </div>
    )
  }

  return (
    <div className="pool-cell">
      <div className="pool-cell-header">
        <span className="pool-cell-name">
          {playerName}
          {substitute && <span className="pool-substitute-label"> substitute</span>}
        </span>
        <span className="pool-cell-role">{roleLabel(role)}</span>
      </div>
      {isPlaceholder || isLowHistory ? (
        <div className="pool-placeholder-note">
          <div className="pool-placeholder-text">
            {isPlaceholder ? 'no earlier games in the data' : `${priorGames} earlier ${priorGames === 1 ? 'game' : 'games'} in the data`}
          </div>
          {useModel && <div className="pool-placeholder-sub">list based on recent picks in this role only</div>}
        </div>
      ) : (
        <>
          <div className="pool-cell-summary">
            <span className="big-number display">{pool.credible.length}</span> left
            {' · '}<span className="burned-count">{burnedCount} burned</span>
          </div>
          {useModel && (
            <div className="pool-likelihood-summary">
              {Math.round(likelihoodOnPlayed * 100)}% of likely picks are champions played before
            </div>
          )}
          <div className="burn-meter-row">
            <div className="burn-meter-bar">
              <div className="burn-meter-fill" style={{ width: `${Math.min(share, 100)}%` }} />
            </div>
            <span className="burn-meter-share">{share}% of games burned</span>
          </div>
        </>
      )}

      {/* ── Reveal: unlisted pick ──────────────────────────── */}
      {hasReveal && isUnlisted && (
        <div className="pool-cell-section">
          <button type="button" className="champ-tile-btn pool-unlisted" aria-label={`${championMap.get(revealedChampId!)?.name ?? revealedChampId}, unlisted pick`}>
            {championMap.get(revealedChampId!)?.name ?? revealedChampId} <small>unlisted</small>
          </button>
        </div>
      )}

      {/* ── Reveal: new pick (no model) ────────────────────── */}
      {!useModel && hasReveal && isNewPick && (
        <div className="pool-cell-section">
          <button type="button" className="champ-tile-btn pool-new" aria-label={`${championMap.get(revealedChampId!)?.name ?? revealedChampId}, new pick`}>
            {championMap.get(revealedChampId!)?.name ?? revealedChampId} <small>new</small>
          </button>
        </div>
      )}

      {/* ── Top 10 from model ──────────────────────────────── */}
      {useModel && top10.length > 0 && (
        <div className="pool-cell-section">
          {top10.map((l) => {
            const champ = championMap.get(l.championId)
            const poolEntry = poolMap.get(l.championId)
            const played = poolEntry !== undefined
            const probPct = Math.round(l.probability * 100)
            const comfortShare = maxProb > 0 ? (l.probability / maxProb) * 100 : 0
            const highlighted = hasReveal && revealedInTop10 && l.championId === revealedChampId
            const stale = poolEntry && isStale(poolEntry.lastPlayed)
            const ago = poolEntry ? weeksAgo(poolEntry.lastPlayed) : ''
            const explanation = featureExplanation(l)
            const rank = revealedPick && l.championId === revealedPick.championId ? revealedPick.rank : 0
            const isUnavailable = unavailable?.has(l.championId)
            const isClickable = isPickingPlayer && !isUnavailable && onPick !== undefined

            return (
              <button
                key={l.championId}
                type="button"
                className={`champ-tile-btn ${highlighted ? 'pool-highlighted' : ''} ${stale ? 'stale' : ''} ${!played ? 'pool-not-played' : ''} ${isUnavailable ? 'draft-unavailable' : ''} ${isClickable ? 'draft-clickable' : ''}`}
                style={{ '--comfort': `${comfortShare}%` } as CSSProperties}
                aria-label={`${champ?.name ?? l.championId}, ${probPct}% likelihood, ${explanation}`}
                onClick={isClickable ? () => onPick!(playerId, l.championId) : undefined}
              >
                <span className="champ-tile-inner">
                  {champ?.name ?? l.championId}
                  <span className="comfort-bar" style={{ width: `${comfortShare}%` }} />
                </span>
                <small>
                  {probPct}%
                  {highlighted && rank ? ` · #${rank}` : ''}
                  {poolEntry ? ` · ${poolEntry.games}g · ${ago}` : ''}
                </small>
                <span className="champ-tile-explanation">{explanation}</span>
              </button>
            )
          })}
        </div>
      )}

      {/* ── 6.2.3: Last removed champion — struck tile for one step ── */}
      {lastRemoved && (
        <div className="pool-cell-section">
          <button type="button" className="champ-tile-btn draft-removed" aria-label={`${championMap.get(lastRemoved.championId)?.name ?? lastRemoved.championId}, ${lastRemoved.type}d`}>
            {championMap.get(lastRemoved.championId)?.name ?? lastRemoved.championId} <small>{lastRemoved.type === 'ban' ? 'banned' : 'picked'}</small>
          </button>
        </div>
      )}

      {/* ── 6.2.2: "Other champion" search for pick turns ── */}
      {isPickingPlayer && onPick !== undefined && (
        <ChampionSearch
          placeholder="Other champion..."
          onSelect={(championId) => onPick!(playerId, championId)}
          unavailable={unavailable ?? new Set()}
          championMap={championMap}
        />
      )}

      {/* ── Also played: collapsible ───────────────────────── */}
      {useModel && alsoPlayed.length > 0 && (
        <div className="pool-also-played">
          <button type="button" className="also-played-toggle" onClick={() => setExpanded(!expanded)}>
            {expanded ? '▲' : '▼'} Also played: {alsoPlayed.length} more
          </button>
          {expanded && (
            <div className="pool-cell-section">
              {alsoPlayed.map((l) => {
                const champ = championMap.get(l.championId)
                const poolEntry = poolMap.get(l.championId)
                if (!poolEntry) return null
                const probPct = Math.round(l.probability * 100)
                const ago = weeksAgo(poolEntry.lastPlayed)
                const stale = isStale(poolEntry.lastPlayed)
                const highlighted = hasReveal && revealedInAlsoPlayed && l.championId === revealedChampId
                const explanation = featureExplanation(l)
                const rank = revealedPick && l.championId === revealedPick.championId ? revealedPick.rank : 0

                return (
                  <button
                    key={l.championId}
                    type="button"
                    className={`champ-tile-btn ${highlighted ? 'pool-highlighted' : ''} ${stale ? 'stale' : ''}`}
                    aria-label={`${champ?.name ?? l.championId}, ${probPct}% likelihood, ${explanation}`}
                  >
                    <span className="champ-tile-inner">
                      {champ?.name ?? l.championId}
                    </span>
                    <small>
                      {probPct}% · {poolEntry.games}g · {ago}
                      {highlighted && rank ? ` · #${rank}` : ''}
                    </small>
                    <span className="champ-tile-explanation">{explanation}</span>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Fallback: old pool-based display (no model) ────── */}
      {!useModel && pool.credible.length > 0 && (
        <div className="pool-cell-section">
          {pool.credible.map((e) => {
            const champ = championMap.get(e.championId)
            const ago = weeksAgo(e.lastPlayed)
            const highlighted = hasReveal && revealedPick != null && e.championId === revealedPick.championId
            const stale = isStale(e.lastPlayed)
            return (
              <button
                key={e.championId}
                type="button"
                className={`champ-tile-btn pool-available ${highlighted ? 'pool-highlighted' : ''} ${stale ? 'stale' : ''}`}
                aria-label={`${champ?.name ?? e.championId}, ${e.games} games, ${ago}`}
              >
                <span className="champ-tile-inner">
                  {champ?.name ?? e.championId}
                </span>
                <small>{e.games}g · {ago}{highlighted && revealedPick ? ` · #${revealedPick.rank}` : ''}</small>
              </button>
            )
          })}
        </div>
      )}

      {/* ── Burned champions ───────────────────────────────── */}
      {pool.burned.length > 0 && (
        <div className="pool-cell-section pool-cell-burned">
          {pool.burned.map((e) => {
            const champ = championMap.get(e.championId)
            const burnedGame = burnedByGame.get(e.championId)
            return (
              <button
                key={e.championId}
                type="button"
                className="champ-tile-btn pool-burned"
                aria-label={`${champ?.name ?? e.championId}, burned in Game ${burnedGame ?? 'unknown'}`}
              >
                {champ?.name ?? e.championId} <small>G{burnedGame ?? '?'}</small>
              </button>
            )
          })}
        </div>
      )}

      {!isPlaceholder && !isLowHistory && priorGames < 10 && (
        <div className="pool-limited-note">limited history ({priorGames} games)</div>
      )}
    </div>
  )
}
