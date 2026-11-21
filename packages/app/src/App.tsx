import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  burnedChampions,
  burnedGameShare,
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
      if (filter) {
        const query = filter.toLowerCase()
        const t0 = teamMap.get(e.teamIds[0])
        const t1 = teamMap.get(e.teamIds[1])
        const teamNames = `${t0?.name ?? ''} ${t1?.name ?? ''}`.toLowerCase()
        if (!teamNames.includes(query) && !e.event.toLowerCase().includes(query)) return false
      }
      if (teamFilter && !e.teamIds.includes(teamFilter)) return false
      if (eventFilter && e.event !== eventFilter) return false
      return true
    })
  }, [index, filter, teamFilter, eventFilter, teamMap])

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

/* ── Compact History Card ─────────────────────────────────────── */

function CompactHistoryCard({
  game,
  teamMap,
  championMap,
  playerMap,
}: {
  game: GameDraft
  teamMap: Map<string, TeamRef>
  championMap: Map<string, ChampionRef>
  playerMap: Map<string, PlayerRef>
}) {
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

  const sortByRole = (picks: typeof game.picks) => {
    const roleOrderMap = new Map<string, number>()
    for (let i = 0; i < ROLE_ORDER.length; i++) roleOrderMap.set(ROLE_ORDER[i], i)
    return [...picks].sort((a, b) => {
      const ra = roleOrderMap.get(playerMap.get(a.playerId)?.role ?? '') ?? 99
      const rb = roleOrderMap.get(playerMap.get(b.playerId)?.role ?? '') ?? 99
      return ra - rb
    })
  }

  const bans = useMemo(() => {
    return game.actions.filter((a) => a.type === 'ban')
  }, [game.actions])

  return (
    <div className={`compact-history ${game.winnerTeamId ? 'winner' : ''}`}>
      <div className="compact-header">
        <strong>Game {game.gameNumber}</strong>
        {game.winnerTeamId && (
          <span className="compact-winner">
            ✓ {teamMap.get(game.winnerTeamId)?.name ?? game.winnerTeamId}
          </span>
        )}
      </div>

      {/* Picks per team */}
      {['blue', 'red'].map((side) => {
        const teamId = game.sides[side as 'blue' | 'red']
        const team = teamMap.get(teamId)
        const picks = sortByRole(picksByTeam.get(teamId) ?? [])
        return (
          <div key={side} className={`compact-side ${side}`}>
            <span className="compact-side-label">{side === 'blue' ? 'B' : 'R'}</span>
            <span className="compact-team-name">{team?.name ?? teamId}</span>
            <span className="compact-picks">
              {picks.map((p) => {
                const champ = championMap.get(p.championId)
                return <span key={p.playerId} className="champ-tile compact-champ">{champ?.name ?? p.championId}</span>
              })}
            </span>
          </div>
        )
      })}

      {/* Bans as one line per team */}
      {bans.length > 0 && (
        <div className="compact-bans">
          {(() => {
            const bansByTeam = new Map<string, string[]>()
            for (const b of bans) {
              const list = bansByTeam.get(b.teamId) ?? []
              const champ = championMap.get(b.championId)
              list.push(champ?.name ?? b.championId)
              bansByTeam.set(b.teamId, list)
            }
            return (
              <>
                {[...bansByTeam.entries()].map(([teamId, names]) => {
                  const team = teamMap.get(teamId)
                  return (
                    <div key={teamId} className="compact-ban-team">
                      <span className="compact-ban-team-label">{team?.name ?? teamId}:</span>
                      {names.map((name, i) => (
                        <span key={i} className="champ-tile banned compact-ban-champ">{name}</span>
                      ))}
                    </div>
                  )
                })}
              </>
            )
          })()}
        </div>
      )}
    </div>
  )
}

/* ── Pool Matrix Cell ─────────────────────────────────────────── */

