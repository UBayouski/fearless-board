import { useEffect, useState } from 'react'
import type { Manifest } from '@fearless-board/shared'

type Load = { state: 'loading' } | { state: 'missing' } | { state: 'ready'; manifest: Manifest }

function App() {
  const [load, setLoad] = useState<Load>({ state: 'loading' })

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}data/manifest.json`)
      .then((res) => (res.ok ? (res.json() as Promise<Manifest>) : Promise.reject(new Error(res.statusText))))
      .then((manifest) => setLoad({ state: 'ready', manifest }))
      .catch(() => setLoad({ state: 'missing' }))
  }, [])

  return (
    <main>
      <h1>Fearless Board</h1>
      <p>Series-long draft planning for Fearless Draft.</p>
      {load.state === 'loading' && <p>Loading draft data…</p>}
      {load.state === 'missing' && (
        <p>
          No draft data found. Run <code>pnpm data</code> to build it from a local clone of the hackathon data.
        </p>
      )}
      {load.state === 'ready' && (
        <p>
          {load.manifest.seriesCount} series and {load.manifest.gameCount} games loaded.
        </p>
      )}
    </main>
  )
}

export default App
