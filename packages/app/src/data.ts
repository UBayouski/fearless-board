import {
  decodeCompactPicks,
  gamePlan,
  type PickModel,
  type Role,
  type ChampionRef,
  type CompactPicks,
  type EncodedPlan,
  type GamePlan,
  type Manifest,
  type PickRow,
  type PlayerRef,
  type SeriesDraft,
  type SeriesIndexEntry,
  type TeamRef,
} from '@fearless-board/shared'
import { decodePlan } from '@fearless-board/shared'

/* ── Data folder helper ───────────────────────────────────────── */

/**
 * Returns the data folder name from the VITE_DATA_DIR environment variable.
 * Defaults to "data" for the full build; "data-demo" for the demo build.
 */
export function dataDir(): string {
  return (import.meta.env.VITE_DATA_DIR ?? 'data') as string
}

/** Build a fetch URL inside the data folder. */
export function dataUrl(path: string): string {
  return `${import.meta.env.BASE_URL}${dataDir()}/${path}`
}

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
      mode: 'full' | 'demo'
    }

export async function loadAll(): Promise<Load> {
  try {
    const [manifest, index] = await Promise.all([
      fetch(dataUrl('manifest.json')).then((r) => r.json() as Promise<Manifest>),
      fetch(dataUrl('series-index.json')).then((r) => r.json() as Promise<SeriesIndexEntry[]>),
    ])

    const mode = manifest.mode === 'demo' ? 'demo' : 'full'

    let picks: PickRow[] = []
    if (mode === 'full') {
      const compactPicks = await fetch(dataUrl('picks.json')).then((r) => r.json() as Promise<CompactPicks>)
      picks = decodeCompactPicks(compactPicks)
      // Add scheduledStart to decoded picks from index
      const seriesStartMap = new Map<string, string>()
      for (const entry of index) {
        seriesStartMap.set(entry.seriesId, entry.scheduledStart)
      }
      for (const pick of picks) {
        pick.scheduledStart = seriesStartMap.get(pick.seriesId) ?? ''
      }
    }

    const teamMap = new Map(manifest.teams.map((t) => [t.id, t]))
    const championMap = new Map(manifest.champions.map((c) => [c.id, c]))
    const playerMap = new Map(manifest.players.map((p) => [p.id, p]))

    return { state: 'ready', manifest, index, picks, teamMap, championMap, playerMap, mode }
  } catch (err) {
    return { state: 'missing', error: String(err) }
  }
}

/* ── Plan source ──────────────────────────────────────────────── */

/**
 * Returns a function that provides a GamePlan for a given game number.
 * In full mode, it computes the plan from picks + model.
 * In demo mode, it decodes the pre-computed plan from the series file.
 */
export type PlanFor = (gameNumber: number) => GamePlan | null

/** A series file: the draft, plus the plans computed in advance in the demo build. */
export type SeriesWithPlans = SeriesDraft & { plans?: Record<string, EncodedPlan> }

export async function loadSeries(seriesId: string): Promise<SeriesWithPlans | null> {
  try {
    const r = await fetch(dataUrl(`${seriesId}.json`))
    if (!r.ok) return null
    return await r.json() as SeriesWithPlans
  } catch {
    return null
  }
}

/**
 * Build a PlanFor function from a series file with pre-computed plans (demo mode).
 */
export function planForFromPlans(series: SeriesWithPlans | null): PlanFor {
  if (!series || !series.plans) return () => null
  const plans = series.plans
  return (gameNumber: number) => {
    const encoded = plans[String(gameNumber)]
    if (!encoded) return null
    return decodePlan(encoded)
  }
}

/** The plan source for the loaded data: computed from the pick rows in full mode, decoded in demo mode. */
export function buildPlanFor(
  load: Load,
  model: PickModel | undefined,
  draft: SeriesDraft | null,
  series: SeriesWithPlans | null,
): PlanFor {
  if (load.state !== 'ready') return () => null
  if (load.mode === 'demo') return planForFromPlans(series)
  if (!model || !draft) return () => null
  const playerRole = new Map<string, Role | null>()
  for (const [id, p] of load.playerMap) playerRole.set(id, p.role)
  return (gameNumber) => gamePlan(draft, gameNumber, load.picks, model, playerRole)
}
