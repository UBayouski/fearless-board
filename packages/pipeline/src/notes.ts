// Written pre-game note generation: calls Gemini API, caches, and writes notes.
// Run: pnpm data:notes [--limit N] [--series <id>]

// Pricing constants: $/million tokens. Doubles on 2027-01-01.
const INPUT_PRICE_PER_MILLION = 0.75
const OUTPUT_PRICE_PER_MILLION = 3.75

import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  gamePlan, seriesOutlook,
  noteFacts, noteWorthwhile, checkNote, NOTE_PROMPT, NOTE_PROMPT_VERSION,
  type SeriesDraft, type WrittenNote, type NoteFacts,
  type NoteNames, type PickRow, type PickModel, type Role,
} from '@fearless-board/shared'

// ── Pricing ──────────────────────────────────────────────────────────

function inputPricePerMillion(): number {
  return new Date() >= new Date('2027-01-01') ? INPUT_PRICE_PER_MILLION * 2 : INPUT_PRICE_PER_MILLION
}

function outputPricePerMillion(): number {
  return new Date() >= new Date('2027-01-01') ? OUTPUT_PRICE_PER_MILLION * 2 : OUTPUT_PRICE_PER_MILLION
}

// ── CLI options ──────────────────────────────────────────────────────

const args = process.argv.slice(2)
const limit = args.find((a, i) => a === '--limit' && args[i + 1]) ? parseInt(args[args.indexOf('--limit') + 1], 10) : Infinity
const seriesFilter = args.find((a, i) => a === '--series' && args[i + 1]) ? args[args.indexOf('--series') + 1] : null

// ── Environment ──────────────────────────────────────────────────────

// Load .env file if it exists
const envPath = resolve(import.meta.dirname, '../../../.env')
if (existsSync(envPath)) {
  const envContent = readFileSync(envPath, 'utf-8')
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIdx = trimmed.indexOf('=')
    if (eqIdx < 0) continue
    const key = trimmed.slice(0, eqIdx).trim()
    let value = trimmed.slice(eqIdx + 1).trim()
    // Remove surrounding quotes
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    if (!process.env[key]) {
      process.env[key] = value
    }
  }
}

const apiKey = process.env.GEMINI_API_KEY ?? ''
const modelId = process.env.GEMINI_MODEL ?? 'gemini-3.8-flash'

if (!apiKey) {
  console.log('GEMINI_API_KEY not set — notes generation skipped. Set it in .env and run pnpm data:notes.')
  process.exit(0)
}

// ── Load data ────────────────────────────────────────────────────────

const outputDir = resolve(import.meta.dirname, '../../app/public/data')

// Load manifest for name lookups
const manifestPath = resolve(outputDir, 'manifest.json')
if (!existsSync(manifestPath)) {
  console.error('manifest.json not found. Run pnpm data first.')
  process.exit(1)
}

const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'))
const championMap = new Map<string, string>(manifest.champions.map((c: { id: string; name: string }) => [c.id, c.name]))
const playerMap = new Map<string, string>(manifest.players.map((p: { id: string; name: string }) => [p.id, p.name]))
const teamMap = new Map<string, string>(manifest.teams.map((t: { id: string; name: string }) => [t.id, t.name]))

const names: NoteNames = {
  champion: (id: string) => championMap.get(id) ?? id,
  player: (id: string) => playerMap.get(id) ?? id,
  team: (id: string) => teamMap.get(id) ?? id,
}

// All champion names for checkNote
const allChampionNames = [...championMap.values()]

// Load picks.json for gamePlan
const picksPath = resolve(outputDir, 'picks.json')
if (!existsSync(picksPath)) {
  console.error('picks.json not found. Run pnpm data first.')
  process.exit(1)
}
const compactPicks = JSON.parse(readFileSync(picksPath, 'utf-8'))
// Decode compact picks to PickRow[]
const picks: PickRow[] = compactPicks.rows.map((row: number[]) => ({
  seriesId: compactPicks.series[row[0]],
  gameNumber: row[1],
  teamId: compactPicks.teams[row[2]],
  playerId: compactPicks.players[row[3]],
  championId: compactPicks.champions[row[4]],
  won: row[5] === 1,
}))
// Add scheduledStart from series-index
const seriesIndex: { seriesId: string; scheduledStart: string }[] = JSON.parse(readFileSync(resolve(outputDir, 'series-index.json'), 'utf-8'))
const seriesStartMap = new Map<string, string>(seriesIndex.map((s) => [s.seriesId, s.scheduledStart]))
for (const pick of picks) {
  pick.scheduledStart = seriesStartMap.get(pick.seriesId) ?? ''
}