function PoolMatrixCell({
  playerName,
  role,
  pool,
  burnedByGame,
  championMap,
  seriesDate,
  revealedPick,
}: {
  playerName: string
  role: Role | null
  pool: { credible: PoolEntry[]; burned: PoolEntry[] }
  burnedByGame: Map<string, number>
  championMap: Map<string, ChampionRef>
  seriesDate: string
  revealedPick?: { championId: string; rank: number } | null
}) {
  const totalGames = pool.credible.length + pool.burned.length
  const burnedCount = pool.burned.length

  // Calculate share of prior games on burned champions (uses shared function)
  const allPool: PoolEntry[] = [...pool.credible, ...pool.burned]
  const burnedSet = new Set(pool.burned.map((e) => e.championId))
  const share = burnedGameShare(allPool, burnedSet)

  // Format time ago: days under two weeks, weeks after that
  const timeAgo = (lastPlayed: string) => {
    const diff = Date.parse(seriesDate) - Date.parse(lastPlayed)
    const days = Math.round(diff / (24 * 60 * 60 * 1000))
    if (days < 14) return `${days} d ago`
    const weeks = Math.round(days / 7)
    return `${weeks} w ago`
  }

  // Determine if this pick was in the pool
  const hasReveal = revealedPick !== undefined
  const isNewPick = revealedPick === null
  const pickInPool = revealedPick != null && pool.credible.some((e) => e.championId === revealedPick.championId)

  return (
    <div className="pool-cell">
      <div className="pool-cell-header">
        <span className="pool-cell-name">{playerName}</span>
        <span className="pool-cell-role">{roleLabel(role)}</span>
      </div>
      <div className="pool-cell-summary">
        {pool.credible.length} left · {burnedCount} burned · {share}% of games burned
      </div>

      {/* Reveal: show "new" tile if pick wasn't in pool */}
      {hasReveal && isNewPick && (
        <div className="pool-cell-section">
          <span className="champ-tile pool-new">
            {championMap.get(revealedPick!.championId)?.name ?? revealedPick!.championId} <small>new</small>
          </span>
        </div>
      )}

      {pool.credible.length > 0 && (
        <div className="pool-cell-section">
          {pool.credible.map((e) => {
            const champ = championMap.get(e.championId)
            const ago = timeAgo(e.lastPlayed)
            const highlighted = hasReveal && pickInPool && revealedPick !== null && e.championId === revealedPick.championId
            return (
              <span key={e.championId} className={`champ-tile pool-available ${highlighted ? 'pool-highlighted' : ''}`}>
                {champ?.name ?? e.championId} <small>{e.games}g · {ago}{highlighted && revealedPick ? ` · rank #${revealedPick.rank}` : ''}</small>
              </span>
            )
          })}
        </div>
      )}

      {pool.burned.length > 0 && (
        <div className="pool-cell-section pool-cell-burned">
          {pool.burned.map((e) => {
            const champ = championMap.get(e.championId)
            const burnedGame = burnedByGame.get(e.championId)
            return (
              <span key={e.championId} className="champ-tile pool-burned">
                {champ?.name ?? e.championId} <small>G{burnedGame ?? '?'}</small>
              </span>
            )
          })}
        </div>
      )}

      {totalGames < 10 && (
        <div className="pool-limited-note">limited history ({totalGames} games)</div>
      )}
    </div>
  )
}

/* ── Pool Matrix ──────────────────────────────────────────────── */

