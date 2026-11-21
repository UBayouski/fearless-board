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