// Load model.json
const modelPath = resolve(outputDir, 'model.json')
if (!existsSync(modelPath)) {
  console.error('model.json not found. Run pnpm data first.')
  process.exit(1)
}
const model = JSON.parse(readFileSync(modelPath, 'utf-8')) as PickModel

// Build playerRole map from manifest
const playerRole = new Map<string, Role | null>()
for (const p of manifest.players) {
  playerRole.set(p.id, p.role as Role | null)
}

// Load all series drafts
const seriesFiles = resolve(outputDir)
const drafts: SeriesDraft[] = []

// Read series-index to get all series IDs
const indexPath = resolve(outputDir, 'series-index.json')
const index = JSON.parse(readFileSync(indexPath, 'utf-8'))
const seriesList = seriesFilter ? index.filter((s: { seriesId: string }) => s.seriesId === seriesFilter) : index

for (const entry of seriesList) {
  const seriesFile = resolve(seriesFiles, `${entry.seriesId}.json`)
  if (!existsSync(seriesFile)) continue
  const draft = JSON.parse(readFileSync(seriesFile, 'utf-8')) as SeriesDraft
  drafts.push(draft)
}

// Filter to multi-game series only
const multiGameDrafts = drafts.filter(d => d.games.length >= 2)

console.log(`Loaded ${multiGameDrafts.length} multi-game series for notes`)

// ── Cache ────────────────────────────────────────────────────────────

const cacheDir = resolve(import.meta.dirname, '.cache')
const cacheFile = resolve(cacheDir, 'notes.json')
const cache = new Map<string, WrittenNote>()

if (existsSync(cacheFile)) {
  try {
    const cached = JSON.parse(readFileSync(cacheFile, 'utf-8')) as Record<string, WrittenNote>
    for (const [key, value] of Object.entries(cached)) {
      cache.set(key, value)
    }
  } catch {
    // Ignore corrupt cache
  }
}

function cacheKey(modelId: string, promptVersion: number, facts: NoteFacts): string {
  const raw = `${modelId}:${promptVersion}:${JSON.stringify(facts)}`
  return createHash('sha256').update(raw).digest('hex')
}

function saveCache() {
  mkdirSync(cacheDir, { recursive: true })
  const obj: Record<string, WrittenNote> = {}
  for (const [k, v] of cache) {
    obj[k] = v
  }
  writeFileSync(cacheFile, JSON.stringify(obj))
}

// ── API call with retry ──────────────────────────────────────────────