function PoolMatrix({
  draft,
  picks,
  teamMap,
  championMap,
  playerMap,
  gameNumber,
  revealedGame,
}: {
  draft: SeriesDraft
  picks: PickRow[]
  teamMap: Map<string, TeamRef>
  championMap: Map<string, ChampionRef>
  playerMap: Map<string, PlayerRef>
  gameNumber: number
  revealedGame?: GameDraft
}) {
  const burned = burnedChampions(draft.games, gameNumber)

  // Map burned champion IDs to the game that burned them
  const burnedByGame = useMemo(() => {
    const map = new Map<string, number>()
    for (const g of draft.games) {
      if (g.gameNumber >= gameNumber) break
      if (g.picks.length > 0) {
        for (const p of g.picks) {
          if (!map.has(p.championId)) {
            map.set(p.championId, g.gameNumber)
          }
        }
      }
    }
    return map
  }, [draft.games, gameNumber])

  // Build a map: teamId → role → player
  const playerGrid = useMemo(() => {
    const grid = new Map<string, Map<Role, PlayerRef>>()
    for (const teamId of draft.teamIds) {
      const teamPlayers = new Map<Role, PlayerRef>()
      for (const role of ROLE_ORDER) {
        // Find the player with this role on this team
        for (const game of draft.games) {
          for (const pick of game.picks) {
            if (pick.teamId === teamId) {
              const player = playerMap.get(pick.playerId)
              if (player && player.role === role) {
                teamPlayers.set(role, player)
                break
              }
            }
          }
          if (teamPlayers.has(role)) break
        }
      }
      grid.set(teamId, teamPlayers)
    }
    return grid
  }, [draft.teamIds, draft.games, playerMap])

  // Build revealed pick map: playerId → { championId, rank } | null
  const revealedPickMap = useMemo(() => {
    if (!revealedGame) return undefined
    const map = new Map<string, { championId: string; rank: number } | null>()
    // Group picks by team
    const picksByTeam = new Map<string, typeof revealedGame.picks>()
    for (const p of revealedGame.picks) {
      const list = picksByTeam.get(p.teamId) ?? []
      list.push(p)
      picksByTeam.set(p.teamId, list)
    }
    for (const teamId of draft.teamIds) {
      const teamPicks = picksByTeam.get(teamId) ?? []
      for (const pick of teamPicks) {
        const player = playerMap.get(pick.playerId)
        if (!player) continue
        // Compute rank in player's credible pool
        const pool = playerPool(picks, player.id, draft.scheduledStart)
        const { credible } = crediblePool(pool, burned)
        const rank = credible.findIndex((e) => e.championId === pick.championId) + 1
        if (rank > 0) {
          map.set(pick.playerId, { championId: pick.championId, rank })
        } else {
          // Pick was not in the credible pool (new champion)
          map.set(pick.playerId, null)
        }
      }
    }
    return map
  }, [revealedGame, picks, draft.scheduledStart, draft.teamIds, playerMap, burned])

  // Compute reveal summary
  const revealSummary = useMemo(() => {
    if (!revealedPickMap) return null
    let inPool = 0
    let total = 0
    for (const [, val] of revealedPickMap) {
      total++
      if (val !== null) inPool++
    }
    return { inPool, total }
  }, [revealedPickMap])

  return (
    <>
      {/* Reveal summary line */}
      {revealSummary && (
        <div className="reveal-summary">
          {revealSummary.inPool} of {revealSummary.total} picks came from the available pools
        </div>
      )}
      <div className="pool-matrix">
        {/* Header row */}
        <div className="pool-matrix-header">
          <div className="pool-matrix-corner"></div>
          {draft.teamIds.map((teamId) => {
            const team = teamMap.get(teamId)
            return <div key={teamId} className="pool-matrix-team-header">{team?.name ?? teamId}</div>
          })}
        </div>

        {/* Role rows */}
        {ROLE_ORDER.map((role) => (
          <div key={role} className="pool-matrix-row">
            <div className="pool-matrix-role-label">{role.toUpperCase()}</div>
            {draft.teamIds.map((teamId) => {
              const player = playerGrid.get(teamId)?.get(role)
              if (!player) {
                return <div key={teamId} className="pool-cell pool-cell-empty">—</div>
              }
              const pool = playerPool(picks, player.id, draft.scheduledStart)
              const { credible, burned: burnedEntries } = crediblePool(pool, burned)
              return (
                <div key={teamId} className="pool-matrix-cell">
                  <PoolMatrixCell
                    playerName={player.name}
                    role={player.role}
                    pool={{ credible, burned: burnedEntries }}
                    burnedByGame={burnedByGame}
                    championMap={championMap}
                    seriesDate={draft.scheduledStart}
                    revealedPick={revealedPickMap?.get(player.id)}
                  />
                </div>
              )
            })}
          </div>
        ))}
      </div>
    </>
  )
}

/* ── Series Board ─────────────────────────────────────────────── */

