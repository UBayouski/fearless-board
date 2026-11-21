import { useCallback, useEffect, useState } from 'react'
import type { SeriesDraft } from '@fearless-board/shared'
import type { Load } from './data'
import { loadAll } from './data'
import { parseHash, setHash } from './route'
import { SeriesPicker } from './components/SeriesPicker'
import { SeriesBoard } from './components/SeriesBoard'
import './index.css'

function App() {
  const [load, setLoad] = useState<Load>({ state: 'loading' })
  const [selectedSeries, setSelectedSeries] = useState<string | null>(null)
  const [selectedGame, setSelectedGame] = useState<number | null>(null)
  const [seriesDraft, setSeriesDraft] = useState<SeriesDraft | null>(null)
  const [seriesError, setSeriesError] = useState<string | null>(null)

  useEffect(() => {
    loadAll().then(setLoad)
  }, [])

  // Restore from URL hash on load and on hashchange
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
        setSelectedSeries(null)
        setSelectedGame(null)
        setSeriesDraft(null)
        setSeriesError(null)
      }
    }
    handleHash()
    window.addEventListener('hashchange', handleHash)
    return () => window.removeEventListener('hashchange', handleHash)
  }, [])

  const loadSeries = useCallback(
    (seriesId: string) => {
      setSelectedSeries(seriesId)
      setSelectedGame(null)
      setSeriesError(null)
      setSeriesDraft(null)
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

  return (
    <main>
      <h1>Fearless Board</h1>
      <div className="app-layout">
        <aside className="sidebar">
          <SeriesPicker
            index={load.index}
            teamMap={load.teamMap}
            selectedId={selectedSeries}
            onSelect={loadSeries}
          />
        </aside>
        <section className="board">
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
            />
          ) : selectedSeries && seriesError ? (
            <p>Error loading series: {seriesError}</p>
          ) : (
            <p>Select a series from the list to view the board.</p>
          )}
        </section>
      </div>
    </main>
  )
}

export default App
