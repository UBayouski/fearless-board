// Builds the aggregate JSON the app loads, from a local clone of the hackathon data repo.
// The data repo lives next to this project, never inside it (see README).
import { existsSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import type { SeriesDraft, GameDraft, PlayerPick, Side, DraftAction, Manifest } from '@fearless-board/shared'
import {
  parseCSV,
  type GameRow,
  type RosterRow,
  type SeriesRow,
} from './csv.ts'
import { readJsonlZst } from './zst.ts'

const start = performance.now()

const dataDir = process.env.STL_DATA_DIR ?? resolve(import.meta.dirname, '../../../../stl-hackathon-2026-grid-starter')
const seriesIndex = resolve(dataDir, 'lol/series.csv')

if (!existsSync(seriesIndex)) {
  console.error(`Hackathon data not found at ${dataDir}`)
  console.error('Clone the data repo next to this project, or set STL_DATA_DIR. See README.md.')
  process.exit(1)
}

// Task 1: Read the index files
console.log('Reading index files...')

const games = parseCSV<GameRow>(resolve(dataDir, 'meta/games.csv')).filter(r => r.title === 'lol')
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

// Task 6: Write output
console.log('Writing output...')

const outputDir = resolve(import.meta.dirname, '../../app/public/data')
mkdirSync(outputDir, { recursive: true })

// Write manifest

// Build team and champion refs from the games/rosters data
const teamRefMap = new Map<string, string>()
for (const g of games) {
  teamRefMap.set(g.team1_id, g.team1_name)
  teamRefMap.set(g.team2_id, g.team2_name)
}

const championRefMap = new Map<string, string>()
for (const r of rosters) {
  if (r.participation_status === 'active' && r.character_id) {
    championRefMap.set(r.character_id, r.character_name)
  }
}

const totalGames = drafts.reduce((sum, d) => sum + d.games.length, 0)

const manifest: Manifest = {
  generatedAt: new Date().toISOString(),
  seriesCount: drafts.length,
  gameCount: totalGames,
  teams: [...teamRefMap.entries()].map(([id, name]) => ({ id, name })),
  champions: [...championRefMap.entries()].map(([id, name]) => ({ id, name })),
}

writeFileSync(resolve(outputDir, 'manifest.json'), JSON.stringify(manifest, null, 2))

// Write individual series files
for (const draft of drafts) {
  const file = resolve(outputDir, `${draft.seriesId}.json`)
  writeFileSync(file, JSON.stringify(draft, null, 2))
}

const elapsed = ((performance.now() - start) / 1000).toFixed(1)

// Calculate output size
let totalSize = 0
for (const draft of drafts) {
  totalSize += Buffer.byteLength(JSON.stringify(draft))
}
totalSize += Buffer.byteLength(JSON.stringify(manifest))

console.log(`\nOutput:`)
console.log(`  Series: ${drafts.length}`)
console.log(`  Games: ${totalGames}`)
console.log(`  Games with complete draft actions: ${gamesWithActions}`)
console.log(`  Output size: ${(totalSize / 1024 / 1024).toFixed(2)} MB`)
console.log(`  Run time: ${elapsed}s`)
console.log(`  Written to: ${outputDir}`)
