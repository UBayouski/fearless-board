import { useUi } from '../ui'

/**
 * A champion's square icon from Riot's Data Dragon, or nothing in names-only mode.
 * `named` icons stand in for a name that is not written out, and carry it as their text alternative.
 */
export function ChampIcon({ id, named = false }: { id: string; named?: boolean }) {
  const { championMap, icons, ddragon } = useUi()
  const champion = championMap.get(id)
  if (!icons || !ddragon || !champion?.icon) return null
  return (
    <img
      src={`https://ddragon.leagueoflegends.com/cdn/${ddragon}/img/champion/${champion.icon}`}
      alt={named ? champion.name : ''}
      loading="lazy"
    />
  )
}

/** A champion's name; the id itself if the champion is unknown. */
export function ChampName({ id }: { id: string }) {
  const { championMap } = useUi()
  return <>{championMap.get(id)?.name ?? id}</>
}
