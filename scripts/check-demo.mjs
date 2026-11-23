// Verify the demo build (dist-demo) meets the safety constraints.
// Fails the build unless all checks pass.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { resolve } from 'node:path'

const distDemo = resolve('packages/app/dist-demo')

if (!existsSync(distDemo)) {
  console.error(`Error: ${distDemo} does not exist. Run pnpm build:demo first.`)
  process.exit(1)
}

let errors = 0

// 1. No folder "data" (should be "data-demo")
if (existsSync(resolve(distDemo, 'data'))) {
  console.error('FAIL: dist-demo contains a "data" folder (should be "data-demo")')
  errors++
}

// 2. No picks.json or model.json anywhere
function walkForForbidden(dir, forbidden) {
  const entries = readdirSync(dir)
  for (const entry of entries) {
    const fullPath = resolve(dir, entry)
    if (statSync(fullPath).isDirectory()) {
      walkForForbidden(fullPath, forbidden)
    } else if (forbidden.has(entry)) {
      console.error(`FAIL: forbidden file found: ${fullPath}`)
      errors++
    }
  }
}
walkForForbidden(distDemo, new Set(['picks.json', 'model.json']))

// 3. Number of series files equals length of series-index.json
const dataDemoDir = resolve(distDemo, 'data-demo')
if (!existsSync(dataDemoDir)) {
  console.error(`FAIL: ${dataDemoDir} does not exist`)
  errors++
} else {
  const indexFile = resolve(dataDemoDir, 'series-index.json')
  if (!existsSync(indexFile)) {
    console.error('FAIL: series-index.json not found in data-demo')
    errors++
  } else {
    const index = JSON.parse(readFileSync(indexFile, 'utf8'))
    const seriesFiles = readdirSync(dataDemoDir)
      .filter(f => f.endsWith('.json') && !['manifest.json', 'series-index.json', 'backtest.json'].includes(f))
    if (seriesFiles.length !== index.length) {
      console.error(`FAIL: ${seriesFiles.length} series files but ${index.length} entries in series-index.json`)
      errors++
    }
  }

  // 4. series-index.json length is at most 20
  const indexFile2 = resolve(dataDemoDir, 'series-index.json')
  if (existsSync(indexFile2)) {
    const index = JSON.parse(readFileSync(indexFile2, 'utf8'))
    if (index.length > 20) {
      console.error(`FAIL: series-index.json has ${index.length} entries (max 20)`)
      errors++
    }
  }
}

if (errors > 0) {
  console.error(`\n${errors} check(s) failed. The demo build is not safe to deploy.`)
  process.exit(1)
}

console.log('Demo build checks passed.')
