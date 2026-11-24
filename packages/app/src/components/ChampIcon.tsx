import { useState } from 'react'
import { useUi } from '../ui'

/**
 * A champion's square icon from Riot's Data Dragon, or nothing in names-only mode.
 * `named` icons stand in for a name that is not written out, and carry it as their text alternative;
 * if such an icon cannot be loaded (Riot's server blocked or down), the name is written out instead.
 */
export function ChampIcon({ id, named = false }: { id: string; named?: boolean }) {
  const { championMap, icons, ddragon } = useUi()
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  const champion = championMap.get(id)
  if (!icons || !ddragon || !champion?.icon) return null
  const src = `https://ddragon.leagueoflegends.com/cdn/${ddragon}/img/champion/${champion.icon}`
  if (failedSrc === src) return named ? <span className="icon-fallback">{champion.name}</span> : null
  return <img src={src} alt={named ? champion.name : ''} loading="lazy" onError={() => setFailedSrc(src)} />
}

/** A champion's name; the id itself if the champion is unknown. */
export function ChampName({ id }: { id: string }) {
  const { championMap } = useUi()
  return <>{championMap.get(id)?.name ?? id}</>
}
