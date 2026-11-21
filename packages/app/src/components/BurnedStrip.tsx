import { useMemo } from 'react'
import type { GameDraft, ChampionRef } from '@fearless-board/shared'
import './BurnedStrip.css'

export function BurnedStrip({
  games,
  gameNumber,
  championMap,
}: {
  games: GameDraft[]
  gameNumber: number
  championMap: Map<string, ChampionRef>
}) {
  const burnedByGame = useMemo(() => {
    const map = new Map<number, { gameId: string; champions: { championId: string; name: string }[] }>()
    for (const g of games) {
      if (g.gameNumber >= gameNumber) continue
      const champIds = new Set<string>()
      if (g.picks.length > 0) {
        for (const p of g.picks) champIds.add(p.championId)
      } else {
        for (const a of g.actions) {
          if (a.type === 'pick') champIds.add(a.championId)
        }
      }
      const champions = [...champIds].map((cid) => ({
        championId: cid,
        name: championMap.get(cid)?.name ?? cid,
      }))
      map.set(g.gameNumber, { gameId: g.gameId, champions })
    }
    return map
  }, [games, gameNumber, championMap])

  if (burnedByGame.size === 0) return null

  return (
    <div className="burned-strip">
      <h3>Burned Champions</h3>
      {[...burnedByGame.entries()].sort((a, b) => a[0] - b[0]).map(([gn, { champions }]) => (
        <div key={gn} className="burned-game">
          <span className="burned-label">Game {gn}:</span>
          <span className="burned-champs">
            {champions.map((c) => <span key={c.championId} className="champ-tile burned">{c.name}</span>)}
          </span>
        </div>
      ))}
    </div>
  )
}