async function callGemini(facts: NoteFacts): Promise<{ note: WrittenNote; inputTokens: number; outputTokens: number }> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent`

  const body = {
    systemInstruction: { parts: [{ text: NOTE_PROMPT }] },
    contents: [{ role: 'user', parts: [{ text: JSON.stringify(facts) }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: 0.3,
      thinkingConfig: { thinkingLevel: 'low' },
    },
  }

  let lastError = ''
  let lastStatus = 0
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt > 0) {
      const delay = 1000 * Math.pow(2, attempt - 1)
      console.log(`  Retrying in ${delay}ms...`)
      await new Promise(r => setTimeout(r, delay))
    }

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey,
        },
        body: JSON.stringify(body),
      })

      lastStatus = response.status

      if (response.status === 429 || response.status >= 500) {
        lastError = `HTTP ${response.status}`
        continue
      }

      if (response.status >= 400) {
        // A request the API rejects will be rejected every time: stop the whole run
        const text = await response.text()
        fatal = new Error(`HTTP ${response.status}: ${text.slice(0, 300)}`)
        throw fatal
      }

      const data: any = await response.json()
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text
      if (!text) throw new Error('No text in response')

      const note = JSON.parse(text) as WrittenNote
      const inputTokens = data.usageMetadata?.promptTokenCount ?? 0
      // Thinking tokens are billed as output
      const outputTokens = (data.usageMetadata?.candidatesTokenCount ?? 0) + (data.usageMetadata?.thoughtsTokenCount ?? 0)
      return { note, inputTokens, outputTokens }
    } catch (e) {
      lastError = String(e)
      if (lastStatus !== 429 && lastStatus < 500) throw e
    }
  }

  throw new Error(`API failed after retries: ${lastError}`)
}

// ── Generate notes ───────────────────────────────────────────────────

interface NoteResult {
  seriesId: string
  gameNumber: number
  teamId: string
  note: WrittenNote
  inputTokens: number
  outputTokens: number
}

interface NoteFailure {
  seriesId: string
  gameNumber: number
  teamId: string
  problem: string
}

// Build all note tasks
interface NoteTask {
  draft: SeriesDraft
  gameNumber: number
  teamId: string
}

const tasks: NoteTask[] = []
for (const draft of multiGameDrafts) {
  for (let gi = 1; gi < draft.games.length; gi++) {
    // Game 2+ only (gameNumber starts at 1)
    const gameNumber = draft.games[gi].gameNumber
    for (const teamId of draft.teamIds) {
      tasks.push({ draft, gameNumber, teamId })
    }
  }
}

console.log(`Total note tasks: ${tasks.length}`)

// Process with concurrency limit of 6
const concurrency = 6
let savedAtCalls = 0
const results: NoteResult[] = []
const failures: NoteFailure[] = []
let fromCache = 0
let skippedThin = 0
let fatal: Error | null = null
let newCalls = 0
let totalInputTokens = 0
let totalOutputTokens = 0

async function processTask(task: NoteTask): Promise<void> {
  const { draft, gameNumber, teamId } = task

  // Build gamePlan and seriesOutlook
  const plan = gamePlan(draft, gameNumber, picks, model, playerRole)
  const outlook = seriesOutlook(plan)

  // Build facts
  const opponentId = draft.teamIds.find(t => t !== teamId)
  const earlier = draft.games.filter(g => g.gameNumber < gameNumber)
  const facts = noteFacts(plan, outlook, names, teamId, {
    own: earlier.filter(g => g.winnerTeamId === teamId).length,
    opponent: earlier.filter(g => g.winnerTeamId === opponentId).length,
  })

  // Too little history to say anything (mostly the first weeks of the data): no note, no call
  if (!noteWorthwhile(facts)) {
    skippedThin++
    return
  }

  // Check cache
  const key = cacheKey(modelId, NOTE_PROMPT_VERSION, facts)
  if (cache.has(key)) {
    const note = cache.get(key)!
    results.push({
      seriesId: draft.seriesId,
      gameNumber,
      teamId,
      note,
      inputTokens: 0,
      outputTokens: 0,
    })
    fromCache++
    return
  }

  // Call API
  newCalls++
  let result: { note: WrittenNote; inputTokens: number; outputTokens: number }
  try {
    result = await callGemini(facts)
  } catch (e) {
    failures.push({
      seriesId: draft.seriesId,
      gameNumber,
      teamId,
      problem: String(e),
    })
    return
  }

  // Check note
  const problems = checkNote(facts, result.note, allChampionNames)
  if (problems.length > 0) {
    // Retry once
    try {
      newCalls++
      const retryResult = await callGemini(facts)
      const retryProblems = checkNote(facts, retryResult.note, allChampionNames)
      if (retryProblems.length > 0) {
        failures.push({
          seriesId: draft.seriesId,
          gameNumber,
          teamId,
          problem: `Check failed (2 attempts): ${retryProblems.map(p => p.detail).join('; ')}`,
        })
        return
      }
      result = retryResult
    } catch (e) {
      failures.push({
        seriesId: draft.seriesId,
        gameNumber,
        teamId,
        problem: `Retry failed: ${String(e)}`,
      })
      return
    }
  }

  // Cache and store
  cache.set(key, result.note)
  totalInputTokens += result.inputTokens
  totalOutputTokens += result.outputTokens
  results.push({
    seriesId: draft.seriesId,
    gameNumber,
    teamId,
    note: result.note,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
  })
}

// Process sequentially with concurrency control
// Using a semaphore pattern to limit concurrent API calls
async function processWithLimit(tasks: NoteTask[], maxConcurrent: number, maxCalls: number): Promise<void> {
  const running: Promise<void>[] = []

  for (const task of tasks) {
    if (fatal) break
    if (newCalls >= maxCalls) {
      console.log(`Limit of ${maxCalls} new API calls reached. Stopping.`)
      break
    }

    const promise = (async () => {
      await processTask(task)
    })()
    running.push(promise)

    if (running.length >= maxConcurrent) {
      await Promise.all(running)
      running.length = 0
      // Keep paid results if the run is interrupted
      if (newCalls - savedAtCalls >= 60) { saveCache(); savedAtCalls = newCalls }
    }
  }

  await Promise.all(running)
}

await processWithLimit(tasks, concurrency, limit)

// Save cache
saveCache()

if (fatal) {
  console.error(`Stopped: the API rejected a request. ${(fatal as Error).message}`)
  process.exit(1)
}

// ── Write output ─────────────────────────────────────────────────────

const notesDir = resolve(outputDir, 'notes')
// A run over all series replaces the folder, so no note from an older run is left behind
if (!seriesFilter) rmSync(notesDir, { recursive: true, force: true })
mkdirSync(notesDir, { recursive: true })

// Group results by series
const bySeries = new Map<string, Map<number, Map<string, WrittenNote>>>()
for (const r of results) {
  if (!bySeries.has(r.seriesId)) bySeries.set(r.seriesId, new Map())
  const games = bySeries.get(r.seriesId)!
  if (!games.has(r.gameNumber)) games.set(r.gameNumber, new Map())
  games.get(r.gameNumber)!.set(r.teamId, r.note)
}

for (const [seriesId, games] of bySeries) {
  const gamesObj: Record<string, Record<string, WrittenNote>> = {}
  for (const [gameNumber, teams] of games) {
    const teamsObj: Record<string, WrittenNote> = {}
    for (const [teamId, note] of teams) {
      teamsObj[teamId] = note
    }
    gamesObj[String(gameNumber)] = teamsObj
  }
  const output = {
    model: modelId,
    promptVersion: NOTE_PROMPT_VERSION,
    games: gamesObj,
  }
  writeFileSync(resolve(notesDir, `${seriesId}.json`), JSON.stringify(output))
}

// Update manifest with notes info
const manifestObj = JSON.parse(readFileSync(manifestPath, 'utf-8'))
manifestObj.notes = { model: modelId, count: results.length }
writeFileSync(manifestPath, JSON.stringify(manifestObj))

// ── Summary ──────────────────────────────────────────────────────────

const cost = (totalInputTokens / 1_000_000) * inputPricePerMillion() + (totalOutputTokens / 1_000_000) * outputPricePerMillion()

console.log('\n── Notes Summary ──')
console.log(`Notes written: ${results.length}`)
console.log(`From cache: ${fromCache}`)
console.log(`Skipped, too little history: ${skippedThin}`)
console.log(`New API calls: ${newCalls}`)
console.log(`Failed checks: ${failures.length}`)
if (failures.length > 0) {
  for (const f of failures.slice(0, 10)) {
    const teamName = teamMap.get(f.teamId) ?? f.teamId
    console.log(`  - Series ${f.seriesId}, Game ${f.gameNumber}, ${teamName}: ${f.problem}`)
  }
  if (failures.length > 10) {
    console.log(`  ... and ${failures.length - 10} more`)
  }
}
console.log(`Input tokens: ${totalInputTokens}`)
console.log(`Output tokens: ${totalOutputTokens}`)
console.log(`Estimated cost: $${cost.toFixed(4)}`)
console.log(`Output: ${notesDir}`)
