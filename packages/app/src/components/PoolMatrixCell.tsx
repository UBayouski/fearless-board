import type { ChampionRef, PoolEntry, Role } from '@fearless-board/shared'
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
}: {
  playerName: string
  role: Role | null
  pool: { credible: PoolEntry[]; burned: PoolEntry[] }
  burnedByGame: Map<string, number>
  championMap: Map<string, ChampionRef>
  seriesDate: string
  revealedPick?: { championId: string; rank: number } | null
}) {
  const totalGames = pool.credible.length + pool.burned.length
  const burnedCount = pool.burned.length

  const allPool: PoolEntry[] = [...pool.credible, ...pool.burned]
  const burnedSet = new Set(pool.burned.map((e) => e.championId))
  const share = burnedGameShare(allPool, burnedSet)

  // 4: Comfort bar — relative to most-played champion
  const maxGames = pool.credible.length > 0 ? Math.max(...pool.credible.map((e) => e.games)) : 0

  const weeksAgo = (lastPlayed: string) => {
    const diff = Date.parse(seriesDate) - Date.parse(lastPlayed)
    const days = Math.round(diff / (24 * 60 * 60 * 1000))
    if (days < 14) return `${days} d ago`
    const weeks = Math.round(days / 7)
    return `${weeks} w ago`
  }

  // 4: Recency — more than 12 weeks ago renders at 60% opacity
  const isStale = (lastPlayed: string) => {
    const diff = Date.parse(seriesDate) - Date.parse(lastPlayed)
    const weeks = diff / (7 * 24 * 60 * 60 * 1000)
    return weeks > 12
  }

  const hasReveal = revealedPick !== undefined
  const isNewPick = revealedPick === null
  const pickInPool = revealedPick != null && pool.credible.some((e) => e.championId === revealedPick.championId)

  return (
    <div className="pool-cell">
      <div className="pool-cell-header">
        <span className="pool-cell-name">{playerName}</span>
        <span className="pool-cell-role">{roleLabel(role)}</span>
      </div>
      <div className="pool-cell-summary">
        <span className="big-number display">{pool.credible.length}</span> left
        {' · '}<span className="burned-count">{burnedCount} burned</span>
      </div>
      <div className="burn-meter-row">
        <div className="burn-meter-bar">
          <div className="burn-meter-fill" style={{ width: `${Math.min(share, 100)}%` }} />
        </div>
        <span className="burn-meter-share">{share}% of games burned</span>
      </div>

      {hasReveal && isNewPick && (
        <div className="pool-cell-section">
          <button type="button" className="champ-tile-btn pool-new" aria-label={`${championMap.get(revealedPick!.championId)?.name ?? revealedPick!.championId}, new pick`}>
            {championMap.get(revealedPick!.championId)?.name ?? revealedPick!.championId} <small>new</small>
          </button>
        </div>
      )}

      {pool.credible.length > 0 && (
        <div className="pool-cell-section">
          {pool.credible.map((e) => {
            const champ = championMap.get(e.championId)
            const ago = weeksAgo(e.lastPlayed)
            const highlighted = hasReveal && pickInPool && revealedPick !== null && e.championId === revealedPick.championId
            // 4: Comfort bar width as share of most-played champion
            const comfortShare = maxGames > 0 ? (e.games / maxGames) * 100 : 0
            // 4: Stale tiles at 60% opacity
            const stale = isStale(e.lastPlayed)
            return (
              // 4: Real button element with focus ring
              <button
                key={e.championId}
                type="button"
                className={`champ-tile-btn pool-available ${highlighted ? 'pool-highlighted' : ''} ${stale ? 'stale' : ''}`}
                style={{ '--comfort': `${comfortShare}%` } as React.CSSProperties}
                aria-label={`${champ?.name ?? e.championId}, ${e.games} games, ${ago}`}
              >
                <span className="champ-tile-inner">
                  {champ?.name ?? e.championId}
                  <span className="comfort-bar" style={{ width: `${comfortShare}%` }} />
                </span>
                <small>{e.games}g · {ago}{highlighted && revealedPick ? ` · #${revealedPick.rank}` : ''}</small>
              </button>
            )
          })}
        </div>
      )}

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

      {totalGames < 10 && (
        <div className="pool-limited-note">limited history ({totalGames} games)</div>
      )}
    </div>
  )
}
