// Fails unless dist-site holds only the app and the draft data the organisers allowed to show:
// the app files, manifest, series index, one file per series, compact picks, model weights, backtest
// summary, and notes. No match files, no extracts, no env files, no demo folder.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { relative, resolve, sep } from 'node:path'

const site = resolve(process.argv[2] ?? 'packages/app/dist-site')
if (!existsSync(site)) {
  console.error(`Error: ${site} does not exist. Run pnpm build:site first.`)
  process.exit(1)
}

const allowed = [
  /^index\.html$/,
  /^favicon\.svg$/,
  /^assets\/[\w.-]+\.(js|css|woff2?)$/,
  /^data\/(manifest|series-index|picks|model|backtest)\.json$/,
  /^data\/\d+\.json$/,
  /^data\/notes\/\d+\.json$/,
]
let errors = 0
const fail = (message) => { console.error(`FAIL: ${message}`); errors++ }

const files = []
const walk = (dir) => {
  for (const entry of readdirSync(dir)) {
    const path = resolve(dir, entry)
    if (statSync(path).isDirectory()) walk(path)
    else files.push(relative(site, path).split(sep).join('/'))
  }
}
walk(site)
for (const f of files) if (!allowed.some((re) => re.test(f))) fail(`unexpected file ${f}`)

const index = JSON.parse(readFileSync(resolve(site, 'data/series-index.json'), 'utf8'))
// One file per series in the index, and no series file that the index does not list
const seriesFiles = new Set(files.filter((f) => /^data\/\d+\.json$/.test(f)))
const indexedFiles = new Set(index.map((e) => `data/${e.seriesId}.json`))
for (const f of indexedFiles) if (!seriesFiles.has(f)) fail(`${f} is missing for a series in the index`)
for (const f of seriesFiles) if (!indexedFiles.has(f)) fail(`${f} is not in the series index`)

// No secret may end up in the bundle
for (const f of files.filter((name) => name.endsWith('.js'))) {
  const text = readFileSync(resolve(site, f), 'utf8')
  if (/AIza[0-9A-Za-z_-]{20,}|RGAPI-|GEMINI_API_KEY/.test(text)) fail(`${f} contains something that looks like an API key`)
}

// The manifest's note count matches the notes on the site
const manifest = JSON.parse(readFileSync(resolve(site, 'data/manifest.json'), 'utf8'))
let noteCount = 0
for (const f of files.filter((name) => name.startsWith('data/notes/'))) {
  for (const game of Object.values(JSON.parse(readFileSync(resolve(site, f), 'utf8')).games)) noteCount += Object.keys(game).length
}
if ((manifest.notes?.count ?? 0) !== noteCount) fail(`data/manifest.json says ${manifest.notes?.count ?? 0} notes, the site has ${noteCount}`)

const size = files.reduce((sum, f) => sum + statSync(resolve(site, f)).size, 0)
if (errors > 0) {
  console.error(`\n${errors} check(s) failed. The site build is not safe to deploy.`)
  process.exit(1)
}
console.log(`Site build checks passed: ${files.length} files, ${(size / 1024 / 1024).toFixed(1)} MB, ${index.length} series.`)
