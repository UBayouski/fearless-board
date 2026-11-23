// Builds the aggregate JSON the app loads, from a local clone of the hackathon data repo.
// The data repo lives next to this project, never inside it (see README).
import { existsSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import type { SeriesDraft, GameDraft, PlayerPick, Side, DraftAction, Manifest, SeriesIndexEntry, CompactPicks, Role, PickRow, PickModel, PickExample } from '@fearless-board/shared'
import { backtest, pickFeatures, trainPickModel, pickLikelihoods, burnedChampions, playerPool, crediblePool, calibrateModel, backtestLeverage } from '@fearless-board/shared'
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

// Task 3 + 2e: Read match files once for draft actions AND role data
console.log('Reading match files (draft actions + role data)...')

interface DraftActionRaw {
  sequenceNumber: number
  type: 'pick' | 'ban'
  drafter: { id: string }
  draftable: { id: string }
}

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

// End-of-game player stats from series-ended-game events
interface EndGamePlayer {
  playerId: string
  name: string
  side: string
  slayCount: number // sum of completionCount for objectives whose type starts with 'slay'
  totalMoneyEarned: number
}

// Build draft actions map: game_id -> DraftAction[]
const actionsByGame = new Map<string, DraftAction[]>()
let seriesWithActions = 0
let gamesWithActions = 0
let gamesSkippedNotInCsv = 0

// Role data collected in the same pass
const playerPositionsByGame = new Map<string, Map<string, PlayerRoleData>>()
const endGamePlayersByGame = new Map<string, EndGamePlayer[]>()

for (const series of lolSeries) {
  const matchPath = resolve(dataDir, series.file)
  if (!existsSync(matchPath)) continue

  try {
    let gameStartedAt: string | null = null
    let currentGameId: string | null = null
    let foundDraftActions = false

    for await (const line of readJsonlZst(matchPath)) {
      const events = (line as any).events || []
      for (const ev of events) {
        // Draft actions from series-started-game
        if (ev.type === 'series-started-game') {
          gameStartedAt = ev.target.state.startedAt
          currentGameId = ev.target.id as string
          playerPositionsByGame.set(currentGameId, new Map())

          if (ev.target?.state?.draftActions) {
            foundDraftActions = true
            if (gamesBySeries.has(series.series_id)) {
              const gameInCsv = gamesBySeries.get(series.series_id)?.find(g => g.game_id === currentGameId)
              if (gameInCsv) {
                const actions: DraftAction[] = ev.target.state.draftActions.map((a: DraftActionRaw) => ({
                  order: a.sequenceNumber,
                  type: a.type,
                  teamId: a.drafter.id,
                  championId: a.draftable.id,
                }))
                actionsByGame.set(currentGameId, actions)
                gamesWithActions++
              } else {
                gamesSkippedNotInCsv++
              }
            }
          }
        }
        // Collect positions from player events (90-300s window, for bot/mid/top)
        if (ev.actor?.state?.game?.position && gameStartedAt && currentGameId) {
          const elapsed = (Date.parse(String((line as any).occurredAt)) - Date.parse(gameStartedAt)) / 1000
          if (elapsed >= 90 && elapsed <= 300) {
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
        // End-of-game data from series-ended-game (2e method)
        if (ev.type === 'series-ended-game' && ev.target?.state?.teams) {
          const gameId = ev.target.id as string
          const state = ev.target.state
          const players: EndGamePlayer[] = []
          for (const team of state.teams) {
            for (const p of team.players || []) {
              let slayCount = 0
              if (Array.isArray(p.objectives)) {
                for (const obj of p.objectives) {
                  if (obj.type && obj.type.startsWith('slay')) {
                    slayCount += obj.completionCount || 0
                  }
                }
              }
              players.push({
                playerId: p.id,
                name: p.name,
                side: team.side,
                slayCount,
                totalMoneyEarned: p.totalMoneyEarned ?? 0,
              })
            }
          }
          endGamePlayersByGame.set(gameId, players)
        }
      }
    }
    if (foundDraftActions) seriesWithActions++
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

// Task 2e: Classify roles using end-of-game objectives + money + positions
console.log('Classifying roles (2e method)...')

// Step 1-2: Jungle by slay objectives, support by lowest money
// Step 4-5: Bot/mid/top by position relative to support and map center
function classifyRoles2e(
  endPlayers: EndGamePlayer[],
  positions: Map<string, PlayerRoleData>,
): Map<string, Role> | null {
  if (endPlayers.length !== 5) return null

  // Step 1: Jungle = most neutral-monster objectives (slay*)
  const sortedBySlay = [...endPlayers].sort((a, b) => b.slayCount - a.slayCount)
  const jungler = sortedBySlay[0]
  // Verify: top player has at least twice the count of the next
  if (jungler.slayCount < 2 * sortedBySlay[1].slayCount) {
    // Still assign, but note it's weak
  }

  // Step 2: Support = lowest totalMoneyEarned among the other four
  const nonJungle = endPlayers.filter(p => p.playerId !== jungler.playerId)
  const support = nonJungle.reduce((best, p) =>
    p.totalMoneyEarned < best.totalMoneyEarned ? p : best
  )

  // Steps 4-5: Bot, Mid, Top from positions
  const remaining = nonJungle.filter(p => p.playerId !== support.playerId)
  if (remaining.length !== 3) return null

  const supportPos = positions.get(support.playerId)
  if (!supportPos || supportPos.positions.length === 0) return null

  const avgSupportX = supportPos.positions.reduce((s, v) => s + v.x, 0) / supportPos.positions.length
  const avgSupportY = supportPos.positions.reduce((s, v) => s + v.y, 0) / supportPos.positions.length

  function distToSupport(playerId: string): number {
    const pos = positions.get(playerId)
    if (!pos || pos.positions.length === 0) return Infinity
    const avgX = pos.positions.reduce((s, v) => s + v.x, 0) / pos.positions.length
    const avgY = pos.positions.reduce((s, v) => s + v.y, 0) / pos.positions.length
    return Math.sqrt((avgX - avgSupportX) ** 2 + (avgY - avgSupportY) ** 2)
  }

  function distToCenter(playerId: string): number {
    const pos = positions.get(playerId)
    if (!pos || pos.positions.length === 0) return Infinity
    const avgX = pos.positions.reduce((s, v) => s + v.x, 0) / pos.positions.length
    const avgY = pos.positions.reduce((s, v) => s + v.y, 0) / pos.positions.length
    const mapCenter = { x: 8150, y: 8150 }
    return Math.sqrt((avgX - mapCenter.x) ** 2 + (avgY - mapCenter.y) ** 2)
  }

  // Step 4: Bot = closest to support
  const bot = remaining.reduce((best, p) =>
    distToSupport(p.playerId) < distToSupport(best.playerId) ? p : best
  )

  // Step 5: Mid = closer to map center among remaining two
  const afterBot = remaining.filter(p => p.playerId !== bot.playerId)
  if (afterBot.length !== 2) return null

  const mid = afterBot.reduce((best, p) =>
    distToCenter(p.playerId) < distToCenter(best.playerId) ? p : best
  )
  const top = afterBot.find(p => p.playerId !== mid.playerId)
  if (!top) return null

  const roles = new Map<string, Role>()
  roles.set(jungler.playerId, 'jungle')
  roles.set(support.playerId, 'support')
  roles.set(bot.playerId, 'bot')
  roles.set(mid.playerId, 'mid')
  roles.set(top.playerId, 'top')
  return roles
}

// Aggregate roles per player across all games
const playerRoleCounts = new Map<string, Map<Role, number>>()
let totalTeamGames = 0
let jungleClearGames = 0 // team-games where slay top has 2x next
let classifiedGames = 0 // team-games where classifier produced all 5 roles

// Build a lookup: end game players by side
for (const [gameId, endPlayers] of endGamePlayersByGame) {
  const positions = playerPositionsByGame.get(gameId)
  if (!positions) continue

  const bySide = new Map<string, EndGamePlayer[]>()
  for (const p of endPlayers) {
    const list = bySide.get(p.side) ?? []
    list.push(p)
    bySide.set(p.side, list)
  }

  for (const [, sidePlayers] of bySide) {
    if (sidePlayers.length !== 5) continue
    totalTeamGames++

    // Check jungle clarity: top slay >= 2 * second
    const sortedBySlay = [...sidePlayers].sort((a, b) => b.slayCount - a.slayCount)
    if (sortedBySlay[0].slayCount >= 2 * sortedBySlay[1].slayCount) {
      jungleClearGames++
    }

    const roles = classifyRoles2e(sidePlayers, positions)
    if (!roles) continue
    classifiedGames++

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

// Assign each player their most frequent role (>= 80% agreement, or majority for exceptions)
const playerRole = new Map<string, Role | null>()
const unclearPlayers: { playerId: string; games: number; roles: { role: Role; count: number }[] }[] = []

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
    // 2e says: give Malrang and the two others their majority role
    // We'll assign majority role to all players with <80% agreement
    if (maxRole) {
      playerRole.set(playerId, maxRole)
    } else {
      playerRole.set(playerId, null)
    }
    if (totalGames >= 2) {
      unclearPlayers.push({
        playerId,
        games: totalGames,
        roles: [...roleMap.entries()].map(([role, count]) => ({ role, count })),
      })
    }
  }
}

// Measure: share of team-games where majority roles are 5 distinct roles
let fiveDistinctMajority = 0
for (const [, endPlayers] of endGamePlayersByGame) {
  const bySide = new Map<string, EndGamePlayer[]>()
  for (const p of endPlayers) {
    const list = bySide.get(p.side) ?? []
    list.push(p)
    bySide.set(p.side, list)
  }
  for (const [, sidePlayers] of bySide) {
    if (sidePlayers.length !== 5) continue
    const roles = new Set<Role | null>()
    for (const p of sidePlayers) {
      roles.add(playerRole.get(p.playerId) ?? null)
    }
    if (!roles.has(null) && roles.size === 5) fiveDistinctMajority++
  }
}

// Report the four measurements from 2e
console.log(`  Measurement 1: team-games where jungle is clear (top slay >= 2x next): ${jungleClearGames} / ${totalTeamGames} = ${(jungleClearGames / totalTeamGames * 100).toFixed(1)}%`)
console.log(`  Team-games classified (all 5 roles): ${classifiedGames} / ${totalTeamGames} = ${(classifiedGames / totalTeamGames * 100).toFixed(1)}%`)

// Players per role
const roleCounts = new Map<Role, number>()
for (const [, role] of playerRole) {
  if (role) roleCounts.set(role, (roleCounts.get(role) ?? 0) + 1)
}
console.log(`  Measurement 2: players per role:`)
for (const role of ['top', 'jungle', 'mid', 'bot', 'support'] as Role[]) {
  console.log(`    ${role}: ${roleCounts.get(role) ?? 0}`)
}
console.log(`  Players with null role: ${[...playerRole.values()].filter(r => r === null).length}`)

console.log(`  Measurement 3: team-games with 5 distinct majority roles: ${fiveDistinctMajority} / ${totalTeamGames} = ${(fiveDistinctMajority / totalTeamGames * 100).toFixed(1)}%`)

console.log(`  Measurement 4: players with <80% agreement: ${unclearPlayers.length}`)

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

// Show unclear players with names (now that playerRefMap is built)
if (unclearPlayers.length > 0) {
  console.log('  Unclear players (<80% agreement):')
  for (const uc of unclearPlayers.slice(0, 20)) {
    const name = playerRefMap.get(uc.playerId) ?? uc.playerId
    const roleStr = uc.roles.map(r => `${r.role}:${r.count}`).join(', ')
    console.log(`    ${name} (${uc.games} games): ${roleStr}`)
  }
  if (unclearPlayers.length > 20) {
    console.log(`    ... and ${unclearPlayers.length - 20} more`)
  }
}

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

// ── Section 5: Backtest ────────────────────────────────────────────────

console.log('Running backtest...')

// Build PickRow array from all drafts
const allPicks: PickRow[] = []
for (const draft of drafts) {
  for (const game of draft.games) {
    const won = game.winnerTeamId ?? ''
    for (const pick of game.picks) {
      allPicks.push({
        scheduledStart: draft.scheduledStart,
        seriesId: draft.seriesId,
        gameNumber: game.gameNumber,
        teamId: pick.teamId,
        playerId: pick.playerId,
        championId: pick.championId,
        won: pick.teamId === won,
      })
    }
  }
}

const { games: backtestGames, summary: backtestSummary } = backtest(drafts, allPicks)

// ── Section 2: Pick likelihood model ──────────────────────────────────

console.log('Building pick likelihood model...')

const splitDate = '2026-01-01'

// ── Optimization: index picks by player once ──────────────────────────

// Index: playerId -> PickRow[] sorted by scheduledStart
const picksByPlayer = new Map<string, PickRow[]>()
for (const p of allPicks) {
  let list = picksByPlayer.get(p.playerId)
  if (!list) {
    list = []
    picksByPlayer.set(p.playerId, list)
  }
  list.push(p)
}
for (const [, list] of picksByPlayer) {
  list.sort((a, b) => a.scheduledStart.localeCompare(b.scheduledStart))
}

// ── Build examples once for all series ────────────────────────────────

// For each series, pre-compute: allChampionIds, roleCounts, rolePicks45/All per role
// Then build examples for every game in every series

interface SeriesMeta {
  allChampionIds: Set<string>
  rolePicks45: Map<Role, Map<string, number>>
  rolePicksAll: Map<Role, Map<string, number>>
  totalRole45: Map<Role, number>
  totalRoleAll: Map<Role, number>
}

const seriesMeta = new Map<string, SeriesMeta>()
const allExamplesList: { example: PickExample; seriesDate: string; gameNumber: number; priorGames: number }[] = []

for (const draft of drafts) {
  const seriesDate = draft.scheduledStart

  // Build allChampionIds: every champion picked in any series before this one
  const allChampionIds = new Set<string>()
  for (const p of allPicks) {
    if (p.scheduledStart < seriesDate) {
      allChampionIds.add(p.championId)
    }
  }

  // Skip if fewer than 80 champions have appeared (per spec)
  if (allChampionIds.size < 80) {
    seriesMeta.set(draft.seriesId, { allChampionIds, rolePicks45: new Map(), rolePicksAll: new Map(), totalRole45: new Map(), totalRoleAll: new Map() })
    continue
  }

  // Build role-level pick counts for this series
  const cutoff45 = Date.parse(seriesDate) - 45 * 24 * 60 * 60 * 1000
  const rolePicks45Map = new Map<Role, Map<string, number>>()
  const rolePicksAllMap = new Map<Role, Map<string, number>>()
  const totalRole45Map = new Map<Role, number>()
  const totalRoleAllMap = new Map<Role, number>()

  for (const role of ['top', 'jungle', 'mid', 'bot', 'support'] as Role[]) {
    const p45 = new Map<string, number>()
    const pAll = new Map<string, number>()
    let t45 = 0, tAll = 0

    for (const p of allPicks) {
      if (p.scheduledStart >= seriesDate) continue
      const pr = playerRole.get(p.playerId)
      if (pr !== role) continue

      const c = p.championId
      pAll.set(c, (pAll.get(c) ?? 0) + 1)
      tAll++
      if (Date.parse(p.scheduledStart) >= cutoff45) {
        p45.set(c, (p45.get(c) ?? 0) + 1)
        t45++
      }
    }

    rolePicks45Map.set(role, p45)
    rolePicksAllMap.set(role, pAll)
    totalRole45Map.set(role, t45)
    totalRoleAllMap.set(role, tAll)
  }

  seriesMeta.set(draft.seriesId, { allChampionIds, rolePicks45: rolePicks45Map, rolePicksAll: rolePicksAllMap, totalRole45: totalRole45Map, totalRoleAll: totalRoleAllMap })

  // For each game in this series, build examples for each pick
  for (const game of draft.games) {
    const burned = burnedChampions(draft.games, game.gameNumber)

    for (const pick of game.picks) {
      const role = playerRole.get(pick.playerId)
      if (!role) continue

      const meta = seriesMeta.get(draft.seriesId)
      if (!meta) continue

      const candidates = pickFeatures(
        pick.playerId,
        seriesDate,
        allPicks,
        burned,
        meta.rolePicks45.get(role) ?? new Map(),
        meta.rolePicksAll.get(role) ?? new Map(),
        meta.totalRole45.get(role) ?? 0,
        meta.totalRoleAll.get(role) ?? 0,
        allChampionIds,
      )

      if (candidates.length === 0) continue

      // Count prior games for this player
      const playerPicks = picksByPlayer.get(pick.playerId) ?? []
      let priorGames = 0
      for (const pp of playerPicks) {
        if (pp.scheduledStart < seriesDate) priorGames++
      }

      allExamplesList.push({
        example: {
          playerId: pick.playerId,
          role,
          seriesDate,
          candidates,
          actualChampionId: pick.championId,
        },
        seriesDate,
        gameNumber: game.gameNumber,
        priorGames,
      })
    }
  }
}

// Split examples at the split date
const trainExamples = allExamplesList.filter(e => e.seriesDate < splitDate).map(e => e.example)
const evalExamples = allExamplesList.filter(e => e.seriesDate >= splitDate)

console.log(`  Training examples: ${trainExamples.length}`)
console.log(`  Evaluation examples: ${evalExamples.length}`)

// Train model on pre-2026 data
console.log('  Training model...')
const trainStart = performance.now()
const evalModel = trainPickModel(trainExamples)
const trainElapsed = ((performance.now() - trainStart) / 1000).toFixed(1)
console.log(`  Training time: ${trainElapsed}s`)
console.log(`  Weights: [${evalModel.weights.map(w => w.toFixed(4)).join(', ')}]`)
console.log(`  Training log-likelihood: ${evalModel.meanLogLikelihood.toFixed(4)} (${evalModel.iterations} iterations)`)

// ── Evaluate model on 2026+ data ──────────────────────────────────────

function evaluateModelOnExamples(model: PickModel, examples: typeof evalExamples) {
  const groups: {
    name: string
    picks: number
    model: { top1: number; top3: number; top5: number; top10: number }
    gamesPlayed: { top1: number; top3: number; top5: number; top10: number }
  }[] = []

  // Three groups: (1) all eval picks, (2) games 2+, (3) games 2+ with 20+ prior games
  type GroupFilter = (e: typeof evalExamples[0]) => boolean
  const groupDefs: { name: string; filter: GroupFilter }[] = [
    { name: 'all', filter: () => true },
    { name: 'games 2+', filter: e => e.gameNumber >= 2 },
    { name: 'games 2+, 20+ prior games', filter: e => e.gameNumber >= 2 && e.priorGames >= 20 },
  ]

  for (const { name, filter } of groupDefs) {
    const filtered = examples.filter(filter)
    if (filtered.length === 0) continue

    let top1 = 0, top3 = 0, top5 = 0, top10 = 0
    let gpTop1 = 0, gpTop3 = 0, gpTop5 = 0, gpTop10 = 0

    for (const item of filtered) {
      const { example } = item

      // Model evaluation
      const likelihoods = pickLikelihoods(model, example.candidates)
      const actualRank = likelihoods.findIndex(l => l.championId === example.actualChampionId) + 1

      if (actualRank >= 1 && actualRank <= 1) top1++
      if (actualRank >= 1 && actualRank <= 3) top3++
      if (actualRank >= 1 && actualRank <= 5) top5++
      if (actualRank >= 1 && actualRank <= 10) top10++

      // Games played evaluation: use playerPool + crediblePool (board's ranking)
      const pool = playerPool(allPicks, example.playerId, example.seriesDate)
      const series = drafts.find(d => d.scheduledStart === example.seriesDate)
      if (series) {
        const game = series.games.find(g => g.gameNumber === item.gameNumber)
        if (game) {
          const burned = burnedChampions(series.games, game.gameNumber)
          const { credible: cred } = crediblePool(pool, burned)
          const gpRank = cred.findIndex((e) => e.championId === example.actualChampionId) + 1

          if (gpRank >= 1 && gpRank <= 1) gpTop1++
          if (gpRank >= 1 && gpRank <= 3) gpTop3++
          if (gpRank >= 1 && gpRank <= 5) gpTop5++
          if (gpRank >= 1 && gpRank <= 10) gpTop10++
        }
      }
    }

    const n = filtered.length
    const pct = (v: number) => Math.round(v / n * 1000) / 10

    groups.push({
      name,
      picks: n,
      model: { top1: pct(top1), top3: pct(top3), top5: pct(top5), top10: pct(top10) },
      gamesPlayed: { top1: pct(gpTop1), top3: pct(gpTop3), top5: pct(gpTop5), top10: pct(gpTop10) },
    })
  }

  return groups
}

const modelGroups = evaluateModelOnExamples(evalModel, evalExamples)

console.log('\n  Model evaluation (2026+ games):')
for (const g of modelGroups) {
  console.log(`  ${g.name} (${g.picks} picks):`)
  console.log(`    Model       — Top 1: ${g.model.top1}%, Top 3: ${g.model.top3}%, Top 5: ${g.model.top5}%, Top 10: ${g.model.top10}%`)
  console.log(`    Games played — Top 1: ${g.gamesPlayed.top1}%, Top 3: ${g.gamesPlayed.top3}%, Top 5: ${g.gamesPlayed.top5}%, Top 10: ${g.gamesPlayed.top10}%`)
}

// Train final model on all data
console.log('\n  Training final model on all data...')
const allExamples = allExamplesList.map(e => e.example)
console.log(`  All examples: ${allExamples.length}`)
const finalModel = trainPickModel(allExamples)
console.log(`  Final weights: [${finalModel.weights.map(w => w.toFixed(4)).join(', ')}]`)
console.log(`  Final log-likelihood: ${finalModel.meanLogLikelihood.toFixed(4)} (${finalModel.iterations} iterations)`)

// Write model.json
writeFileSync(resolve(outputDir, 'model.json'), JSON.stringify(finalModel))

// ── Attach roleCounts and championsSeen to in-memory drafts AND write series files ──

console.log('Attaching role counts to series and writing files...')
for (const draft of drafts) {
  const meta = seriesMeta.get(draft.seriesId)
  if (!meta) continue

  // Build roleCounts object for this series
  const roleCountsObj: Record<string, { total45: number; totalAll: number; champions: Record<string, [number, number]> }> = {}
  for (const role of ['top', 'jungle', 'mid', 'bot', 'support'] as Role[]) {
    const p45 = meta.rolePicks45.get(role)
    const pAll = meta.rolePicksAll.get(role)
    if (!p45 && !pAll) continue

    const champsObj: Record<string, [number, number]> = {}
    // Merge champions from both maps
    const allChampIds = new Set<string>()
    if (p45) for (const c of p45.keys()) allChampIds.add(c)
    if (pAll) for (const c of pAll.keys()) allChampIds.add(c)
    for (const champId of allChampIds) {
      const n45 = p45?.get(champId) ?? 0
      const nAll = pAll?.get(champId) ?? 0
      champsObj[champId] = [n45, nAll]
    }
    roleCountsObj[role] = {
      total45: meta.totalRole45.get(role) ?? 0,
      totalAll: meta.totalRoleAll.get(role) ?? 0,
      champions: champsObj,
    }
  }

  // Attach to in-memory draft so backtestLeverage can read them
  draft.roleCounts = roleCountsObj
  draft.championsSeen = [...meta.allChampionIds]

  // Write series file once (with roleCounts and championsSeen already attached)
  const file = resolve(outputDir, `${draft.seriesId}.json`)
  writeFileSync(file, JSON.stringify(draft))
}

// ── Section 3a: Calibration ────────────────────────────────────────────

console.log('\nRunning calibration...')
const calibration = calibrateModel(evalModel, evalExamples.map(e => e.example))
console.log('  Calibration table:')
console.log('  ' + ['Bin', 'Count', 'Mean Pred', 'Actual Rate'].join('  '))
for (const bin of calibration) {
  console.log(`  ${bin.label.padEnd(6)} ${String(bin.count).padEnd(8)} ${bin.meanPredicted.toFixed(1)}%       ${bin.actualPickRate.toFixed(1)}%`)
}

// Compute test log-likelihood
let testLL = 0
let testLLCount = 0
for (const item of evalExamples) {
  const likelihoods = pickLikelihoods(evalModel, item.example.candidates)
  const actual = likelihoods.find(l => l.championId === item.example.actualChampionId)
  if (actual) {
    testLL += Math.log(actual.probability)
    testLLCount++
  }
}
const testMeanLL = testLLCount > 0 ? testLL / testLLCount : 0
console.log(`\n  Test log-likelihood: ${testMeanLL.toFixed(4)} (${testLLCount} examples)`)

// ── Section 2: Ban leverage backtest ────────────────────────────────────

console.log('\nRunning ban leverage backtest...')

// Filter to test period series only (2026+)
const testSeries = drafts.filter(d => d.scheduledStart >= splitDate)
console.log(`  Test series: ${testSeries.length}`)

const leverageResult = backtestLeverage(
  testSeries,
  allPicks,
  evalModel,
  playerRole,
)

console.log('  Ban leverage backtest:')
for (const group of [leverageResult.all, leverageResult.games2Plus]) {
  console.log(`  ${group.name} (${group.bans} bans):`)
  console.log(`    Leverage  — Top 5: ${group.leverageTop5}%, Top 8: ${group.leverageTop8}%`)
  console.log(`    Threat    — Top 5: ${group.threatTop5}%, Top 8: ${group.threatTop8}%`)
  console.log(`    Meta      — Top 5: ${group.metaTop5}%, Top 8: ${group.metaTop8}%`)
}

// Write backtest.json with model results
const backtestOutput = {
  generatedAt: new Date().toISOString(),
  seriesCount: drafts.length,
  gameCount: backtestGames.length,
  summary: backtestSummary,
  model: {
    split: splitDate,
    trainingLogLikelihood: evalModel.meanLogLikelihood,
    testLogLikelihood: testMeanLL,
    groups: modelGroups,
    calibration,
  },
  leverage: leverageResult,
}
writeFileSync(resolve(outputDir, 'backtest.json'), JSON.stringify(backtestOutput))

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
console.log(`\nBacktest:`)
console.log(`  Games analyzed: ${backtestGames.length}`)
console.log(`  Total picks: ${backtestSummary.totalPicks}`)
console.log(`  Total picks (20+ prior games): ${backtestSummary.totalPicks20}`)
console.log(`  In pool: ${backtestSummary.inPool}%`)
console.log(`  In top 3: ${backtestSummary.inTop3}%`)
console.log(`  In top 5: ${backtestSummary.inTop5}%`)
console.log(`  In pool (20+): ${backtestSummary.inPool20}%`)
console.log(`  In top 3 (20+): ${backtestSummary.inTop320}%`)
console.log(`  In top 5 (20+): ${backtestSummary.inTop520}%`)
console.log(`\nModel (2026+ evaluation):`)
console.log(`  Weights: [${evalModel.weights.map(w => w.toFixed(4)).join(', ')}]`)
console.log(`  Training log-likelihood: ${evalModel.meanLogLikelihood.toFixed(4)}`)
console.log(`  Test log-likelihood: ${testMeanLL.toFixed(4)}`)
for (const g of modelGroups) {
  console.log(`  ${g.name} (${g.picks} picks):`)
  console.log(`    Model       — Top 1: ${g.model.top1}%, Top 3: ${g.model.top3}%, Top 5: ${g.model.top5}%, Top 10: ${g.model.top10}%`)
  console.log(`    Games played — Top 1: ${g.gamesPlayed.top1}%, Top 3: ${g.gamesPlayed.top3}%, Top 5: ${g.gamesPlayed.top5}%, Top 10: ${g.gamesPlayed.top10}%`)
}
console.log(`  Run time: ${elapsed}s`)
console.log(`  Written to: ${outputDir}`)
