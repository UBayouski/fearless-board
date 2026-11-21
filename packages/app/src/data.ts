import {
  decodeCompactPicks,
  type ChampionRef,
  type CompactPicks,
  type Manifest,
  type PickRow,
  type PlayerRef,
  type SeriesIndexEntry,
  type TeamRef,
} from '@fearless-board/shared'

/* ── Data loading ─────────────────────────────────────────────── */

export type Load =
  | { state: 'loading' }
  | { state: 'missing'; error: string }
  | {
      state: 'ready'
      manifest: Manifest
      index: SeriesIndexEntry[]
      picks: PickRow[]
      teamMap: Map<string, TeamRef>
      championMap: Map<string, ChampionRef>
      playerMap: Map<string, PlayerRef>
    }

export async function loadAll(): Promise<Load> {
  try {
    const [manifest, index, compactPicks] = await Promise.all([
      fetch(`${import.meta.env.BASE_URL}data/manifest.json`).then((r) => r.json() as Promise<Manifest>),
      fetch(`${import.meta.env.BASE_URL}data/series-index.json`).then((r) => r.json() as Promise<SeriesIndexEntry[]>),
      fetch(`${import.meta.env.BASE_URL}data/picks.json`).then((r) => r.json() as Promise<CompactPicks>),
    ])

    const picks = decodeCompactPicks(compactPicks)
    // Add scheduledStart to decoded picks from index
    const seriesStartMap = new Map<string, string>()
    for (const entry of index) {
      seriesStartMap.set(entry.seriesId, entry.scheduledStart)
    }
    for (const pick of picks) {
      pick.scheduledStart = seriesStartMap.get(pick.seriesId) ?? ''
    }

    const teamMap = new Map(manifest.teams.map((t) => [t.id, t]))
    const championMap = new Map(manifest.champions.map((c) => [c.id, c]))
    const playerMap = new Map(manifest.players.map((p) => [p.id, p]))

    return { state: 'ready', manifest, index, picks, teamMap, championMap, playerMap }
  } catch (err) {
    return { state: 'missing', error: String(err) }
  }
}
