// Build the demo data folder from the full pipeline output.
// Reads packages/app/public/data/ and writes packages/app/public/data-demo/.

import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import type {
  Manifest, SeriesIndexEntry, CompactPicks, SeriesDraft, PickModel,
  PickRow, Role, EncodedPlan,
} from '@fearless-board/shared'
import { gamePlan, decodeCompactPicks, encodePlan } from '@fearless-board/shared'
import { selectFeatured } from './featured.ts'

const start = performance.now()

const fullDataDir = resolve(import.meta.dirname, '../../app/public/data')
const demoDataDir = resolve(import.meta.dirname, '../../app/public/data-demo')

// Check full output exists
const requiredFiles = ['manifest.json', 'series-index.json', 'picks.json', 'model.json', 'backtest.json']
for (const f of requiredFiles) {
  if (!existsSync(resolve(fullDataDir, f))) {
    console.error(`Missing ${f} in ${fullDataDir}. Run pnpm data first.`)
    process.exit(1)
  }
}

// Read full output
const manifest = JSON.parse(readFileSync(resolve(fullDataDir, 'manifest.json'), 'utf8')) as Manifest
const seriesIndex = JSON.parse(readFileSync(resolve(fullDataDir, 'series-index.json'), 'utf8')) as SeriesIndexEntry[]
const compactPicks = JSON.parse(readFileSync(resolve(fullDataDir, 'picks.json'), 'utf8')) as CompactPicks
const model = JSON.parse(readFileSync(resolve(fullDataDir, 'model.json'), 'utf8')) as PickModel
const backtest = readFileSync(resolve(fullDataDir, 'backtest.json'), 'utf8')

const allPicks = decodeCompactPicks(compactPicks)
// The compact rows carry no date. Without it every game counts as "earlier", and the plans would use
// games played after the series. The app adds the date the same way after loading.
const seriesStart = new Map(seriesIndex.map((e) => [e.seriesId, e.scheduledStart]))
for (const pick of allPicks) {
  const start = seriesStart.get(pick.seriesId)
  if (!start) throw new Error(`Pick row of series ${pick.seriesId} has no entry in series-index.json`)
  pick.scheduledStart = start
}

// Select featured series
const featured = selectFeatured(seriesIndex, allPicks)
console.log(`Featured series: ${featured.length}`)
for (const f of featured) {
  const teamNames = f.teamIds.map(id => manifest.teams.find(t => t.id === id)?.name ?? id).join(' vs ')
  console.log(`  ${f.scheduledStart} ${f.event} — ${teamNames} (${f.gameCount} games)`)
}

// Build sets of featured teams and players
const featuredTeamIds = new Set<string>()
const featuredPlayerIds = new Set<string>()
for (const f of featured) {
  featuredTeamIds.add(f.teamIds[0])
  featuredTeamIds.add(f.teamIds[1])
}

// Find players from featured series game 1
const picksBySeries = new Map<string, PickRow[]>()
for (const p of allPicks) {
  const list = picksBySeries.get(p.seriesId) ?? []
  list.push(p)
  picksBySeries.set(p.seriesId, list)
}
for (const f of featured) {
  const seriesPicks = picksBySeries.get(f.seriesId)
  if (seriesPicks) {
    for (const p of seriesPicks) {
      featuredPlayerIds.add(p.playerId)
    }
  }
}

// Clear demo folder
if (existsSync(demoDataDir)) {
  rmSync(demoDataDir, { recursive: true, force: true })
}
mkdirSync(demoDataDir, { recursive: true })

// Write series-index (featured only, newest first)
writeFileSync(resolve(demoDataDir, 'series-index.json'), JSON.stringify(featured))

// Read all series files and write featured ones with plans
const draftsBySeriesId = new Map<string, SeriesDraft>()
const seriesFiles = readdirSync(fullDataDir).filter(f => f.endsWith('.json') && !['manifest.json', 'series-index.json', 'picks.json', 'model.json', 'backtest.json'].includes(f))
for (const f of seriesFiles) {
  const seriesId = f.replace('.json', '')
  const draft = JSON.parse(readFileSync(resolve(fullDataDir, f), 'utf8')) as SeriesDraft
  draftsBySeriesId.set(seriesId, draft)
}

