import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  burnedChampions,
  crediblePool,
  decodeCompactPicks,
  playerPool,
  type ChampionRef,
  type CompactPicks,
  type GameDraft,
  type Manifest,
  type PickRow,
  type PlayerRef,
  type PoolEntry,
  type Role,
  type SeriesDraft,
  type SeriesIndexEntry,
  type TeamRef,
} from '@fearless-board/shared'

const ROLE_ORDER: Role[] = ['top', 'jungle', 'mid', 'bot', 'support']

function roleLabel(role: Role | null | undefined): string {
  return role ?? '?'
}

/* ── Data loading ─────────────────────────────────────────────── */

type Load =
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

/* ── Series Picker ────────────────────────────────────────────── */

function SeriesPicker({
  index,
  teamMap,
  selectedId,
  onSelect,
}: {
  index: SeriesIndexEntry[]
  teamMap: Map<string, TeamRef>
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  const [filter, setFilter] = useState('')
  const [teamFilter, setTeamFilter] = useState('')

  // Collect distinct team ids from index for the filter dropdown
  const teamIds = useMemo(() => {
    const ids = new Set<string>()
    for (const e of index) {
      ids.add(e.teamIds[0])
      ids.add(e.teamIds[1])
    }
    return [...ids].sort()
  }, [index])

  // Collect distinct event names
  const eventSet = useMemo(() => {
    const events = new Set<string>()
    for (const e of index) events.add(e.event)
    return [...events].sort()
  }, [index])

  const [eventFilter, setEventFilter] = useState('')

  const filtered = useMemo(() => {
    return index.filter((e) => {
      if (e.gameCount < 2) return false // default to multi-game
      if (filter && !`${e.teamIds[0]} ${e.teamIds[1]}`.includes(filter) && !e.event.toLowerCase().includes(filter.toLowerCase())) return false
      if (teamFilter && !e.teamIds.includes(teamFilter)) return false
      if (eventFilter && e.event !== eventFilter) return false
      return true
    })
  }, [index, filter, teamFilter, eventFilter])

  return (
    <div className="series-picker">
      <div className="picker-controls">
        <input
          type="text"
          placeholder="Search teams or events…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <select value={teamFilter} onChange={(e) => setTeamFilter(e.target.value)}>
          <option value="">All teams</option>
          {teamIds.map((tid) => {
            const t = teamMap.get(tid)
            return <option key={tid} value={tid}>{t?.name ?? tid}</option>
          })}
        </select>
        <select value={eventFilter} onChange={(e) => setEventFilter(e.target.value)}>
          <option value="">All events</option>
          {eventSet.map((ev) => <option key={ev} value={ev}>{ev}</option>)}
        </select>
      </div>
      <ul className="series-list">
        {filtered.map((e) => {
          const t0 = teamMap.get(e.teamIds[0])
          const t1 = teamMap.get(e.teamIds[1])
          const label = `${t0?.name ?? e.teamIds[0]} vs ${t1?.name ?? e.teamIds[1]}`
          return (
            <li
              key={e.seriesId}
              className={selectedId === e.seriesId ? 'selected' : ''}
              onClick={() => onSelect(e.seriesId)}
            >
              <span className="series-teams">{label}</span>
              <span className="series-meta">
                {e.event} · {e.stage} · {e.gameCount} game{e.gameCount > 1 ? 's' : ''} · {new Date(e.scheduledStart).toLocaleDateString()}
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/* ── Burned Strip ─────────────────────────────────────────────── */

function BurnedStrip({
  games,
  gameNumber,
  championMap,
}: {
  games: GameDraft[]
  gameNumber: number
  championMap: Map<string, ChampionRef>
}) {
  // Group burned champions by the game that burned them
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

/* ── Game Column ──────────────────────────────────────────────── */

function GameColumn({
  game,
  teamMap,
  championMap,
  playerMap,
  isSelected,
  onSelect,
}: {
  game: GameDraft
  teamMap: Map<string, TeamRef>
  championMap: Map<string, ChampionRef>
  playerMap: Map<string, PlayerRef>
  isSelected: boolean
  onSelect: () => void
}) {
  const hasActions = game.actions.length > 0

  // Group picks by team, ordered by role
  const picksByTeam = useMemo(() => {
    const map = new Map<string, typeof game.picks>()
    for (const p of game.picks) {
      const list = map.get(p.teamId) ?? []
      list.push(p)
      map.set(p.teamId, list)
    }
    return map
  }, [game.picks])

  // Sort picks within each team by role order
  const sortByRole = (picks: typeof game.picks) => {
    const roleOrderMap = new Map<string, number>()
    for (let i = 0; i < ROLE_ORDER.length; i++) roleOrderMap.set(ROLE_ORDER[i], i)

    return [...picks].sort((a, b) => {
      const ra = roleOrderMap.get(playerMap.get(a.playerId)?.role ?? '') ?? 99
      const rb = roleOrderMap.get(playerMap.get(b.playerId)?.role ?? '') ?? 99
      return ra - rb
    })
  }

  return (
    <div className={`game-column ${isSelected ? 'selected' : ''}`} onClick={onSelect}>
      <div className="game-header">
        <strong>Game {game.gameNumber}</strong>
        {game.patch && <span className="game-patch">({game.patch})</span>}
        {game.winnerTeamId && (
          <span className="game-winner">
            Winner: {teamMap.get(game.winnerTeamId)?.name ?? game.winnerTeamId}
          </span>
        )}
      </div>

      {/* Sides */}
      {['blue', 'red'].map((side) => {
        const teamId = game.sides[side as 'blue' | 'red']
        const team = teamMap.get(teamId)
        const picks = sortByRole(picksByTeam.get(teamId) ?? [])
        return (
          <div key={side} className={`side ${side}`}>
            <div className="side-label">{side.toUpperCase()} — {team?.name ?? teamId}</div>
            {picks.map((p) => {
              const champ = championMap.get(p.championId)
              const player = playerMap.get(p.playerId)
              return (
                <div key={p.playerId} className="pick-row">
                  <span className="pick-role">{roleLabel(player?.role)}</span>
                  <span className="pick-player">{p.playerName}</span>
                  <span className="champ-tile">{champ?.name ?? p.championId}</span>
                </div>
              )
            })}
          </div>
        )
      })}

      {/* Bans (only if draft actions available) */}
      {hasActions && (
        <div className="bans">
          <div className="bans-label">Bans</div>
          {game.actions
            .filter((a) => a.type === 'ban')
            .map((a) => {
              const champ = championMap.get(a.championId)
              const team = teamMap.get(a.teamId)
              return (
                <div key={a.order} className="ban-row">
                  <span className="ban-team">{team?.name ?? a.teamId}</span>
                  <span className="champ-tile banned">{champ?.name ?? a.championId}</span>
                </div>
              )
            })}
        </div>
      )}

      {!hasActions && <div className="no-actions-note">No draft data</div>}
    </div>
  )
}

/* ── Player Pool Panel ────────────────────────────────────────── */

function PlayerPoolPanel({
  playerName,
  role,
  pool,
  championMap,
}: {
  playerName: string
  role: Role | null
  pool: { credible: PoolEntry[]; burned: PoolEntry[] }
  championMap: Map<string, ChampionRef>
}) {
  if (pool.credible.length === 0 && pool.burned.length === 0) return null

  return (
    <div className="player-pool">
      <h4>
        {playerName} <span className="pool-role">({roleLabel(role)})</span>
      </h4>
      {pool.credible.length > 0 && (
        <div className="pool-section">
          <span className="pool-label">Available ({pool.credible.length})</span>
          <div className="pool-champs">
            {pool.credible.map((e) => {
              const champ = championMap.get(e.championId)
              return (
                <span key={e.championId} className="champ-tile pool-available" title={`${e.games} games, ${e.wins} wins, last ${e.lastPlayed}`}>
                  {champ?.name ?? e.championId} <small>({e.games}g)</small>
                </span>
              )
            })}
          </div>
        </div>
      )}
      {pool.burned.length > 0 && (
        <div className="pool-section">
          <span className="pool-label">Burned ({pool.burned.length})</span>
          <div className="pool-champs">
            {pool.burned.map((e) => {
              const champ = championMap.get(e.championId)
              return (
                <span key={e.championId} className="champ-tile pool-burned" title={`Burned — ${e.games} games, ${e.wins} wins, last ${e.lastPlayed}`}>
                  {champ?.name ?? e.championId} <small>({e.games}g)</small>
                </span>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

/* ── Series Board ─────────────────────────────────────────────── */

function SeriesBoard({
  draft,
  picks,
  teamMap,
  championMap,
  playerMap,
}: {
  draft: SeriesDraft
  picks: PickRow[]
  teamMap: Map<string, TeamRef>
  championMap: Map<string, ChampionRef>
  playerMap: Map<string, PlayerRef>
}) {
  const [selectedGame, setSelectedGame] = useState<number>(draft.games.length)

  const t0 = teamMap.get(draft.teamIds[0])
  const t1 = teamMap.get(draft.teamIds[1])

  // Gather all players in this series, ordered by role
  const playersByTeam = useMemo(() => {
    const map = new Map<string, PlayerRef[]>()
    for (const game of draft.games) {
      for (const pick of game.picks) {
        const player = playerMap.get(pick.playerId)
        if (!player) continue
        const list = map.get(pick.teamId) ?? []
        if (!list.find((p) => p.id === player.id)) {
          list.push(player)
        }
        map.set(pick.teamId, list)
      }
    }
    // Sort each team's players by role
    const roleOrderMap = new Map<string, number>()
    for (let i = 0; i < ROLE_ORDER.length; i++) roleOrderMap.set(ROLE_ORDER[i], i)
    for (const [teamId, players] of map) {
      players.sort((a, b) => {
        const ra = roleOrderMap.get(a.role ?? '') ?? 99
        const rb = roleOrderMap.get(b.role ?? '') ?? 99
        return ra - rb
      })
      map.set(teamId, players)
    }
    return map
  }, [draft.games, playerMap])

  return (
    <div className="series-board">
      <h2>
        {t0?.name ?? draft.teamIds[0]} vs {t1?.name ?? draft.teamIds[1]}
      </h2>
      <p className="series-info">
        {draft.event} · {draft.stage} · {new Date(draft.scheduledStart).toLocaleDateString()}
      </p>

      {/* Game columns */}
      <div className="games-row">
        {draft.games.map((g) => (
          <GameColumn
            key={g.gameId}
            game={g}
            teamMap={teamMap}
            championMap={championMap}
            playerMap={playerMap}
            isSelected={selectedGame === g.gameNumber}
            onSelect={() => setSelectedGame(g.gameNumber)}
          />
        ))}
      </div>

      {/* Burned strip */}
      {selectedGame && <BurnedStrip games={draft.games} gameNumber={selectedGame} championMap={championMap} />}

      {/* Player pools */}
      {selectedGame && (
        <div className="player-pools">
          <h3>Credible Pools (before Game {selectedGame})</h3>
          {draft.teamIds.map((teamId) => {
            const team = teamMap.get(teamId)
            const players = playersByTeam.get(teamId) ?? []
            const burned = burnedChampions(draft.games, selectedGame)
            return (
              <div key={teamId} className="team-pools">
                <h4>{team?.name ?? teamId}</h4>
                {players.map((player) => {
                  const pool = playerPool(picks, player.id, draft.scheduledStart)
                  const { credible, burned: burnedEntries } = crediblePool(pool, burned)
                  return (
                    <PlayerPoolPanel
                      key={player.id}
                      playerName={player.name}
                      role={player.role}
                      pool={{ credible, burned: burnedEntries }}
                      championMap={championMap}
                    />
                  )
                })}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

/* ── App ──────────────────────────────────────────────────────── */

function App() {
  const [load, setLoad] = useState<Load>({ state: 'loading' })
  const [selectedSeries, setSelectedSeries] = useState<string | null>(null)
  const [seriesDraft, setSeriesDraft] = useState<SeriesDraft | null>(null)
  const [seriesError, setSeriesError] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([
      fetch(`${import.meta.env.BASE_URL}data/manifest.json`).then((r) => r.json() as Promise<Manifest>),
      fetch(`${import.meta.env.BASE_URL}data/series-index.json`).then((r) => r.json() as Promise<SeriesIndexEntry[]>),
      fetch(`${import.meta.env.BASE_URL}data/picks.json`).then((r) => r.json() as Promise<CompactPicks>),
    ])
      .then(([manifest, index, compactPicks]) => {
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

        setLoad({ state: 'ready', manifest, index, picks, teamMap, championMap, playerMap })
      })
      .catch((err) => setLoad({ state: 'missing', error: String(err) }))
  }, [])

  const loadSeries = useCallback(
    (seriesId: string) => {
      setSelectedSeries(seriesId)
      setSeriesError(null)
      setSeriesDraft(null)
      fetch(`${import.meta.env.BASE_URL}data/${seriesId}.json`)
        .then((r) => r.json() as Promise<SeriesDraft>)
        .then((d) => setSeriesDraft(d))
        .catch((err) => setSeriesError(String(err)))
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
              draft={seriesDraft}
              picks={load.picks}
              teamMap={load.teamMap}
              championMap={load.championMap}
              playerMap={load.playerMap}
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
