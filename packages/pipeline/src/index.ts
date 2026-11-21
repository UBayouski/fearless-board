// Builds the aggregate JSON the app loads, from a local clone of the hackathon data repo.
// The data repo lives next to this project, never inside it (see README).
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const repoRoot = resolve(import.meta.dirname, '../../..')
const dataDir = resolve(repoRoot, process.env.STL_DATA_DIR ?? '../stl-hackathon-2026-grid-starter')
const seriesIndex = resolve(dataDir, 'lol/series.csv')

if (!existsSync(seriesIndex)) {
  console.error(`Hackathon data not found at ${dataDir}`)
  console.error('Clone the data repo next to this project, or set STL_DATA_DIR. See README.md.')
  process.exit(1)
}

const seriesCount = readFileSync(seriesIndex, 'utf8').trim().split('\n').length - 1
console.log(`Found ${seriesCount} League of Legends series in ${dataDir}`)
console.log('Draft extraction is not implemented yet.')