// Build playerRole map from manifest for gamePlan
const playerRoleMap = new Map<string, Role | null>()
for (const p of manifest.players) {
  playerRoleMap.set(p.id, p.role)
}

for (const f of featured) {
  const draft = draftsBySeriesId.get(f.seriesId)
  if (!draft) {
    console.error(`Series file not found for ${f.seriesId}`)
    continue
  }

  // Compute plans for each game
  const plans: Record<number, EncodedPlan> = {}
  for (const game of draft.games) {
    const plan = gamePlan(draft, game.gameNumber, allPicks, model, playerRoleMap)
    plans[game.gameNumber] = encodePlan(plan)
  }

  const seriesOutput = {
    ...draft,
    plans,
  }

  const seriesJson = JSON.stringify(seriesOutput)
  writeFileSync(resolve(demoDataDir, `${f.seriesId}.json`), seriesJson)
}

// Copy notes for featured series and count them
let notesCopied = 0
const notesDir = resolve(fullDataDir, 'notes')
const demoNotesDir = resolve(demoDataDir, 'notes')
const seriesWithoutNotes: string[] = []
for (const f of featured) {
  const notesFile = resolve(notesDir, `${f.seriesId}.json`)
  if (!existsSync(notesFile)) {
    seriesWithoutNotes.push(f.seriesId)
    continue
  }
  mkdirSync(demoNotesDir, { recursive: true })
  const text = readFileSync(notesFile, 'utf8')
  const games = (JSON.parse(text) as { games: Record<string, Record<string, unknown>> }).games
  for (const teams of Object.values(games)) notesCopied += Object.keys(teams).length
  writeFileSync(resolve(demoNotesDir, `${f.seriesId}.json`), text)
}

// Write manifest
const demoManifest: Manifest = {
  generatedAt: manifest.generatedAt,
  seriesCount: manifest.seriesCount,
  gameCount: manifest.gameCount,
  teams: manifest.teams.filter(t => featuredTeamIds.has(t.id)),
  champions: manifest.champions, // all champions (lists refer to them)
  players: manifest.players.filter(p => featuredPlayerIds.has(p.id)),
  notes: manifest.notes && notesCopied > 0 ? { model: manifest.notes.model, count: notesCopied } : undefined,
  mode: 'demo',
}
writeFileSync(resolve(demoDataDir, 'manifest.json'), JSON.stringify(demoManifest))

// Copy backtest.json
writeFileSync(resolve(demoDataDir, 'backtest.json'), backtest.toString())

// Count files and total size
let fileCount = 0
let totalSize = 0
function walkDir(dir: string) {
  for (const entry of readdirSync(dir)) {
    const fullPath = resolve(dir, entry)
    if (statSync(fullPath).isDirectory()) continue
    const content = readFileSync(fullPath, 'utf8')
    totalSize += Buffer.byteLength(content)
    fileCount++
  }
}
walkDir(demoDataDir)
// Also count notes
if (existsSync(demoNotesDir)) {
  walkDir(demoNotesDir)
}

// Find largest series file
let largestFile = ''
let largestSize = 0
for (const f of featured) {
  const filePath = resolve(demoDataDir, `${f.seriesId}.json`)
  if (existsSync(filePath)) {
    const size = readFileSync(filePath, 'utf8').length
    if (size > largestSize) {
      largestSize = size
      largestFile = `${f.seriesId}.json`
    }
  }
}

const elapsed = ((performance.now() - start) / 1000).toFixed(1)
console.log(`\nDemo output:`)
console.log(`  Files: ${fileCount}`)
console.log(`  Total size: ${(totalSize / 1024).toFixed(1)} KB (${(totalSize / 1024 / 1024).toFixed(2)} MB)`)
console.log(`  Largest series file: ${largestFile} (${(largestSize / 1024).toFixed(1)} KB)`)
console.log(`  Run time: ${elapsed}s`)
console.log(`  Written to: ${demoDataDir}`)
console.log(`  Notes copied: ${notesCopied}`)
if (seriesWithoutNotes.length > 0) console.log(`  Featured series without notes: ${seriesWithoutNotes.join(' ')}`)