function SeriesBoard({
  draft,
  picks,
  teamMap,
  championMap,
  playerMap,
  selectedGame,
  onSelectGame,
}: {
  draft: SeriesDraft
  picks: PickRow[]
  teamMap: Map<string, TeamRef>
  championMap: Map<string, ChampionRef>
  playerMap: Map<string, PlayerRef>
  selectedGame: number | null
  onSelectGame: (gameNumber: number) => void
}) {
  const gameNumber = selectedGame ?? (() => {
    // Default to game 3 if it exists, otherwise game 2, otherwise the last game
    if (draft.games.length >= 3) return 3
    if (draft.games.length >= 2) return 2
    return draft.games.length
  })()

  // Suppress unused warning — onSelectGame is used via setHash below
  void onSelectGame

  const [revealedGames, setRevealedGames] = useState<Set<number>>(new Set())

  const t0 = teamMap.get(draft.teamIds[0])
  const t1 = teamMap.get(draft.teamIds[1])

  // Compute score going into gameNumber
  const score = useMemo(() => {
    let score0 = 0
    let score1 = 0
    for (const g of draft.games) {
      if (g.gameNumber >= gameNumber) break
      if (g.winnerTeamId === draft.teamIds[0]) score0++
      else if (g.winnerTeamId === draft.teamIds[1]) score1++
    }
    return { score0, score1 }
  }, [draft.games, draft.teamIds, gameNumber])

  // Compute sides for gameNumber
  const gameSides = useMemo(() => {
    const g = draft.games.find((g) => g.gameNumber === gameNumber)
    return g?.sides ?? null
  }, [draft.games, gameNumber])

  // Past games (before gameNumber)
  const pastGames = draft.games.filter((g) => g.gameNumber < gameNumber)
  // Revealed upcoming games
  const revealedUpcoming = draft.games.filter((g) => g.gameNumber >= gameNumber && revealedGames.has(g.gameNumber))

  // playerGrid is built inside PoolMatrix

  return (
    <div className="series-board">
      <h2>
        {t0?.name ?? draft.teamIds[0]} vs {t1?.name ?? draft.teamIds[1]}
      </h2>
      <p className="series-info">
        {draft.event} · {draft.stage} · {new Date(draft.scheduledStart).toLocaleDateString()}
      </p>

      {/* Series state line */}
      {gameSides && (
        <div className="series-state">
          <span className="state-score">
            {t0?.name ?? draft.teamIds[0]} {score.score0}–{score.score1} {t1?.name ?? draft.teamIds[1]}
          </span>
          <span className="state-sides">
            · Game {gameNumber}:{' '}
            {(() => {
              const blueTeam = teamMap.get(gameSides.blue)
              const redTeam = teamMap.get(gameSides.red)
              return `${blueTeam?.name ?? gameSides.blue} blue, ${redTeam?.name ?? gameSides.red} red`
            })()}
          </span>
        </div>
      )}

      {/* Compact history for past games */}
      {pastGames.length > 0 && (
        <div className="history-row">
          {pastGames.map((g) => (
            <CompactHistoryCard
              key={g.gameId}
              game={g}
              teamMap={teamMap}
              championMap={championMap}
              playerMap={playerMap}
            />
          ))}
        </div>
      )}

      {/* Revealed upcoming games */}
      {revealedUpcoming.length > 0 && (
        <div className="games-row">
          {revealedUpcoming.map((g) => (
            <GameColumn
              key={g.gameId}
              game={g}
              teamMap={teamMap}
              championMap={championMap}
              playerMap={playerMap}
              isSelected={false}
              onSelect={() => {}}
            />
          ))}
        </div>
      )}

      {/* Reveal button: only for the selected game if not yet revealed */}
      {(() => {
        const selectedUpcoming = draft.games.find((g) => g.gameNumber === gameNumber && !revealedGames.has(g.gameNumber))
        if (selectedUpcoming) {
          return (
            <div className="reveal-section">
              <button
                className="reveal-btn"
                onClick={() => {
                  const next = new Set(revealedGames)
                  next.add(selectedUpcoming.gameNumber)
                  setRevealedGames(next)
                }}
              >
                Reveal Game {selectedUpcoming.gameNumber}
              </button>
            </div>
          )
        }
        // "Next game" button after reveal
        const revealedSelected = draft.games.find((g) => g.gameNumber === gameNumber && revealedGames.has(g.gameNumber))
        if (revealedSelected) {
          const nextGame = draft.games.find((g) => g.gameNumber > gameNumber)
          if (nextGame) {
            return (
              <div className="reveal-section">
                <button
                  className="reveal-btn"
                  onClick={() => {
                    onSelectGame(nextGame.gameNumber)
                  }}
                >
                  Next game (Game {nextGame.gameNumber})
                </button>
              </div>
            )
          }
        }
        return null
      })()}

      {/* Burned strip (one line above the matrix) */}
      {gameNumber && <BurnedStrip games={draft.games} gameNumber={gameNumber} championMap={championMap} />}

      {/* Pool matrix */}
      {gameNumber && (
        <PoolMatrix
          draft={draft}
          picks={picks}
          teamMap={teamMap}
          championMap={championMap}
          playerMap={playerMap}
          gameNumber={gameNumber}
          revealedGame={revealedGames.has(gameNumber) ? draft.games.find((g) => g.gameNumber === gameNumber) : undefined}
        />
      )}
    </div>
  )
}

/* ── URL hash helpers ─────────────────────────────────────────── */

function parseHash(): { seriesId: string | null; gameNumber: number | null } {
  const hash = window.location.hash.slice(1) // strip '#'
  const params = new URLSearchParams(hash)
  return {
    seriesId: params.get('s') ?? null,
    gameNumber: params.has('g') ? Number(params.get('g')) : null,
  }
}

function setHash(seriesId: string, gameNumber: number) {
  window.location.hash = `s=${seriesId}&g=${gameNumber}`
}

function clearHash() {
  window.location.hash = ''
}

void clearHash

/* ── App ──────────────────────────────────────────────────────── */

function App() {
  const [load, setLoad] = useState<Load>({ state: 'loading' })
  const [selectedSeries, setSelectedSeries] = useState<string | null>(null)
  const [selectedGame, setSelectedGame] = useState<number | null>(null)
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
