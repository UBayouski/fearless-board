import { useCallback, useEffect, useRef, useState } from 'react'
import type { SeriesDraft } from '@fearless-board/shared'
import type { Load } from './data'
import { loadAll } from './data'
import { parseHash, setHash } from './route'
import { SeriesPicker } from './components/SeriesPicker'
import { SeriesBoard } from './components/SeriesBoard'
import './index.css'

// 6: Load backtest stats for the footer
async function loadBacktest() {
  try {
    const r = await fetch(`${import.meta.env.BASE_URL}data/backtest.json`)
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
  const [selectedSeries, setSelectedSeries] = useState<string | null>(null)
  const [selectedGame, setSelectedGame] = useState<number | null>(null)
  const [seriesDraft, setSeriesDraft] = useState<SeriesDraft | null>(null)
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
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    loadAll().then(setLoad)
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

  // 6: Restore from URL hash on load and on hashchange; default to most recent best-of-five
  useEffect(() => {
    const handleHash = () => {
      const { seriesId, gameNumber } = parseHash()
      if (seriesId) {
        setSelectedSeries(seriesId)
        setSelectedGame(gameNumber)
        setSeriesError(null)
        setSeriesDraft(null)
        fetch(`${import.meta.env.BASE_URL}data/${seriesId}.json`)
          .then((r) => r.json() as Promise<SeriesDraft>)
          .then((d) => setSeriesDraft(d))
          .catch((err) => setSeriesError(String(err)))
      } else {
        // 7: Default to most recent best-of-five where all 10 players have 20+ earlier games
        if (load.state === 'ready') {
          const bo5s = load.index
            .filter((e) => e.gameCount === 5)
            .sort((a, b) => b.scheduledStart.localeCompare(a.scheduledStart))
          // Check each series to find one where all players have 20+ prior games
          let bestSeries: typeof bo5s[0] | null = null
          for (const entry of bo5s) {
            // Collect player IDs from this series in picks.json
            const playerIds = new Set<string>()
            for (const p of load.picks) {
              if (p.seriesId === entry.seriesId) {
                playerIds.add(p.playerId)
              }
            }
            if (playerIds.size < 10) continue
            let allHave20 = true
            for (const pid of playerIds) {
              // Count unique series this player appeared in before the candidate
              const priorSeries = new Set(
                load.picks
                  .filter((p) => p.playerId === pid && p.scheduledStart < entry.scheduledStart)
                  .map((p) => p.seriesId),
              )
              if (priorSeries.size < 20) {
                allHave20 = false
                break
              }
            }
            if (allHave20) {
              bestSeries = entry
              break
            }
          }
          if (bestSeries) {
            setHash(bestSeries.seriesId, 3)
            setSelectedSeries(bestSeries.seriesId)
            setSelectedGame(3)
            setSeriesError(null)
            setSeriesDraft(null)
            fetch(`${import.meta.env.BASE_URL}data/${bestSeries.seriesId}.json`)
              .then((r) => r.json() as Promise<SeriesDraft>)
              .then((d) => setSeriesDraft(d))
              .catch((err) => setSeriesError(String(err)))
            return
          }
        }
        setSelectedSeries(null)
        setSelectedGame(null)
        setSeriesDraft(null)
        setSeriesError(null)
      }
    }
    handleHash()
    window.addEventListener('hashchange', handleHash)
    return () => window.removeEventListener('hashchange', handleHash)
  }, [load])

  const loadSeries = useCallback(
    (seriesId: string) => {
      setSelectedSeries(seriesId)
      setSelectedGame(null)
      setSeriesError(null)
      setSeriesDraft(null)
      setPanelOpen(false)
      setHash(seriesId, 1)
      fetch(`${import.meta.env.BASE_URL}data/${seriesId}.json`)
        .then((r) => r.json() as Promise<SeriesDraft>)
        .then((d) => setSeriesDraft(d))
        .catch((err) => setSeriesError(String(err)))
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
      <main>
        <h1>Fearless Board</h1>
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

  return (
    <main>
      {/* ── Header with series selector ─────────────────────── */}
      <div className="board-header">
        <h1>Fearless Board</h1>
        <div style={{ position: 'relative' }} ref={panelRef}>
          <button
            className="series-selector-btn"
            onClick={() => setPanelOpen(!panelOpen)}
          >
            {seriesLabel}
          </button>
          {panelOpen && (
            <div className="series-selector-panel">
              <SeriesPicker
                index={load.index}
                teamMap={load.teamMap}
                selectedId={selectedSeries}
                onSelect={loadSeries}
              />
            </div>
          )}
        </div>
      </div>

      {/* ── Full-width board ────────────────────────────────── */}
      <section className="board-full">
        {selectedSeries && seriesDraft ? (
          <SeriesBoard
            key={seriesDraft.seriesId}
            draft={seriesDraft}
            picks={load.picks}
            teamMap={load.teamMap}
            championMap={load.championMap}
            playerMap={load.playerMap}
            selectedGame={selectedGame}
            onSelectGame={(gn) => selectGame(selectedSeries, gn)}
            backtestStats={backtestStats ?? undefined}
          />
        ) : selectedSeries && seriesError ? (
          <p>Error loading series: {seriesError}</p>
        ) : (
          <p>Select a series to view the board.</p>
        )}
      </section>

      {/* ── Attribution footer ──────────────────────────────── */}
      <footer className="app-footer">
        <span className="attribution">
          Match data: GRID, provided for the Sky's The Limit 2026 hackathon. Not affiliated with or endorsed by Riot Games.
        </span>
      </footer>
    </main>
  )
}

export default App
