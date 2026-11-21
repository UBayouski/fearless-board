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

  const timeAgo = (lastPlayed: string) => {
    const diff = Date.parse(seriesDate) - Date.parse(lastPlayed)
    const days = Math.round(diff / (24 * 60 * 60 * 1000))
    if (days < 14) return `${days} d ago`
    const weeks = Math.round(days / 7)
    return `${weeks} w ago`
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
        {pool.credible.length} left · {burnedCount} burned · {share}% of games burned
      </div>

      {hasReveal && isNewPick && (
        <div className="pool-cell-section">
          <span className="champ-tile pool-new">
            {championMap.get(revealedPick!.championId)?.name ?? revealedPick!.championId} <small>new</small>
          </span>
        </div>
      )}

      {pool.credible.length > 0 && (
        <div className="pool-cell-section">
          {pool.credible.map((e) => {
            const champ = championMap.get(e.championId)
            const ago = timeAgo(e.lastPlayed)
            const highlighted = hasReveal && pickInPool && revealedPick !== null && e.championId === revealedPick.championId
            return (
              <span key={e.championId} className={`champ-tile pool-available ${highlighted ? 'pool-highlighted' : ''}`}>
                {champ?.name ?? e.championId} <small>{e.games}g · {ago}{highlighted && revealedPick ? ` · rank #${revealedPick.rank}` : ''}</small>
              </span>
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
              <span key={e.championId} className="champ-tile pool-burned">
                {champ?.name ?? e.championId} <small>G{burnedGame ?? '?'}</small>
              </span>
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
