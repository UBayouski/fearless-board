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
  if (!icons) return null
  // No icon version or no icon for this champion, or it failed to load: write the name where the icon stood in for it
  const fallback = named ? <span className="icon-fallback">{champion?.name ?? id}</span> : null
  if (!ddragon || !champion?.icon) return fallback
  const src = `https://ddragon.leagueoflegends.com/cdn/${ddragon}/img/champion/${champion.icon}`
  if (failedSrc === src) return fallback
  return <img src={src} alt={named ? champion.name : ''} loading="lazy" onError={() => setFailedSrc(src)} />
}

/** A champion's name; the id itself if the champion is unknown. */
export function ChampName({ id }: { id: string }) {
  const { championMap } = useUi()
  return <>{championMap.get(id)?.name ?? id}</>
}
