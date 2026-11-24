import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PickModel, SeriesDraft, WrittenNote } from '@fearless-board/shared'
import { selectFeatured } from '@fearless-board/shared'
import type { Load, SeriesWithPlans } from './data'
import { buildPlanFor, dataUrl, loadAll, loadSeries } from './data'
import { parseHash, setHash } from './route'
import { SeriesPicker } from './components/SeriesPicker'
import { SeriesBoard } from './components/SeriesBoard'
import { HeaderSwitches } from './components/HeaderSwitches'
import { UiContext } from './ui'
import './index.css'

type Theme = 'light' | 'dark'

/** A setting the visitor chose earlier; storage can be unavailable (private windows), so every access is guarded. */
function stored(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function store(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    // The choice then lasts for this visit only
  }
}

/** Champion icons are on unless the visitor turned them off. Names only requests nothing from Riot's server. */
const ICONS_DEFAULT = true

// 3.5: Load notes only if manifest says notes exist
async function loadNotes(seriesId: string, manifestNotes?: { model: string; count: number }) {
  if (!manifestNotes) return null
  try {
    const r = await fetch(dataUrl(`notes/${seriesId}.json`))
    if (!r.ok) return null
    const data = await r.json() as { model: string; promptVersion: number; games: Record<string, Record<string, WrittenNote>> }
    return { model: data.model, games: data.games }
  } catch {
    return null
  }
}

// 6: Load backtest stats for the footer
async function loadBacktest() {
  try {
    const r = await fetch(dataUrl('backtest.json'))
    return await r.json() as {
      summary: { inPool: number; inPool20: number; gameCount: number }
      model?: { groups?: Array<{ name: string; model: { top5: number; top10: number }; gamesPlayed: { top5: number; top10: number } }> }
    }
  } catch {
    return null
  }
}

