import { useState, type CSSProperties } from 'react'
import type { ChampionRef, PickLikelihood, PoolEntry, Role } from '@fearless-board/shared'
import { burnedGameShare } from '@fearless-board/shared'
import './PoolMatrixCell.css'

function roleLabel(role: Role | null): string {
  return role ?? '?'
}

export function PoolMatrixCell({
  playerName,
  role,
  pool,
  burnedByGame,
  championMap,
  seriesDate,
  revealedPick,
  likelihoods,
  substitute,
}: {
  playerName: string
  role: Role | null
  pool: { credible: PoolEntry[]; burned: PoolEntry[] }
  burnedByGame: Map<string, number>
  championMap: Map<string, ChampionRef>
  seriesDate: string
  revealedPick?: { championId: string; rank: number } | null
  likelihoods: PickLikelihood[]
  substitute?: boolean
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

  // Feature explanation from pool data
  const featureExplanation = (likelihood: PickLikelihood): string => {
    const poolEntry = poolMap.get(likelihood.championId)
    if (poolEntry) {
      return `played ${poolEntry.games} times`
    } else {
      return `not played`
    }
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

  // 7: Placeholder player — no earlier games in the data
  const isPlaceholder = totalGames === 0

  return (
    <div className="pool-cell">
      <div className="pool-cell-header">
        <span className="pool-cell-name">
          {playerName}
          {substitute && <span className="pool-substitute-label"> substitute</span>}
        </span>
        <span className="pool-cell-role">{roleLabel(role)}</span>
      </div>
      {isPlaceholder ? (
        <div className="pool-placeholder-note">
          <div className="pool-placeholder-text">no earlier games in the data</div>
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

            return (
              <button
                key={l.championId}
                type="button"
                className={`champ-tile-btn ${highlighted ? 'pool-highlighted' : ''} ${stale ? 'stale' : ''} ${!played ? 'pool-not-played' : ''}`}
                style={{ '--comfort': `${comfortShare}%` } as CSSProperties}
                aria-label={`${champ?.name ?? l.championId}, ${probPct}% likelihood, ${explanation}`}
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

      {!isPlaceholder && totalGames < 10 && (
        <div className="pool-limited-note">limited history ({totalGames} games)</div>
      )}
    </div>
  )
}
