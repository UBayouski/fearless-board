// Builds the aggregate JSON the app loads, from a local clone of the hackathon data repo.
// The data repo lives next to this project, never inside it (see README).
import { existsSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import type { SeriesDraft, GameDraft, PlayerPick, Side, DraftAction, Manifest, SeriesIndexEntry, CompactPicks, Role } from '@fearless-board/shared'
import {
  parseCSV,
  type GameRow,
  type RosterRow,
  type SeriesRow,
} from './csv.ts'
import { readJsonlZst } from './zst.ts'

const start = performance.now()

const dataDir = process.env.STL_DATA_DIR ?? resolve(import.meta.dirname, '../../../../stl-hackathon-2026-grid-starter')
const seriesIndexPath = resolve(dataDir, 'lol/series.csv')

if (!existsSync(seriesIndexPath)) {
  console.error(`Hackathon data not found at ${dataDir}`)
  console.error('Clone the data repo next to this project, or set STL_DATA_DIR. See README.md.')
  process.exit(1)
}

// Task 1: Read the index files
console.log('Reading index files...')

const games = parseCSV<GameRow>(resolve(dataDir, 'meta/games.csv'))
  .filter(r => r.title === 'lol' && r.finished === 'True')
const rosters = parseCSV<RosterRow>(resolve(dataDir, 'meta/rosters.csv')).filter(r => r.title === 'lol')
const allSeries = parseCSV<SeriesRow>(resolve(dataDir, 'lol/series.csv'))

// Filter series to LoL only (all rows should have title=lol based on the file, but series.csv doesn't have a title column)
const lolSeries = allSeries

console.log(`Games: ${games.length}`)
console.log(`Roster rows: ${rosters.length}`)
console.log(`Series (LoL): ${lolSeries.length}`)


// Group games by series_id
const gamesBySeries = new Map<string, GameRow[]>()
for (const g of games) {
  const list = gamesBySeries.get(g.series_id) ?? []
  list.push(g)
  gamesBySeries.set(g.series_id, list)
}

// Group roster rows by game_id
const rostersByGame = new Map<string, RosterRow[]>()
for (const r of rosters) {
  const list = rostersByGame.get(r.game_id) ?? []
  list.push(r)
  rostersByGame.set(r.game_id, list)
}

// Task 3: Add bans and order from match files
console.log('Reading match files for draft actions...')

interface DraftActionRaw {
  sequenceNumber: number
  type: 'pick' | 'ban'
  drafter: { id: string }
  draftable: { id: string }
}

interface MatchFileGame {
  gameId: string
  draftActions: DraftActionRaw[]
}

async function readMatchFile(filePath: string): Promise<MatchFileGame[]> {
  const games: MatchFileGame[] = []
  for await (const line of readJsonlZst(filePath)) {
    const events = (line as any).events || []
    for (const ev of events) {
      if (ev.type === 'series-started-game' && ev.target?.state?.draftActions) {
        games.push({
          gameId: ev.target.id,
          draftActions: ev.target.state.draftActions,
        })
      }
    }
  }
  return games
}

// Build draft actions map: game_id -> DraftAction[]
const actionsByGame = new Map<string, DraftAction[]>()
let seriesWithActions = 0
let gamesWithActions = 0
let gamesSkippedNotInCsv = 0

for (const series of lolSeries) {
  const matchPath = resolve(dataDir, series.file)
  if (!existsSync(matchPath)) continue

  try {
    const matchGames = await readMatchFile(matchPath)
    for (const mg of matchGames) {
      // Only include games that exist in our CSV data (skip remakes)
      if (!gamesBySeries.has(series.series_id)) continue
      const gameInCsv = gamesBySeries.get(series.series_id)?.find(g => g.game_id === mg.gameId)
      if (!gameInCsv) {
        gamesSkippedNotInCsv++
        continue
      }
      const actions: DraftAction[] = mg.draftActions.map(a => ({
        order: a.sequenceNumber,
        type: a.type,
        teamId: a.drafter.id,
        championId: a.draftable.id,
      }))
      actionsByGame.set(mg.gameId, actions)
      gamesWithActions++
    }
    seriesWithActions++
  } catch (e) {
    console.error(`  Error reading ${series.file}: ${e}`)
  }
}

console.log(`  Series with match files: ${seriesWithActions}`)
console.log(`  Games with draft actions: ${gamesWithActions}`)
console.log(`  Games skipped (not in CSV, likely remakes): ${gamesSkippedNotInCsv}`)

// Task 4: Reconcile — check draftActions picks match rosters.csv picks
console.log('Reconciling picks between draft actions and rosters...')

const mismatches: string[] = []
for (const [gameId, actions] of actionsByGame) {
  const draftPickChampions = new Set(actions.filter(a => a.type === 'pick').map(a => a.championId))
  const rosterRows = rostersByGame.get(gameId) ?? []
  const rosterChampions = new Set(
    rosterRows.filter(r => r.participation_status === 'active' && r.character_id).map(r => r.character_id)
  )

  const draftOnly = [...draftPickChampions].filter(c => !rosterChampions.has(c))
  const rosterOnly = [...rosterChampions].filter(c => !draftPickChampions.has(c))

  if (draftOnly.length > 0 || rosterOnly.length > 0) {
    mismatches.push(`Game ${gameId}: draft has ${draftOnly.length} extra, roster has ${rosterOnly.length} extra`)
  }
}

console.log(`  Mismatches: ${mismatches.length}`)
if (mismatches.length > 0) {
  for (const m of mismatches.slice(0, 10)) {
    console.log(`    - ${m}`)
  }
}

// Task 5: Explain exceptions
console.log('Analyzing exceptions...')

// 5a: Games with 11 roster rows instead of 10
const gamesWith11Rosters: { gameId: string; seriesId: string; extra: string[] }[] = []
for (const [gameId, rosterRows] of rostersByGame) {
  const active = rosterRows.filter(r => r.participation_status === 'active')
  if (active.length === 11) {
    // Find the player with empty champion (substitution/left before pick)
    const noChampion = active.filter(r => !r.character_id)
    const extra = noChampion.map(r => `${r.player_name} (no champion picked)`)
    gamesWith11Rosters.push({
      gameId,
      seriesId: active[0].series_id,
      extra,
    })
  }
}

console.log(`  Games with 11 roster rows: ${gamesWith11Rosters.length}`)
for (const g of gamesWith11Rosters) {
  console.log(`    - Series ${g.seriesId}, Game ${g.gameId}: ${g.extra.join(', ')}`)
}

// 5b: Series where a team repeats a champion
const repeatedChampionSeries: {
  seriesId: string
  teamId: string
  championId: string
  games: number[]
}[] = []

for (const series of lolSeries) {
  const seriesGames = gamesBySeries.get(series.series_id)
  if (!seriesGames) continue

  // Track champions per team across games
  const teamChampions = new Map<string, Map<string, number[]>>() // teamId -> championId -> [gameNumbers]

  for (const game of seriesGames) {
    const gameRosters = rostersByGame.get(game.game_id) ?? []
    const gameNumber = parseInt(game.game_number, 10)

    for (const r of gameRosters) {
      if (r.participation_status !== 'active') continue

      const teamMap2 = teamChampions.get(r.team_id) ?? new Map<string, number[]>()
      const gamesList = teamMap2.get(r.character_id) ?? []
      gamesList.push(gameNumber)
      teamMap2.set(r.character_id, gamesList)
      teamChampions.set(r.team_id, teamMap2)
    }
  }

  for (const [teamId, champMap] of teamChampions) {
    for (const [championId, gameNumbers] of champMap) {
      if (gameNumbers.length > 1 && championId) {
        repeatedChampionSeries.push({
          seriesId: series.series_id,
          teamId,
          championId,
          games: gameNumbers,
        })
      }
    }
  }
}

console.log(`  Series with repeated champions: ${repeatedChampionSeries.length}`)
for (const r of repeatedChampionSeries) {
  console.log(`    - Series ${r.seriesId}, Team ${r.teamId}, Champion ${r.championId} in games ${r.games.join(', ')}`)
}

// Task 2 (continued): Build picks with actions filled in
console.log('Building SeriesDraft objects...')

const drafts: SeriesDraft[] = []

for (const series of lolSeries) {
  const seriesGames = gamesBySeries.get(series.series_id)
  if (!seriesGames) continue

  // Extract team IDs from the games data
  const firstGame = seriesGames[0]
  const teamIds = [firstGame.team1_id, firstGame.team2_id] as [string, string]

  const gameDrafts: GameDraft[] = []

  for (const game of seriesGames) {
    const gameRosters = rostersByGame.get(game.game_id) ?? []

    // Determine sides from the game row
    const sides: Record<Side, string> = {
      blue: '',
      red: '',
    }

    if (game.team1_side === 'blue') {
      sides.blue = game.team1_id
    } else {
      sides.red = game.team1_id
    }
    if (game.team2_side === 'blue') {
      sides.blue = game.team2_id
    } else {
      sides.red = game.team2_id
    }

    // Build picks from roster rows (only active participants)
    const picks: PlayerPick[] = []
    for (const r of gameRosters) {
      if (r.participation_status !== 'active' || !r.character_id) continue
      picks.push({
        teamId: r.team_id,
        playerId: r.player_id,
        playerName: r.player_name,
        championId: r.character_id,
      })
    }

    const draftActions = actionsByGame.get(game.game_id) ?? []

    gameDrafts.push({
      gameId: game.game_id,
      gameNumber: parseInt(game.game_number, 10),
      patch: game.patch || null,
      sides,
      winnerTeamId: game.winner_team_id || null,
      actions: draftActions,
      picks,
    })
  }

  // Sort games by game number
  gameDrafts.sort((a, b) => a.gameNumber - b.gameNumber)

  drafts.push({
    seriesId: series.series_id,
    event: series.event,
    stage: series.stage,
    scheduledStart: series.scheduled_start,
    teamIds,
    games: gameDrafts,
  })
}

// Sort drafts by scheduled start
drafts.sort((a, b) => a.scheduledStart.localeCompare(b.scheduledStart))

// Task 2c: Detect roles from match file player positions
console.log('Detecting roles from match file positions...')

interface PlayerPosition {
  x: number
  y: number
}

interface PlayerRoleData {
  playerId: string
  name: string
  teamId: string
  side: string
  positions: PlayerPosition[]
}

// Collect player positions at 150-300s after game start from all match files
const playerPositionsByGame = new Map<string, Map<string, PlayerRoleData>>()
const endGameStats = new Map<string, Map<string, { minionKills: number }>>()

for (const series of lolSeries) {
  const matchPath = resolve(dataDir, series.file)
  if (!existsSync(matchPath)) continue

  try {
    let gameStartedAt: string | null = null
    let currentGameId: string | null = null

    for await (const line of readJsonlZst(matchPath)) {
      const events = (line as any).events || []
      for (const ev of events) {
        if (ev.type === 'series-started-game') {
          gameStartedAt = ev.target.state.startedAt
          currentGameId = ev.target.id as string
          playerPositionsByGame.set(currentGameId, new Map())
        }
        // Collect positions from player events
        if (ev.actor?.state?.game?.position && gameStartedAt && currentGameId) {
          const elapsed = (Date.parse(String((line as any).occurredAt)) - Date.parse(gameStartedAt)) / 1000
          if (elapsed >= 150 && elapsed <= 300) {
            const actor = ev.actor.state
            const gameMap = playerPositionsByGame.get(currentGameId)
            if (!gameMap) continue
            let pdata = gameMap.get(actor.id)
            if (!pdata) {
              pdata = { playerId: actor.id, name: actor.name, teamId: actor.teamId, side: actor.side, positions: [] }
              gameMap.set(actor.id, pdata)
            }
            pdata.positions.push({ x: actor.game.position.x, y: actor.game.position.y })
          }
        }
        // Collect end-of-game stats
        if (ev.type === 'tournament-ended-series' && ev.target?.state?.games) {
          for (const game of ev.target.state.games) {
            if (!playerPositionsByGame.has(game.id)) continue
            const statsMap = new Map<string, { minionKills: number }>()
            for (const team of game.teams) {
              for (const p of team.players) {
                let mk = 0
                if (Array.isArray(p.unitKills)) {
                  for (const uk of p.unitKills) {
                    if (uk.unitName === 'minion') mk += uk.count
                  }
                }
                statsMap.set(p.id, { minionKills: mk })
              }
            }
            endGameStats.set(game.id, statsMap)
          }
        }
      }
    }
  } catch (e) {
    // skip
  }
}

// Classify roles per team per game
function classifyRoles(
  players: PlayerRoleData[],
  gameId: string,
): Map<string, Role> | null {
  if (players.length !== 5) return null

  interface AvgPlayer {
    playerId: string
    name: string
    avgX: number
    avgY: number
    diff: number
  }

  const avgs: AvgPlayer[] = players.map(p => ({
    playerId: p.playerId,
    name: p.name,
    avgX: p.positions.reduce((s, v) => s + v.x, 0) / p.positions.length,
    avgY: p.positions.reduce((s, v) => s + v.y, 0) / p.positions.length,
    diff: 0,
  }))

  // Use x-y diff to separate lanes
  for (const a of avgs) a.diff = a.avgX - a.avgY
  const sorted = [...avgs].sort((a, b) => a.diff - b.diff)

  // Mid = closest to 0 diff
  const mid = sorted.reduce((best, p) => Math.abs(p.diff) < Math.abs(best.diff) ? p : best)
  const remaining = sorted.filter(p => p.playerId !== mid.playerId)

  const neg = remaining.filter(p => p.diff < 0)
  const pos = remaining.filter(p => p.diff > 0)

  let duo: AvgPlayer[], soloGroup: AvgPlayer[], topPlayer: AvgPlayer | null = null

  if (neg.length === 2 && pos.length === 2) {
    const negSpread = neg[1].diff - neg[0].diff
    const posSpread = pos[1].diff - pos[0].diff
    duo = negSpread < posSpread ? neg : pos
    soloGroup = negSpread < posSpread ? pos : neg
  } else if (neg.length === 3 && pos.length === 1) {
    topPlayer = pos[0]
    neg.sort((a, b) => a.diff - b.diff)
    if (Math.abs(neg[0].diff - neg[1].diff) < Math.abs(neg[1].diff - neg[2].diff)) {
      duo = [neg[0], neg[1]]
      soloGroup = [neg[2]]
    } else {
      duo = [neg[1], neg[2]]
      soloGroup = [neg[0]]
    }
  } else if (pos.length === 3 && neg.length === 1) {
    topPlayer = neg[0]
    pos.sort((a, b) => a.diff - b.diff)
    if (Math.abs(pos[0].diff - pos[1].diff) < Math.abs(pos[1].diff - pos[2].diff)) {
      duo = [pos[0], pos[1]]
      soloGroup = [pos[2]]
    } else {
      duo = [pos[1], pos[2]]
      soloGroup = [pos[0]]
    }
  } else {
    return null // Can't classify
  }

  const top = topPlayer || soloGroup.reduce((best, p) => Math.abs(p.diff) > Math.abs(best.diff) ? p : best)
  const jungler = soloGroup.filter(p => p.playerId !== top.playerId)[0]
  if (!jungler) return null

  // Split duo by minion kills
  const stats = endGameStats.get(gameId)
  const statsA = stats?.get(duo[0].playerId) || { minionKills: 0 }
  const statsB = stats?.get(duo[1].playerId) || { minionKills: 0 }
  const bot = statsA.minionKills >= statsB.minionKills ? duo[0] : duo[1]
  const support = statsA.minionKills >= statsB.minionKills ? duo[1] : duo[0]

  const roles = new Map<string, Role>()
  roles.set(top.playerId, 'top')
  roles.set(jungler.playerId, 'jungle')
  roles.set(mid.playerId, 'mid')
  roles.set(bot.playerId, 'bot')
  roles.set(support.playerId, 'support')
  return roles
}

// Aggregate roles per player across all games
const playerRoleCounts = new Map<string, Map<Role, number>>()
let totalTeamGames = 0
let fiveDistinctRoles = 0

for (const [gameId, gamePlayers] of playerPositionsByGame) {
  const bySide = new Map<string, PlayerRoleData[]>()
  for (const p of gamePlayers.values()) {
    const list = bySide.get(p.side) ?? []
    list.push(p)
    bySide.set(p.side, list)
  }

  for (const [, players] of bySide) {
    if (players.length !== 5) continue
    totalTeamGames++

    const roles = classifyRoles(players, gameId)
    if (!roles) continue

    const distinctRoles = new Set(roles.values())
    if (distinctRoles.size === 5) fiveDistinctRoles++

    for (const [playerId, role] of roles) {
      let roleMap = playerRoleCounts.get(playerId)
      if (!roleMap) {
        roleMap = new Map()
        playerRoleCounts.set(playerId, roleMap)
      }
      roleMap.set(role, (roleMap.get(role) ?? 0) + 1)
    }
  }
}

// Assign each player their most frequent role (only if >= 80% agreement)
const playerRole = new Map<string, Role | null>()
const unclearPlayers: string[] = []

for (const [playerId, roleMap] of playerRoleCounts) {
  const totalGames = [...roleMap.values()].reduce((s, v) => s + v, 0)
  let maxRole: Role | null = null
  let maxCount = 0
  for (const [role, count] of roleMap) {
    if (count > maxCount) {
      maxCount = count
      maxRole = role
    }
  }
  if (maxRole && maxCount / totalGames >= 0.8) {
    playerRole.set(playerId, maxRole)
  } else {
    playerRole.set(playerId, null)
    if (totalGames >= 2) unclearPlayers.push(playerId)
  }
}

console.log(`  Team-games with positions: ${totalTeamGames}`)
console.log(`  Team-games with 5 distinct roles: ${fiveDistinctRoles}`)
console.log(`  Share: ${(fiveDistinctRoles / totalTeamGames * 100).toFixed(1)}%`)
console.log(`  Players with clear role: ${[...playerRole.entries()].filter(([, r]) => r !== null).length}`)
console.log(`  Players with unclear role: ${unclearPlayers.length}`)

// Task 6: Write output
console.log('Writing output...')

const outputDir = resolve(import.meta.dirname, '../../app/public/data')
mkdirSync(outputDir, { recursive: true })

// Build team and champion refs from the games/rosters data
const teamRefMap = new Map<string, string>()
for (const g of games) {
  teamRefMap.set(g.team1_id, g.team1_name)
  teamRefMap.set(g.team2_id, g.team2_name)
}

const championRefMap = new Map<string, string>()
const playerRefMap = new Map<string, string>()
for (const r of rosters) {
  if (r.participation_status === 'active' && r.character_id) {
    championRefMap.set(r.character_id, r.character_name)
    playerRefMap.set(r.player_id, r.player_name)
  }
}

const totalGames = drafts.reduce((sum, d) => sum + d.games.length, 0)

const manifest: Manifest = {
  generatedAt: new Date().toISOString(),
  seriesCount: drafts.length,
  gameCount: totalGames,
  teams: [...teamRefMap.entries()].map(([id, name]) => ({ id, name })),
  champions: [...championRefMap.entries()].map(([id, name]) => ({ id, name })),
  players: [...playerRefMap.entries()].map(([id, name]) => ({
    id, name, role: playerRole.get(id) ?? null,
  })),
}

writeFileSync(resolve(outputDir, 'manifest.json'), JSON.stringify(manifest))

// Write series-index.json
const seriesIndex: SeriesIndexEntry[] = []
for (const draft of drafts) {
  // Find winner: the team that won the series (most games)
  let winnerTeamId: string | null = null
  const teamWins = new Map<string, number>()
  for (const game of draft.games) {
    if (game.winnerTeamId) {
      teamWins.set(game.winnerTeamId, (teamWins.get(game.winnerTeamId) ?? 0) + 1)
    }
  }
  for (const teamId of draft.teamIds) {
    if (!winnerTeamId || (teamWins.get(teamId) ?? 0) > (teamWins.get(winnerTeamId) ?? 0)) {
      winnerTeamId = teamId
    }
  }
  // If tied, no winner
  if (draft.teamIds[0] && draft.teamIds[1]) {
    const wins0 = teamWins.get(draft.teamIds[0]) ?? 0
    const wins1 = teamWins.get(draft.teamIds[1]) ?? 0
    if (wins0 === wins1) winnerTeamId = null
    else if (wins0 > wins1) winnerTeamId = draft.teamIds[0]
    else winnerTeamId = draft.teamIds[1]
  }

  seriesIndex.push({
    seriesId: draft.seriesId,
    scheduledStart: draft.scheduledStart,
    event: draft.event,
    stage: draft.stage,
    teamIds: draft.teamIds,
    gameCount: draft.games.length,
    winnerTeamId,
  })
}
writeFileSync(resolve(outputDir, 'series-index.json'), JSON.stringify(seriesIndex))

// Write compact picks.json
const seriesIdList: string[] = []
const seriesIdIdx = new Map<string, number>()
const teamIdList: string[] = []
const teamIdIdx = new Map<string, number>()
const playerIdList: string[] = []
const playerIdIdx = new Map<string, number>()
const championIdList: string[] = []
const championIdIdx = new Map<string, number>()

function getIdx(list: string[], map: Map<string, number>, id: string) {
  let idx = map.get(id)
  if (idx === undefined) {
    idx = list.length
    list.push(id)
    map.set(id, idx)
  }
  return idx
}

const compactRows: number[][] = []
for (const draft of drafts) {
  const si = getIdx(seriesIdList, seriesIdIdx, draft.seriesId)
  for (const game of draft.games) {
    const won = game.winnerTeamId ?? ''
    for (const pick of game.picks) {
      const ti = getIdx(teamIdList, teamIdIdx, pick.teamId)
      const pi = getIdx(playerIdList, playerIdIdx, pick.playerId)
      const ci = getIdx(championIdList, championIdIdx, pick.championId)
      compactRows.push([si, game.gameNumber, ti, pi, ci, pick.teamId === won ? 1 : 0])
    }
  }
}

const compactPicks: CompactPicks = {
  series: seriesIdList,
  teams: teamIdList,
  players: playerIdList,
  champions: championIdList,
  rows: compactRows,
}
writeFileSync(resolve(outputDir, 'picks.json'), JSON.stringify(compactPicks))

// Write individual series files
for (const draft of drafts) {
  const file = resolve(outputDir, `${draft.seriesId}.json`)
  writeFileSync(file, JSON.stringify(draft))
}

// Calculate output size
let totalSize = 0
for (const draft of drafts) {
  totalSize += Buffer.byteLength(JSON.stringify(draft))
}
totalSize += Buffer.byteLength(JSON.stringify(manifest))
totalSize += Buffer.byteLength(JSON.stringify(seriesIndex))
totalSize += Buffer.byteLength(JSON.stringify(compactPicks))

// Count draft action completeness
let gamesWith20Actions = 0
let gamesWithPartialActions = 0
let gamesWithNoActions = 0
for (const draft of drafts) {
  for (const game of draft.games) {
    if (game.actions.length === 0) {
      gamesWithNoActions++
    } else if (game.actions.length < 20) {
      gamesWithPartialActions++
    } else {
      gamesWith20Actions++
    }
  }
}

const elapsed = ((performance.now() - start) / 1000).toFixed(1)

console.log(`\nOutput:`)
console.log(`  Series: ${drafts.length}`)
console.log(`  Games: ${totalGames}`)
console.log(`  Games with 20 draft actions: ${gamesWith20Actions}`)
console.log(`  Games with partial draft actions: ${gamesWithPartialActions}`)
console.log(`  Games with no draft actions: ${gamesWithNoActions}`)
console.log(`  series-index.json: ${(Buffer.byteLength(JSON.stringify(seriesIndex)) / 1024).toFixed(1)} KB`)
console.log(`  picks.json (compact): ${(Buffer.byteLength(JSON.stringify(compactPicks)) / 1024).toFixed(1)} KB`)
console.log(`  manifest.json: ${(Buffer.byteLength(JSON.stringify(manifest)) / 1024).toFixed(1)} KB`)
console.log(`  Total output size: ${(totalSize / 1024 / 1024).toFixed(2)} MB`)
console.log(`  Run time: ${elapsed}s`)
console.log(`  Written to: ${outputDir}`)