function App() {
  const [load, setLoad] = useState<Load>({ state: 'loading' })
  // The first visit follows the system setting; after that the visitor's choice is kept
  const [theme, setTheme] = useState<Theme>(() => {
    const saved = stored('fearless-board:theme')
    if (saved === 'light' || saved === 'dark') return saved
    return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  })
  const [icons, setIcons] = useState<boolean>(() => {
    const saved = stored('fearless-board:icons')
    return saved === null ? ICONS_DEFAULT : saved === 'on'
  })
  useEffect(() => {
    document.documentElement.dataset.theme = theme
    document.documentElement.dataset.icons = icons ? 'on' : 'off'
  }, [theme, icons])
  const [selectedSeries, setSelectedSeries] = useState<string | null>(null)
  const [selectedGame, setSelectedGame] = useState<number | null>(null)
  const [seriesError, setSeriesError] = useState<string | null>(null)
  const [panelOpen, setPanelOpen] = useState(false)
  const [backtestStats, setBacktestStats] = useState<{
    inPool: number
    inPool20: number
    gameCount: number
    modelTop5?: number
    modelTop10?: number
    gamesPlayedTop5?: number
    gamesPlayedTop10?: number
  } | null>(null)
  const [notesData, setNotesData] = useState<{ model: string; games: Record<string, Record<string, WrittenNote>> } | null>(null)
  const [manifestNotes, setManifestNotes] = useState<{ model: string; count: number } | undefined>(undefined)
  const seriesSelectorRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  // Full mode: model loaded from model.json
  const [loadedModel, setLoadedModel] = useState<PickModel | undefined>()

  useEffect(() => {
    loadAll().then((l) => {
      setLoad(l)
      // 3.5: Check if manifest says notes exist
      if (l.state === 'ready') {
        setManifestNotes(l.manifest.notes)
        // In full mode, load the model
        if (l.mode === 'full') {
          fetch(dataUrl('model.json')).then(async (r) => {
            if (r.ok) setLoadedModel(await r.json())
          }).catch(() => {})
        }
      }
    })
    loadBacktest().then((bt) => {
      if (bt?.summary) {
        // 3: Use the "games 2+" group for reliability numbers
        const games2Group = bt.model?.groups?.find((g) => g.name === 'games 2+')
        setBacktestStats({
          ...bt.summary,
          modelTop5: games2Group?.model?.top5,
          modelTop10: games2Group?.model?.top10,
          gamesPlayedTop5: games2Group?.gamesPlayed?.top5,
          gamesPlayedTop10: games2Group?.gamesPlayed?.top10,
        })
      }
    })
  }, [])

  // Close panel on outside click
  useEffect(() => {
    if (!panelOpen) return
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setPanelOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [panelOpen])

  // 3.5: Load notes for the selected series; clear when series changes
  const prevSeriesRef = useRef<string | null>(null)
  useEffect(() => {
    if (prevSeriesRef.current !== selectedSeries) {
      prevSeriesRef.current = selectedSeries
      setNotesData(null)
    }
    if (!selectedSeries || !manifestNotes) return
    let cancelled = false
    loadNotes(selectedSeries, manifestNotes).then((data) => {
      if (!cancelled) setNotesData(data)
    })
    return () => { cancelled = true }
  }, [selectedSeries, manifestNotes])

  // Load series file (draft + plans) when selected
  const [seriesWithPlans, setSeriesWithPlans] = useState<SeriesWithPlans | null>(null)
  useEffect(() => {
    if (!selectedSeries) return
    let cancelled = false
    loadSeries(selectedSeries).then((data) => {
      if (cancelled) return
      setSeriesWithPlans(data)
      setSeriesError(data ? null : 'Series not found')
    })
    return () => { cancelled = true }
  }, [selectedSeries])

  // The plan source: computed in full mode, read from the series file in demo mode
  // The loaded file counts only while it is the selected series. Nothing clears it on a hash change,
  // so choosing another game of the same series keeps the board.
  const seriesDraft: SeriesDraft | null = seriesWithPlans?.seriesId === selectedSeries ? seriesWithPlans : null

  // The featured series: four or more games, all ten players with 20+ earlier series, newest first.
  // The demo build holds only these; the full build marks them in the series list.
  const featured = useMemo(() => {
    if (load.state !== 'ready') return []
    return load.mode === 'demo' ? load.index : selectFeatured(load.index, load.picks)
  }, [load])
  const featuredIds = useMemo(() => new Set(featured.map((e) => e.seriesId)), [featured])

  const planFor = useMemo(
    () => buildPlanFor(load, loadedModel, seriesDraft, seriesWithPlans),
    [load, loadedModel, seriesDraft, seriesWithPlans],
  )

  // 6: Restore from URL hash on load and on hashchange; default to most recent best-of-five
  useEffect(() => {
    const handleHash = () => {
      const { seriesId, gameNumber } = parseHash()
      if (seriesId) {
        setSelectedSeries(seriesId)
        setSelectedGame(gameNumber)
        setSeriesError(null)
      } else {
        if (load.state === 'ready') {
          // Default: the newest featured series that went to five games, on its last game; else the newest featured
          const first = featured.find((e) => e.gameCount === 5) ?? featured[0]
          if (first) {
            setHash(first.seriesId, first.gameCount)
            setSelectedSeries(first.seriesId)
            setSelectedGame(first.gameCount)
            setSeriesError(null)
            return
          }
        }
        setSelectedSeries(null)
        setSelectedGame(null)
        setSeriesError(null)
      }
    }
    handleHash()
    window.addEventListener('hashchange', handleHash)
    return () => window.removeEventListener('hashchange', handleHash)
  }, [load, featured])

  const loadSeriesCallback = useCallback(
    (seriesId: string) => {
      setSelectedSeries(seriesId)
      setSelectedGame(null)
      setSeriesError(null)
      setPanelOpen(false)
      setHash(seriesId, 1)
      seriesSelectorRef.current?.focus()
    },
    [],
  )

  const selectGame = useCallback(
    (seriesId: string, gameNumber: number) => {
      setSelectedGame(gameNumber)
      setHash(seriesId, gameNumber)
    },
    [],
  )

  if (load.state !== 'ready') {
    return (
      <main className="loading">
        <div className="wordmark">FEARLESS <span>BOARD</span></div>
        <p>Series-long draft planning for Fearless Draft.</p>
        {load.state === 'loading' && <p>Loading draft data…</p>}
        {load.state === 'missing' && (
          <p>
            No draft data found. Run <code>pnpm data</code> to build it from a local clone of the hackathon data.
            {load.error && <><br />Error: {load.error}</>}
          </p>
        )}
      </main>
    )
  }

  // Build label for the series selector button
  const seriesLabel = seriesDraft
    ? `${load.teamMap.get(seriesDraft.teamIds[0])?.name ?? '?'} vs ${load.teamMap.get(seriesDraft.teamIds[1])?.name ?? '?'}`
    : selectedSeries
      ? 'Select series'
      : 'Select series'

  const ui = { championMap: load.championMap, teamMap: load.teamMap, icons, ddragon: load.manifest.ddragon }
  const chooseTheme = (value: Theme) => { setTheme(value); store('fearless-board:theme', value) }
  const chooseIcons = (value: boolean) => { setIcons(value); store('fearless-board:icons', value ? 'on' : 'off') }

  return (
    <UiContext.Provider value={ui}>
      <main className="wrap">
        <div className="top">
          <h1 className="wordmark">FEARLESS <span>BOARD</span></h1>
          <div className="selector" ref={panelRef}>
            <button
              ref={seriesSelectorRef}
              type="button"
              className="ghost"
              aria-expanded={panelOpen}
              aria-controls={panelOpen ? 'series-selector-panel' : undefined}
              onClick={() => setPanelOpen(!panelOpen)}
            >
              {seriesLabel}
            </button>
            {panelOpen && (
              <div id="series-selector-panel" className="series-selector-panel">
                {load.mode === 'demo' && (
                  <p className="demo-line">
                    Demo: {load.index.length} featured series out of {load.manifest.seriesCount}.
                    Run the project locally with the hackathon data for all of them.
                  </p>
                )}
                <SeriesPicker
                  index={load.index}
                  featuredIds={featuredIds}
                  teamMap={load.teamMap}
                  selectedId={selectedSeries}
                  onSelect={loadSeriesCallback}
                />
              </div>
            )}
          </div>
          <div className="grow" />
          <HeaderSwitches icons={icons} theme={theme} onIcons={chooseIcons} onTheme={chooseTheme} />
        </div>

        {selectedSeries && seriesDraft ? (
          <SeriesBoard
            key={`${seriesDraft.seriesId}-${selectedGame}`}
            draft={seriesDraft}
            planFor={planFor}
            playerMap={load.playerMap}
            selectedGame={selectedGame}
            onSelectGame={(gn) => selectGame(selectedSeries, gn)}
            notesData={notesData ?? undefined}
          />
        ) : selectedSeries && seriesError ? (
          <p>Error loading series: {seriesError}</p>
        ) : (
          <p>Select a series to view the board.</p>
        )}

        <footer className="foot">
          {backtestStats?.modelTop5 !== undefined && backtestStats.gamesPlayedTop5 !== undefined && (
            <p className="backtest">
              On games 2 and later of 2026, the real pick was among the model's five most likely {backtestStats.modelTop5}% of the
              time ({backtestStats.gamesPlayedTop5}% for a ranking by games played).
            </p>
          )}
          <p>Match data: GRID, provided for the Sky's The Limit 2026 hackathon.</p>
          <p>
            Fearless Board isn't endorsed by Riot Games and doesn't reflect the views or opinions of Riot Games or anyone
            officially involved in producing or managing Riot Games properties. Riot Games, and all associated properties
            are trademarks or registered trademarks of Riot Games, Inc.
          </p>
        </footer>
      </main>
    </UiContext.Provider>
  )
}

export default App
